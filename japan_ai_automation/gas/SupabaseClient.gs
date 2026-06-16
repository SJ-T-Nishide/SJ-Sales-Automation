// ============================================================
// SupabaseClient.gs — Supabase REST API ラッパー
// ============================================================

function getSupabaseConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_ANON_KEY');
  if (!url || !key) {
    throw new Error(
      'スクリプトプロパティが未設定です。\n' +
      'SUPABASE_URL と SUPABASE_ANON_KEY を設定してください。\n' +
      '設定方法: GASエディタ → プロジェクトの設定 → スクリプトプロパティ'
    );
  }
  return { url: url.replace(/\/$/, ''), key };
}

function supabaseRequest_(method, table, body, queryParams) {
  const { url, key } = getSupabaseConfig_();

  let endpoint = `${url}/rest/v1/${table}`;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    endpoint += `?${qs}`;
  }

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'User-Agent': 'GAS-Server/1.0',
    'X-Client-Info': 'gas-server/1.0',
  };

  if (method === 'POST') {
    headers['Prefer'] = 'return=minimal';
  }

  const options = {
    method: method.toLowerCase(),
    headers: headers,
    muteHttpExceptions: true,
  };

  if (body !== null && body !== undefined) {
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch(endpoint, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(`Supabase ${method} ${table} エラー (HTTP ${code}): ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

// SELECT
function supabaseSelect(table, filters) {
  const params = { select: '*' };
  if (filters) {
    Object.entries(filters).forEach(([col, val]) => {
      params[`${col}`] = `eq.${val}`;
    });
  }
  return supabaseRequest_('GET', table, null, params) || [];
}

// INSERT（単件または配列）
function supabaseInsert(table, data) {
  return supabaseRequest_('POST', table, data);
}

// UPSERT（on_conflictで指定したカラムで重複時はUPDATE）
function supabaseUpsert(table, data, onConflictCols) {
  const { url, key } = getSupabaseConfig_();
  const endpoint = `${url}/rest/v1/${table}?on_conflict=${onConflictCols}`;

  const options = {
    method: 'post',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
      'User-Agent': 'GAS-Server/1.0',
      'X-Client-Info': 'gas-server/1.0',
    },
    payload: JSON.stringify(data),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(endpoint, options);
  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error(`Supabase UPSERT ${table} エラー (HTTP ${code}): ${response.getContentText()}`);
  }
}

// PATCH（条件付き更新）
function supabasePatch(table, data, filters) {
  const params = {};
  if (filters) {
    Object.entries(filters).forEach(([col, val]) => {
      params[col] = `eq.${val}`;
    });
  }
  return supabaseRequest_('PATCH', table, data, params);
}

// バッチ処理（配列をBATCH_SIZEずつ分割してUPSERT）
function supabaseBatchUpsert(table, rows, onConflictCols) {
  if (!rows || rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      supabaseUpsert(table, batch, onConflictCols);
      Logger.log(`  → バッチ ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length}件 送信完了`);
    } catch (e) {
      if (e.message && e.message.includes('"23505"') && e.message.includes('phone')) {
        // 電話重複エラー: 個別処理に切替え、phone競合時はphoneを除いて再試行
        let ok = 0;
        for (const row of batch) {
          try {
            supabaseUpsert(table, [row], onConflictCols);
            ok++;
          } catch (e2) {
            if (e2.message && e2.message.includes('"23505"') && e2.message.includes('phone') && row.phone) {
              const r2 = Object.assign({}, row);
              delete r2.phone;
              try { supabaseUpsert(table, [r2], onConflictCols); ok++; } catch (_) {}
            }
          }
        }
        Logger.log(`  → バッチ ${Math.floor(i / BATCH_SIZE) + 1}: ${ok}/${batch.length}件（一部電話省略）`);
      } else {
        throw e;
      }
    }
    if (i + BATCH_SIZE < rows.length) Utilities.sleep(200);
  }
}
