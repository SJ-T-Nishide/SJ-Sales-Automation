'use strict';

const STORAGE_KEY = 'reins_records';
const SOURCE_NAME = 'REINS';
// TAB_NAME は popup.js からメッセージで受け取る（未指定時は空欄）

// ======================================================
// 日時フォーマット
// ======================================================
function nowString() {
  const d = new Date();
  const z = n => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' +
    z(d.getMonth() + 1) + '-' +
    z(d.getDate()) + ' ' +
    z(d.getHours()) + ':' +
    z(d.getMinutes()) + ':' +
    z(d.getSeconds())
  );
}

// ======================================================
// テキスト取得ヘルパー
// ======================================================
function cellText(items, idx) {
  const el = items[idx];
  return el ? el.textContent.trim() : '';
}

// ======================================================
// フィールドパーサー
// ======================================================

// "198万円" → "198"（万円単位）
function parseRent(text) {
  if (!text) return '';
  const m = text.match(/([\d,]+(?:\.\d+)?)\s*万円/);
  if (!m) return '';
  return m[1].replace(/,/g, '');
}

// "220,000円" → "220000"（円単位）
function parseManageFee(text) {
  if (!text) return '';
  const m = text.match(/([\d,]+)\s*円/);
  if (!m) return '';
  return m[1].replace(/,/g, '');
}

// "581.92㎡" / "581.92m²" → "581.92"
function parseArea(text) {
  if (!text) return '';
  const m = text.match(/([\d,]+(?:\.\d+)?)\s*(?:㎡|m²)/);
  if (!m) return '';
  return m[1].replace(/,/g, '');
}

// "2025年（令和 7年） 8月" → "2025年8月"
function parseBuiltDate(text) {
  if (!text) return '';
  const m = text.match(/(\d{4})年[^0-9]*(\d+)月/);
  if (!m) return '';
  return m[1] + '年' + m[2] + '月';
}

// 敷金/保証金フィールド: "3ヶ月/-" → { 敷金: "3ヶ月", 保証金: "" }
function parseShikiHosho(text) {
  if (!text || text === '-') return { shiki: '', hosho: '' };
  const parts = text.split('/');
  const shiki  = (parts[0] || '').trim();
  const hosho  = (parts[1] || '').trim();
  return {
    shiki:  shiki  === '-' ? '' : shiki,
    hosho:  hosho  === '-' ? '' : hosho,
  };
}

// 礼金/権利金フィールド: "3ヶ月/-" → "3ヶ月"（最初のスラッシュ前）
function parseRekin(text) {
  if (!text || text === '-') return '';
  const part = text.split('/')[0].trim();
  return part === '-' ? '' : part;
}

// 用途地域: "-" → "" に正規化
function parseYoto(text) {
  if (!text || text.trim() === '-') return '';
  return text.trim();
}

// 交通: items[17]（沿線駅）+ items[18]（交通詳細）を結合
// items[17]: "大阪メトロ四つ橋線 花園町"
// items[18]: "徒歩7分"
function parseTraffic(items) {
  const line    = cellText(items, 17).replace(/\s+/g, ' ').trim();
  const detail  = cellText(items, 18).replace(/\s+/g, ' ').trim();
  if (!line && !detail) return '';
  if (!detail) return line;
  if (!line)   return detail;
  return line + ' ' + detail;
}

// ======================================================
// 1行分のレコード生成
// ======================================================
function buildRecord(row, now, sourceUrl, tabName) {
  const items = row.querySelectorAll('div.p-table-body-item');
  if (items.length < 30) return null;   // 列数が足りなければスキップ

  const propNo   = cellText(items, 3);
  if (!propNo) return null;             // 物件番号なしはスキップ

  const rentRaw    = cellText(items, 8);
  const manageFee  = cellText(items, 14);
  const shikiHosho = parseShikiHosho(cellText(items, 15));
  const rekin      = parseRekin(cellText(items, 21));
  const areaRaw    = cellText(items, 10);

  const record = {
    'タブ名':        tabName,
    '取得日時':      now,
    '連番':          '',
    '物件番号':      propNo,
    '取得元':        SOURCE_NAME,
    '物件種目':      cellText(items, 4),
    '所在地':        cellText(items, 6),
    '建物名':        cellText(items, 11),
    '賃料(万円)':    parseRent(rentRaw),
    '管理費(円)':    parseManageFee(manageFee),
    '面積(㎡)':      parseArea(areaRaw),
    '㎡単価(万円)':  '',
    '坪単価(万円)':  '',
    '間取':          '',       // REINS一覧に間取列なし
    '所在階':        '',       // REINS一覧に所在階列なし
    '築年月':        parseBuiltDate(cellText(items, 28)),
    '交通':          parseTraffic(items),
    '電話番号':      cellText(items, 26),
    '用途地域':      parseYoto(cellText(items, 9)),
    '敷金':          shikiHosho.shiki,
    '保証金':        shikiHosho.hosho,
    '礼金':          rekin,
    'source_url':    sourceUrl,
    '備考':          '',
    'duplicate_key': '',       // GASが生成
    'preliminary_score': '',
    'first_judgement':   '',
    'manual_judgement':  '',
    'detail_status':     '',
    '水道光熱費':    '',
    'Wi-Fi':         '',
    '消耗品費':      '',
    'リネン備品費':  '',
    '保険料':        '',
    'その他費用':    '',
    '月次費用合計':  '',
    '保守_CF/月':    '',
    '標準_CF/月':    '',
    '攻め_CF/月':    '',
    '保守_年間CF':   '',
    '標準_年間CF':   '',
    '攻め_年間CF':   '',
    '初期投資額':    '',
    '保守_年間利回り%':   '',
    '標準_年間利回り%':   '',
    '攻め_年間利回り%':   '',
    '投資回収月数_標準':  '',
    '標準判定':      '',
    '判定根拠':      '',
    '実行日時':      '',
    'メモ':          '',
    '取得元シート名':'',
    '賃料':          rentRaw,
    '管理費':        manageFee,
    '面積':          areaRaw,
    // 重複チェック用の内部キー（保存時に使用）
    '_dupKey': 'id:' + propNo,
  };

  return record;
}


// ======================================================
// メッセージリスナー
// ======================================================
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.action === 'extract') {
    // 非同期で chrome.storage を操作
    (async () => {
      const tabName = (msg.tabName !== undefined) ? msg.tabName : '';
      const rows = document.querySelectorAll('div.p-table-body-row');
      console.log('[REINS拡張] div.p-table-body-row 件数:', rows.length);
      console.log('[REINS拡張] タブ名:', tabName || '（空欄）');

      if (rows.length === 0) {
        console.warn('[REINS拡張] 物件行が見つかりませんでした。');
        console.log('[REINS拡張] URL:', location.href);
        console.log('[REINS拡張] .p-table 存在:', !!document.querySelector('.p-table'));
        console.log('[REINS拡張] .p-table-body 存在:', !!document.querySelector('.p-table-body'));
        sendResponse({ ok: true, extracted: 0, added: 0, skipped: 0, total: 0, sample: [] });
        return;
      }

      const now       = nowString();
      const sourceUrl = location.origin + location.pathname;

      const newRecords = [];
      for (const row of rows) {
        const rec = buildRecord(row, now, sourceUrl, tabName);
        if (rec) newRecords.push(rec);
      }

      console.log('[REINS拡張] パース成功:', newRecords.length, '件');

      // chrome.storage から既存レコードを取得
      const stored = await chrome.storage.local.get([STORAGE_KEY]);
      const existing = stored[STORAGE_KEY] || [];

      // 重複チェック用セット
      const existKeys = new Set(existing.map(r => r._dupKey));

      let added = 0, skipped = 0;
      const toAdd = [];
      for (const rec of newRecords) {
        if (existKeys.has(rec._dupKey)) {
          skipped++;
        } else {
          existKeys.add(rec._dupKey);
          toAdd.push(rec);
          added++;
        }
      }

      const merged = existing.concat(toAdd);
      await chrome.storage.local.set({ [STORAGE_KEY]: merged });

      const sample = merged.slice(0, 3).map(r => {
        const s = Object.assign({}, r);
        delete s._dupKey;
        return s;
      });

      console.log('[REINS拡張] 新規追加:', added, '件 / 重複スキップ:', skipped, '件 / 合計:', merged.length, '件');

      sendResponse({
        ok:        true,
        extracted: newRecords.length,
        added:     added,
        skipped:   skipped,
        total:     merged.length,
        sample:    sample,
      });
    })();

    return true; // 非同期レスポンスを示す
  }

  if (msg.action === 'debug') {
    const rows = document.querySelectorAll('div.p-table-body-row');
    console.log('=== [REINS拡張] デバッグ情報 ===');
    console.log('URL:', location.href);
    console.log('div.p-table-body-row 件数:', rows.length);

    if (rows.length > 0) {
      const items = rows[0].querySelectorAll('div.p-table-body-item');
      console.log('1行目の p-table-body-item 数:', items.length);
      items.forEach((item, i) => {
        console.log('  [' + i + ']:', JSON.stringify(item.textContent.trim().slice(0, 60)));
      });
    }

    // ページ上の関連クラス一覧
    console.log('.p-table 存在:', !!document.querySelector('.p-table'));
    console.log('.p-table-body 存在:', !!document.querySelector('.p-table-body'));
    console.log('.p-table-body-row 数:', rows.length);
    console.log('================================');

    sendResponse({});
    return true;
  }
});
