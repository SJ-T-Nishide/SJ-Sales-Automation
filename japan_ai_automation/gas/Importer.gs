// ============================================================
// Importer.gs — Google Sheets → Supabase リードインポーター
// 元データは一切改変しません（読取専用）
// ============================================================

// メインエントリーポイント（GASエディタから手動実行）
function importAllLeads() {
  const startTime = Date.now();
  const results = { total: 0, imported: 0, skipped: 0, errors: 0, tabs: [] };

  Logger.log('=== リードインポート開始 ===');

  for (const sheetId of SOURCE_SHEETS) {
    let ss;
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      Logger.log(`ERROR: スプレッドシートを開けませんでした (${sheetId}): ${e.message}`);
      results.errors++;
      continue;
    }

    Logger.log(`スプレッドシート: ${ss.getName()}`);

    for (const sheet of ss.getSheets()) {
      // タイムアウト防止
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        Logger.log('⚠️ 実行時間上限に達しました。残りのタブは次回実行してください。');
        break;
      }

      const tabName = sheet.getName();

      if (SKIP_TABS.some(s => tabName.includes(s))) {
        Logger.log(`  スキップ: ${tabName}`);
        continue;
      }

      const tabResult = importTab_(sheet, sheetId);
      results.total     += tabResult.total;
      results.imported  += tabResult.imported;
      results.skipped   += tabResult.skipped;
      results.errors    += tabResult.errors;
      results.tabs.push({ name: tabName, ...tabResult });
    }
  }

  Logger.log('=== インポート完了 ===');
  Logger.log(`合計: ${results.total}行 / インポート: ${results.imported}件 / スキップ: ${results.skipped}件 / エラー: ${results.errors}件`);
  Logger.log('\nタブ別サマリー:');
  results.tabs.forEach(t => {
    Logger.log(`  ${t.name}: ${t.imported}件インポート (${t.skipped}スキップ, ${t.errors}エラー)`);
  });

  return results;
}

// 1タブ分のインポート
function importTab_(sheet, sheetId) {
  const tabName = sheet.getName();
  const result = { total: 0, imported: 0, skipped: 0, errors: 0 };

  Logger.log(`\nタブ処理中: ${tabName}`);

  // ヘッダー行を検出
  const headerRowIndex = detectHeaderRow_(sheet);
  if (headerRowIndex === -1) {
    Logger.log(`  スキップ: ヘッダー行が見つかりません`);
    return result;
  }

  const allValues = sheet.getDataRange().getValues();
  const headers = allValues[headerRowIndex].map(h => String(h).trim());
  const colMap = mapHeaders_(headers);

  if (Object.keys(colMap).length === 0) {
    Logger.log(`  スキップ: 認識できる列がありません`);
    return result;
  }

  Logger.log(`  ヘッダー行: ${headerRowIndex + 1}行目 / 認識列: ${Object.keys(colMap).join(', ')}`);

  const leadsToUpsert = [];

  for (let i = headerRowIndex + 1; i < allValues.length; i++) {
    const row = allValues[i];
    result.total++;

    // 空行スキップ
    if (row.every(cell => cell === '' || cell === null || cell === undefined)) {
      result.skipped++;
      continue;
    }

    const lead = buildLead_(row, colMap, tabName, i + 1, sheetId);

    if (!lead) {
      result.skipped++;
      continue;
    }

    leadsToUpsert.push(lead);
  }

  if (leadsToUpsert.length === 0) {
    Logger.log(`  有効なリードが見つかりませんでした`);
    return result;
  }

  // email優先でUPSERT（emailがあればemailで重複排除、なければphoneで）
  const withEmail    = leadsToUpsert.filter(l => l.email);
  const phoneOnly    = leadsToUpsert.filter(l => !l.email && l.phone);
  const noContact    = leadsToUpsert.filter(l => !l.email && !l.phone);

  try {
    if (withEmail.length > 0) {
      supabaseBatchUpsert('leads', withEmail, 'email');
      result.imported += withEmail.length;
      Logger.log(`  メールあり: ${withEmail.length}件 UPSERT完了`);
    }
    if (phoneOnly.length > 0) {
      supabaseBatchUpsert('leads', phoneOnly, 'phone');
      result.imported += phoneOnly.length;
      Logger.log(`  電話のみ: ${phoneOnly.length}件 UPSERT完了`);
    }
    if (noContact.length > 0) {
      Logger.log(`  ⚠️ メール・電話両方なし: ${noContact.length}件スキップ`);
      result.skipped += noContact.length;
    }
  } catch (e) {
    Logger.log(`  ERROR: ${e.message}`);
    result.errors += leadsToUpsert.length;
  }

  return result;
}

// ヘッダー行を自動検出（最初の5行から探す）
function detectHeaderRow_(sheet) {
  const maxCheck = Math.min(5, sheet.getLastRow());
  const values = sheet.getRange(1, 1, maxCheck, sheet.getLastColumn()).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i].map(c => String(c).trim());
    const matches = row.filter(cell => {
      return Object.values(HEADER_SYNONYMS).some(synonyms =>
        synonyms.some(s => s === cell || cell.includes(s))
      );
    });
    // 2列以上マッチしたらヘッダー行と判断
    if (matches.length >= 2) return i;
  }
  return -1;
}

// ヘッダー配列 → 標準フィールド名のマップを作成
// 戻り値: { 0: 'name', 2: 'email', 5: 'phone', ... }（キーは列インデックス）
function mapHeaders_(headers) {
  const colMap = {};
  headers.forEach((header, colIdx) => {
    for (const [fieldName, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (synonyms.some(s => header === s || header.includes(s))) {
        colMap[colIdx] = fieldName;
        break;
      }
    }
  });
  return colMap;
}

// 1行のデータからleadオブジェクトを構築
function buildLead_(row, colMap, tabName, rowNum, sheetId) {
  const data = {};

  Object.entries(colMap).forEach(([colIdx, fieldName]) => {
    const raw = row[parseInt(colIdx)];
    data[fieldName] = raw !== undefined && raw !== null ? String(raw).trim() : '';
  });

  // 電話番号の正規化（ハイフン除去・先頭0補完）
  if (data.phone) {
    data.phone = normalizePhone_(data.phone);
  }

  // メールアドレスの正規化
  if (data.email) {
    data.email = data.email.toLowerCase().trim();
    if (!isValidEmail_(data.email)) {
      data.email = '';
    }
  }

  // メールも電話もなければスキップ
  if (!data.email && !data.phone) return null;

  // heat正規化
  if (data.heat) {
    data.heat = HEAT_NORMALIZE[data.heat] || 'C';
  } else {
    data.heat = 'C';
  }

  // status正規化
  if (data.status) {
    data.status = STATUS_NORMALIZE[data.status] || data.status;
  } else {
    data.status = '未対応';
  }

  // 日付フィールドの変換
  ['last_contacted_at', 'last_marketed_at'].forEach(field => {
    if (data[field]) {
      const parsed = parseDateValue_(data[field]);
      data[field] = parsed || null;
    }
  });

  // メタデータ付与（元データの追跡用）
  data.source_tab      = tabName;
  data.source_row      = rowNum;
  data.source_sheet_id = sheetId;

  // オプトイン: シートに明示的な同意フラグがなければ false のまま
  if (!data.opted_in_email) data.opted_in_email = false;
  if (!data.opted_in_sms)   data.opted_in_sms   = false;

  // 空文字列をnullに変換（Supabaseでインデックスが効くように）
  Object.keys(data).forEach(k => {
    if (data[k] === '') data[k] = null;
  });

  return data;
}

// 電話番号正規化: 09012345678 形式に統一
function normalizePhone_(raw) {
  const digits = raw.replace(/[\s\-\(\)\.]/g, '');
  if (!digits) return null;

  // E.164形式（+81...）を日本国内形式に変換
  if (digits.startsWith('+81')) {
    return '0' + digits.slice(3);
  }

  // 先頭0がない場合は補完（9012345678 → 09012345678）
  if (digits.length === 10 && !digits.startsWith('0')) {
    return '0' + digits;
  }

  // 11桁（携帯）または10桁（固定）のみ有効
  if (digits.length === 11 || digits.length === 10) {
    return digits;
  }

  return null;
}

// メールアドレスの簡易バリデーション
function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Spreadsheetsの日付値（シリアル値 or 文字列）をISO文字列に変換
function parseDateValue_(value) {
  if (!value) return null;
  try {
    let d;
    if (value instanceof Date) {
      d = value;
    } else {
      d = new Date(value);
    }
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch (e) {
    return null;
  }
}
