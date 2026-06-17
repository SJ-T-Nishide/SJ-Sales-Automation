// ============================================================
// WebApp.gs — CRM + 一斉送信 WebApp
// デプロイ: GASエディタ → デプロイ → 新しいデプロイ → 種類: ウェブアプリ
//           アクセス権: 組織内ユーザー
// ============================================================

function doGet(e) {
  // 出席確認・配信停止ハンドラ — 認証不要（トークンが認証代わり）
  // ※ 外部リードが使用するため、WebAppデプロイを「全員（匿名含む）」に変更が必要
  if (e && e.parameter) {
    if (e.parameter.action === 'attend')      return handleAttendance_(e.parameter.token || '');
    if (e.parameter.action === 'unsubscribe') return handleUnsubscribe_(e.parameter.token || '');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Success Japan CRM')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

// ============================================================
// Webhook — selecttype 申込受信（doPost）
// GAS WebApp URL に POST → このハンドラが動く
// ============================================================

function doPost(e) {
  try {
    Logger.log('=== doPost 受信 ===');
    Logger.log('type: ' + (e.postData ? e.postData.type : 'none'));
    Logger.log('contents: ' + (e.postData ? (e.postData.contents || '').substring(0, 500) : 'none'));
    Logger.log('params: ' + JSON.stringify(e.parameter || {}));

    // Webhook Secret 検証（URLクエリパラメータ ?secret=XXX で渡す）
    // 例: https://script.google.com/macros/s/XXX/exec?secret=YOUR_SECRET
    // GAS WebApp では e.headers が利用不可のため query param を使用
    var secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (secret) {
      var incoming = (e.parameter && e.parameter['secret']) || '';
      if (incoming !== secret) {
        Logger.log('doPost: Webhook Secret 不一致 → 拒否');
        return buildJsonResponse_({ ok: false, error: 'unauthorized' });
      }
    } else {
      Logger.log('警告: WEBHOOK_SECRET 未設定。本番前にスクリプトプロパティへ設定を推奨');
    }

    // ペイロードパース（JSON または formData）
    var data = {};
    if (e.postData && e.postData.type === 'application/json') {
      data = JSON.parse(e.postData.contents || '{}');
    } else {
      data = e.parameter || {};
    }

    // 面談予約 Webhook（TimeRex / Calendly 等から）
    if (data['action'] === 'meeting_booked') {
      return handleMeetingBooked_(data);
    }

    // フィールドマッピング（selecttype の実際の形式に応じてキー名を追加）
    var name    = data['name']    || data['氏名']    || data['お名前']   || data['申込者名']       || '';
    var email   = data['email']   || data['Email']   || data['メールアドレス']                     || '';
    var phone   = data['phone']   || data['Tel']     || data['電話番号']                           || '';
    var product = data['product'] || data['商品名']  || data['セミナー名'] || data['plan_name']    || 'B-1';

    if (!email) {
      Logger.log('doPost: email なし → 400');
      return buildJsonResponse_({ ok: false, error: 'email required' });
    }

    var config = getSupabaseConfig_();
    var now    = new Date().toISOString();

    // 既存リード確認（同一emailが既にいるかチェック）
    var checkResp = UrlFetchApp.fetch(
      config.url + '/rest/v1/leads?email=eq.' + encodeURIComponent(email) + '&select=id,sequence_step&limit=1',
      {
        headers: { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key },
        muteHttpExceptions: true,
      }
    );
    var existing = JSON.parse(checkResp.getContentText()) || [];
    var isNew    = existing.length === 0;
    var leadId;

    if (isNew) {
      // 新規: シーケンス込みでINSERT
      var insertPayload = {
        name:              name || email,
        email:             email,
        phone:             phone || null,
        product:           product,
        source:            'selecttype',
        opted_in_email:    true,
        opted_out:         false,
        stage_key:         'new',
        attendance_token:  Utilities.getUuid(),
        unsubscribe_token: Utilities.getUuid(),
        created_at:        now,
      };
      var insResp = UrlFetchApp.fetch(
        config.url + '/rest/v1/leads',
        {
          method: 'post',
          headers: {
            'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
            'Content-Type': 'application/json', 'Prefer': 'return=representation',
          },
          payload:            JSON.stringify([insertPayload]),
          muteHttpExceptions: true,
        }
      );
      var insCode = insResp.getResponseCode();
      if (insCode < 200 || insCode >= 300) {
        throw new Error('INSERT エラー (HTTP ' + insCode + '): ' + insResp.getContentText());
      }
      var inserted = JSON.parse(insResp.getContentText()) || [];
      leadId = inserted[0] ? inserted[0].id : null;
      Logger.log('新規リード登録: ' + email + ' id=' + leadId);
      // v2エンジンに登録（enrolled イベントを発行し fan_out がシーケンスを開始）
      if (leadId) {
        try { enrollLeadV2_(leadId, product); } catch (ev2Err) {
          Logger.log('enrollLeadV2_ エラー（無視）: ' + ev2Err.message);
        }
      }
    } else {
      // 既存: 基本情報のみ更新（進行中シーケンスには触れない）
      leadId = existing[0].id;
      var patchPayload = { source: 'selecttype' };
      if (name)  patchPayload.name  = name;
      if (phone) patchPayload.phone = phone;
      UrlFetchApp.fetch(
        config.url + '/rest/v1/leads?id=eq.' + encodeURIComponent(leadId),
        {
          method: 'patch',
          headers: {
            'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
            'Content-Type': 'application/json', 'Prefer': 'return=minimal',
          },
          payload:            JSON.stringify(patchPayload),
          muteHttpExceptions: true,
        }
      );
      Logger.log('既存リード更新: ' + email + ' id=' + leadId + ' seq=' + existing[0].sequence_step);
    }

    // Slack通知
    try {
      var slackMsg = isNew
        ? '🆕 *新規申込* ' + (name || email) + '（' + email + '）\n商材: ' + product + ' / シーケンスStep1自動開始'
        : '🔄 *再申込* '   + (name || email) + '（' + email + '）\n商材: ' + product + '（既存リード / シーケンス継続）';
      sendSlackNotification_(slackMsg);
    } catch (slackErr) {
      Logger.log('Slack通知エラー（無視）: ' + slackErr.message);
    }

    return buildJsonResponse_({ ok: true, lead_id: leadId, is_new: isNew });

  } catch (err) {
    Logger.log('doPost エラー: ' + err.message);
    return buildJsonResponse_({ ok: false, error: 'internal_error' });
  }
}

function buildJsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// シーケンス手動登録（CRMドロワーのボタンから呼び出し）
// ============================================================

function enrollLeadFromWebApp(leadId, product) {
  assertAuthorized_();
  if (!leadId) throw new Error('leadId が必要です');
  enrollLeadV2_(leadId, product || 'B-1');
  return { ok: true };
}

// ============================================================
// CRM — 新規リード追加（手動登録）
// data: { name, email, phone, product, source, heat, assigned_to, startSequence }
// ============================================================

function createLead(data) {
  assertAuthorized_();
  var d = data || {};

  if (!d.email) throw new Error('メールアドレスは必須です');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
    throw new Error('メールアドレスの形式が正しくありません');
  }

  var config = getSupabaseConfig_();

  // 重複チェック（doPost と同パターン）
  var chk = UrlFetchApp.fetch(
    config.url + '/rest/v1/leads?email=eq.' + encodeURIComponent(d.email) + '&select=id&limit=1',
    { headers: { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key }, muteHttpExceptions: true }
  );
  if ((JSON.parse(chk.getContentText()) || []).length > 0) {
    throw new Error('このメールアドレスはすでに登録されています');
  }

  var now = new Date().toISOString();
  var payload = {
    name:              d.name || d.email,
    email:             d.email,
    phone:             d.phone             || null,
    product:           d.product           || 'B-1',
    source:            d.source            || 'manual',
    heat:              (['A','B','C'].indexOf(d.heat) !== -1) ? d.heat : 'C',
    assigned_to:       d.assigned_to       || null,
    stage_key:         'new',
    opted_out:         false,
    attendance_token:  Utilities.getUuid(),
    unsubscribe_token: Utilities.getUuid(),
    created_at:        now,
  };

  var insResp = UrlFetchApp.fetch(config.url + '/rest/v1/leads', {
    method: 'post',
    headers: {
      'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    },
    payload:            JSON.stringify([payload]),
    muteHttpExceptions: true,
  });

  var insCode = insResp.getResponseCode();
  if (insCode === 409) throw new Error('このメールアドレスはすでに登録されています');
  if (insCode < 200 || insCode >= 300) {
    throw new Error('リード登録エラー (HTTP ' + insCode + ')');
  }

  var inserted = JSON.parse(insResp.getContentText()) || [];
  var leadId   = inserted[0] ? inserted[0].id : null;
  var result   = { ok: true, lead_id: leadId };

  if (d.startSequence && leadId) {
    try {
      enrollLeadV2_(leadId, d.product || 'B-1');
    } catch (seqErr) {
      Logger.log('createLead SEQ開始エラー: ' + seqErr.message);
      result.seq_enroll_error = seqErr.message;
    }
  }

  Logger.log('createLead: 登録完了 ' + d.email + ' id=' + leadId);
  return result;
}

// ============================================================
// 一括シーケンス登録（sequence_step IS NULL のリードを一括登録）
// params: { product, heat, stageKeys, limit }
// ============================================================

var ALLOWED_PRODUCTS_ = ['B-1', 'B-2', 'A-1', 'A-2'];

function bulkEnrollLeads(params) {
  assertAuthorized_();
  var p       = params || {};
  var product = p.product || 'B-1';

  if (ALLOWED_PRODUCTS_.indexOf(product) === -1) {
    throw new Error('不正な product 値です: ' + product);
  }

  var config = getSupabaseConfig_();
  var limit  = Math.min(500, Math.max(1, p.limit || 500));

  var endpoint = config.url + '/rest/v1/leads'
    + '?select=id&opted_out=eq.false&sequence_step=is.null&limit=' + limit;

  // 熱度フィルタ（値をホワイトリストで検証）
  var validBulkHeat = (p.heat || []).filter(function(h){ return ['A','B','C'].indexOf(h) !== -1; });
  if (validBulkHeat.length > 0 && validBulkHeat.length < 3) {
    endpoint += '&heat=' + encodeURIComponent('in.(' + validBulkHeat.join(',') + ')');
  }

  // ステージフィルタ（既知スラッグのみ通す）
  var KNOWN_KEYS = ['new','approached','met','closed_won','closed_lost'];
  if (p.stageKeys && p.stageKeys.length > 0) {
    var vk = p.stageKeys.filter(function(k){ return KNOWN_KEYS.indexOf(k) !== -1; });
    if (vk.length > 0) {
      endpoint += '&stage_key=' + encodeURIComponent('in.(' + vk.map(function(k){ return '"'+k+'"'; }).join(',') + ')');
    }
  }

  var resp = UrlFetchApp.fetch(endpoint, {
    headers: { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('bulkEnrollLeads 取得エラー: ' + resp.getContentText());
  }

  var leads     = JSON.parse(resp.getContentText()) || [];
  var truncated = leads.length >= limit;
  var enrolled  = 0;
  var skipped   = 0;
  var partial   = false;
  var startMs   = Date.now();

  for (var i = 0; i < leads.length; i++) {
    if (Date.now() - startMs > MAX_EXECUTION_MS) {
      partial = true;
      Logger.log('bulkEnrollLeads: 時間上限で中断 (' + i + '/' + leads.length + '件処理済)');
      break;
    }
    try {
      enrollLeadInSequence(leads[i].id, product);
      enrolled++;
    } catch (e) {
      Logger.log('bulkEnrollLeads: skip id=' + leads[i].id + ' ' + e.message);
      skipped++;
    }
    Utilities.sleep(100);
  }

  Logger.log('bulkEnrollLeads: enrolled=' + enrolled + ' skipped=' + skipped + ' truncated=' + truncated + ' partial=' + partial);
  return { ok: true, enrolled: enrolled, skipped: skipped, truncated: truncated, partial: partial };
}

// ============================================================
// Slack通知（SLACK_SALES_WEBHOOK_URL プロパティを使用）
// ============================================================

function sendSlackNotification_(text) {
  var webhookUrl = PropertiesService.getScriptProperties().getProperty('SLACK_SALES_WEBHOOK_URL');
  if (!webhookUrl) {
    Logger.log('SLACK_SALES_WEBHOOK_URL 未設定 → Slack通知スキップ');
    return;
  }
  UrlFetchApp.fetch(webhookUrl, {
    method:             'post',
    headers:            { 'Content-Type': 'application/json' },
    payload:            JSON.stringify({ text: text }),
    muteHttpExceptions: true,
  });
}

// ============================================================
// 出席確認ページ（?action=attend&token=XXX）
// ============================================================

function handleAttendance_(token) {
  var wrap = function(title, body) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escHtml_(title) + '</title>' +
      '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#f0f4f8;display:flex;align-items:center;justify-content:center;min-height:100vh}' +
      '.card{background:#fff;border-radius:12px;padding:40px 32px;max-width:480px;width:90%;box-shadow:0 4px 16px rgba(0,0,0,.1);text-align:center}' +
      'h2{font-size:24px;margin-bottom:16px}.msg{color:#555;font-size:15px;line-height:1.6}.sub{color:#888;font-size:13px;margin-top:12px}</style></head>' +
      '<body><div class="card">' + body + '</div></body></html>'
    ).setTitle(title);
  };

  if (!token) {
    return wrap('無効なリンク', '<h2>⚠️ 無効なリンクです</h2><p class="msg">このリンクは無効か期限切れです。<br>運営にお問い合わせください。</p>');
  }

  try {
    // SECURITY DEFINER RPC 経由で更新（anon の直接UPDATE不要）
    var config = getSupabaseConfig_();
    var resp = UrlFetchApp.fetch(config.url + '/rest/v1/rpc/attend_by_token', {
      method: 'post',
      headers: {
        'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify({ p_token: token }),
      muteHttpExceptions: true,
    });
    var result = JSON.parse(resp.getContentText()) || {};
    Logger.log('attend_by_token: ' + JSON.stringify(result));

    if (!result.ok) {
      return wrap('無効なリンク', '<h2>⚠️ 無効なリンクです</h2><p class="msg">このリンクは無効か期限切れです。<br>運営にお問い合わせください。</p>');
    }

    var displayName = escHtml_(result.name || 'お客様');

    if (result.already) {
      return wrap('出席確認済み',
        '<h2 style="color:#2563eb">✅ 出席確認済みです</h2>' +
        '<p class="msg">' + displayName + ' 様の出席はすでに確認されています。</p>'
      );
    }

    // 初回出席確認 → Slack通知
    try {
      sendSlackNotification_('✅ *出席確認* ' + (result.name || '（名前なし）') + ' 様がセミナー出席を確認しました');
    } catch (_) {}

    return wrap('出席確認完了',
      '<h2 style="color:#16a34a">✅ 出席確認完了</h2>' +
      '<p class="msg">' + displayName + ' 様<br><br>ご出席ありがとうございます。<br>本日のセミナーをお楽しみください。</p>' +
      '<p class="sub">Success Japan株式会社</p>'
    );

  } catch (err) {
    Logger.log('handleAttendance_ エラー: ' + err.message);
    return wrap('エラー', '<h2>⚠️ エラーが発生しました</h2><p class="msg">しばらく時間をおいて再度お試しください。</p>');
  }
}

function handleUnsubscribe_(token) {
  var wrap = function(title, body) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escHtml_(title) + '</title>' +
      '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#f0f4f8;display:flex;align-items:center;justify-content:center;min-height:100vh}' +
      '.card{background:#fff;border-radius:12px;padding:40px 32px;max-width:480px;width:90%;box-shadow:0 4px 16px rgba(0,0,0,.1);text-align:center}' +
      'h2{font-size:22px;margin-bottom:16px}.msg{color:#555;font-size:15px;line-height:1.6}.sub{color:#888;font-size:13px;margin-top:12px}</style></head>' +
      '<body><div class="card">' + body + '</div></body></html>'
    ).setTitle(title);
  };

  if (!token) {
    return wrap('配信停止', '<h2>⚠️ 無効なリンクです</h2><p class="msg">このリンクは無効か期限切れです。</p>');
  }

  try {
    // SECURITY DEFINER RPC 経由（opted_out=true + sequence_step=0 のみ更新）
    var config = getSupabaseConfig_();
    var resp = UrlFetchApp.fetch(config.url + '/rest/v1/rpc/unsubscribe_by_token', {
      method: 'post',
      headers: {
        'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify({ p_token: token }),
      muteHttpExceptions: true,
    });
    var result = JSON.parse(resp.getContentText()) || {};
    Logger.log('unsubscribe_by_token: ' + JSON.stringify(result));

    if (!result.ok) {
      return wrap('配信停止', '<h2>⚠️ 無効なリンクです</h2><p class="msg">このリンクは無効か期限切れです。</p>');
    }

    var displayName = escHtml_(result.name || 'お客様');

    if (result.already) {
      return wrap('配信停止済み',
        '<h2 style="color:#888">配信停止済みです</h2>' +
        '<p class="msg">' + displayName + ' 様はすでに配信停止されています。</p>'
      );
    }

    return wrap('配信停止完了',
      '<h2 style="color:#555">配信停止が完了しました</h2>' +
      '<p class="msg">' + displayName + ' 様<br><br>メール配信を停止しました。<br>今後、弊社よりメールは送信されません。</p>' +
      '<p class="sub">Success Japan株式会社</p>'
    );

  } catch (err) {
    Logger.log('handleUnsubscribe_ エラー: ' + err.message);
    return wrap('エラー', '<h2>⚠️ エラーが発生しました</h2><p class="msg">しばらく時間をおいて再度お試しください。</p>');
  }
}

// ============================================================
// 面談予約受信（doPost action=meeting_booked）
// TimeRex / Calendly Webhook から呼ばれる想定
// data.email または data.lead_id でリードを特定する
// ============================================================

function handleMeetingBooked_(data) {
  try {
    var config  = getSupabaseConfig_();
    var leadId  = data['lead_id'] || '';
    var email   = data['email'] || data['Email'] || '';
    var product = data['product'] || null;

    // lead_id が未指定なら email で検索
    if (!leadId && email) {
      var sr = UrlFetchApp.fetch(
        config.url + '/rest/v1/leads?email=eq.' + encodeURIComponent(email) + '&select=id&limit=1',
        { headers: { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key }, muteHttpExceptions: true }
      );
      var found = JSON.parse(sr.getContentText()) || [];
      if (found.length > 0) leadId = found[0].id;
    }

    if (!leadId) {
      Logger.log('handleMeetingBooked_: リードが特定できません email=' + email);
      return buildJsonResponse_({ ok: false, error: 'lead_not_found' });
    }

    // record_meeting_booked RPC: meeting_booked=true + pending ランキャンセル + イベント発行
    var resp = UrlFetchApp.fetch(config.url + '/rest/v1/rpc/record_meeting_booked', {
      method: 'post',
      headers: {
        'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify({ p_lead_id: leadId, p_product: product }),
      muteHttpExceptions: true,
    });
    var result = JSON.parse(resp.getContentText()) || {};
    Logger.log('record_meeting_booked: leadId=' + leadId + ' result=' + JSON.stringify(result));

    // Slack通知
    try {
      sendSlackNotification_('📅 *面談予約* ' + (email || leadId) + ' 様が面談を予約しました（シーケンス停止済）');
    } catch (_) {}

    return buildJsonResponse_({ ok: true, lead_id: leadId, cancelled_runs: result.cancelled_runs });
  } catch (err) {
    Logger.log('handleMeetingBooked_ エラー: ' + err.message);
    return buildJsonResponse_({ ok: false, error: 'internal_error' });
  }
}

function escHtml_(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// CRM — ダッシュボード統計
// ============================================================

function getCrmStats() {
  assertAuthorized_();
  var config = getSupabaseConfig_();
  var stats  = { total: 0, active_seq: 0, this_week: 0, heat_a: 0 };

  var weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  var queries = [
    { key: 'total',      url: config.url + '/rest/v1/leads?select=id&opted_out=eq.false' },
    { key: 'active_seq', url: config.url + '/rest/v1/leads?select=id&sequence_step=gt.0&opted_out=eq.false' },
    { key: 'this_week',  url: config.url + '/rest/v1/leads?select=id&created_at=gte.' + encodeURIComponent(weekAgo) },
    { key: 'heat_a',     url: config.url + '/rest/v1/leads?select=id&heat=eq.A&opted_out=eq.false' },
  ];

  for (var i = 0; i < queries.length; i++) {
    try {
      var resp = UrlFetchApp.fetch(queries[i].url, {
        method: 'get',
        headers: {
          'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
          'Prefer': 'count=exact', 'Range': '0-0',
        },
        muteHttpExceptions: true,
      });
      var cr = resp.getHeaders()['Content-Range'] || '';
      var m  = cr.match(/\/(\d+)/);
      stats[queries[i].key] = m ? parseInt(m[1]) : 0;
    } catch (_) {}
  }

  return stats;
}

// ============================================================
// CRM — パイプラインステージ
// ============================================================

function getPipelineStages() {
  assertAuthorized_();
  var config = getSupabaseConfig_();
  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/pipeline_stages?select=*&order=sort_order.asc',
    { headers: { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key }, muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) {
    // B-1未実行の場合はデフォルト値を返す（後方互換）
    return [
      { key: 'new',        label: '未対応',       is_terminal: false, sort_order: 1 },
      { key: 'approached', label: 'アプローチ中', is_terminal: false, sort_order: 2 },
      { key: 'met',        label: '面談済',       is_terminal: false, sort_order: 3 },
      { key: 'closed_won', label: '成約',         is_terminal: true,  sort_order: 4 },
      { key: 'closed_lost','label': '失注',       is_terminal: true,  sort_order: 5 },
    ];
  }
  return JSON.parse(resp.getContentText()) || [];
}

// ============================================================
// CRM — リード一覧（ページング・フィルタ・ソート）
// ============================================================

function getCrmLeads(params) {
  assertAuthorized_();
  var config = getSupabaseConfig_();
  var p = params || {};

  var page     = Math.max(1, p.page || 1);
  var pageSize = Math.min(200, Math.max(10, p.pageSize || 50));
  var from     = (page - 1) * pageSize;
  var to       = from + pageSize - 1;

  var cols = [
    'id', 'name', 'email', 'phone', 'heat', 'status', 'stage_key',
    'assigned_to', 'source', 'product', 'last_marketed_at', 'last_contacted_at',
    'next_action_at', 'created_at', 'opted_out', 'sequence_step', 'sequence_enrolled_at',
  ].join(',');

  var endpoint = config.url + '/rest/v1/leads?select=' + cols;

  // 熱度フィルタ（値をホワイトリストで検証）
  var validHeat = (p.heat || []).filter(function(h){ return ['A','B','C'].indexOf(h) !== -1; });
  if (validHeat.length > 0 && validHeat.length < 3) {
    endpoint += '&heat=' + encodeURIComponent('in.(' + validHeat.join(',') + ')');
  }

  // ステージフィルタ（既知スラッグのみ通す）
  var KNOWN_STAGE_KEYS_ = ['new','approached','met','closed_won','closed_lost'];
  if (p.stageKeys && p.stageKeys.length > 0) {
    var validKeys = p.stageKeys.filter(function(k) { return KNOWN_STAGE_KEYS_.indexOf(k) !== -1; });
    if (validKeys.length > 0) {
      var list = validKeys.map(function(k) { return '"' + k + '"'; }).join(',');
      endpoint += '&stage_key=' + encodeURIComponent('in.(' + list + ')');
    }
  }

  // 担当者フィルタ
  if (p.assignedTo) {
    endpoint += '&assigned_to=eq.' + encodeURIComponent(p.assignedTo);
  }

  // opted_out フィルタ（デフォルトは含む）
  if (p.excludeOptedOut) {
    endpoint += '&opted_out=eq.false';
  }

  // 次回アクション超過のみ
  if (p.overdueOnly) {
    var nowIso = new Date().toISOString();
    endpoint += '&next_action_at=not.is.null&next_action_at=lt.' + encodeURIComponent(nowIso);
  }

  // フリーワード検索（ilike: *keyword*）
  if (p.search && p.search.trim()) {
    var kw = p.search.trim().replace(/[%_]/g, '\\$&');
    endpoint += '&or=' + encodeURIComponent(
      '(name.ilike.*' + kw + '*,email.ilike.*' + kw + '*,phone.ilike.*' + kw + '*)'
    );
  }

  // ソート
  var sortField = p.sortField || 'last_marketed_at';
  var safeFields = ['name','heat','stage_key','assigned_to','source','product',
                    'last_marketed_at','last_contacted_at','next_action_at','created_at'];
  if (safeFields.indexOf(sortField) === -1) sortField = 'last_marketed_at';
  var sortDir = p.sortDir === 'asc' ? '' : '.desc';
  endpoint += '&order=' + sortField + sortDir + '.nullslast';

  var resp = UrlFetchApp.fetch(endpoint, {
    method: 'get',
    headers: {
      'apikey':         config.key,
      'Authorization':  'Bearer ' + config.key,
      'Range':          from + '-' + to,
      'Prefer':         'count=exact',
    },
    muteHttpExceptions: true,
  });

  var code = resp.getResponseCode();
  if (code !== 200 && code !== 206) {
    throw new Error('Supabase getCrmLeads エラー (HTTP ' + code + '): ' + resp.getContentText());
  }

  // Content-Range: 0-49/1650
  var cr = resp.getHeaders()['Content-Range'] || '';
  var m  = cr.match(/\/(\d+)/);
  var total = m ? parseInt(m[1]) : 0;

  return {
    leads:    JSON.parse(resp.getContentText()) || [],
    total:    total,
    page:     page,
    pageSize: pageSize,
  };
}

// ============================================================
// CRM — リード詳細
// ============================================================

function getLeadDetail(id) {
  assertAuthorized_();
  if (!id) throw new Error('id が必要です');
  var config = getSupabaseConfig_();

  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/leads?id=eq.' + encodeURIComponent(id) + '&select=*&limit=1',
    { headers: { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key }, muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) {
    throw new Error('getLeadDetail エラー: ' + resp.getContentText());
  }
  var rows = JSON.parse(resp.getContentText()) || [];
  return rows[0] || null;
}

// ============================================================
// CRM — タイムライン（messages_log + lead_activities）
// ============================================================

function getLeadTimeline(leadId, offset) {
  assertAuthorized_();
  if (!leadId) throw new Error('leadId が必要です');
  var config  = getSupabaseConfig_();
  var _offset = Math.max(0, offset || 0);
  var limit   = 30;

  // lead_timeline VIEW を使用（B-1実行済み前提）
  // フォールバック: messages_log のみ
  var endpoint = config.url + '/rest/v1/lead_timeline'
    + '?lead_id=eq.' + encodeURIComponent(leadId)
    + '&order=ts.desc.nullslast'
    + '&limit=' + limit
    + '&offset=' + _offset;

  var resp = UrlFetchApp.fetch(endpoint, {
    method: 'get',
    headers: {
      'apikey':        config.key,
      'Authorization': 'Bearer ' + config.key,
      'Prefer':        'count=exact',
    },
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200 && resp.getResponseCode() !== 206) {
    // VIEW未作成の場合は messages_log にフォールバック
    return getLeadTimelineFallback_(leadId, _offset, config);
  }

  var cr    = resp.getHeaders()['Content-Range'] || '';
  var m     = cr.match(/\/(\d+)/);
  var total = m ? parseInt(m[1]) : 0;

  return { entries: JSON.parse(resp.getContentText()) || [], total: total, offset: _offset };
}

function getLeadTimelineFallback_(leadId, offset, config) {
  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/messages_log'
      + '?lead_id=eq.' + encodeURIComponent(leadId)
      + '&order=sent_at.desc&limit=30&offset=' + offset,
    {
      method: 'get',
      headers: { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key, 'Prefer': 'count=exact' },
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() !== 200 && resp.getResponseCode() !== 206) return { entries: [], total: 0, offset: 0 };
  var cr    = resp.getHeaders()['Content-Range'] || '';
  var m     = cr.match(/\/(\d+)/);
  var total = m ? parseInt(m[1]) : 0;
  var msgs  = (JSON.parse(resp.getContentText()) || []).map(function(msg) {
    return {
      id: msg.id, lead_id: msg.lead_id, entry_type: 'message',
      ts: msg.sent_at, actor: null, channel: msg.channel,
      subject: msg.subject, body: msg.body, msg_status: msg.status,
      campaign_id: msg.campaign_id, campaign_name: msg.campaign_name,
      activity_type: null, meta: null,
    };
  });
  return { entries: msgs, total: total, offset: offset };
}

// ============================================================
// CRM — フィールド更新（インライン編集）
// ============================================================

var EDITABLE_FIELDS_ = ['heat', 'stage_key', 'assigned_to', 'notes', 'next_action_at', 'opted_out', 'investable_capital_raw'];

function updateLeadField(id, field, value) {
  var actor = assertAuthorized_();
  if (!id || !field) throw new Error('id と field が必要です');
  if (EDITABLE_FIELDS_.indexOf(field) === -1) {
    throw new Error('編集不可フィールドです: ' + field);
  }

  var config = getSupabaseConfig_();
  var patch   = {};
  patch[field]       = value;
  patch['updated_by'] = actor;

  // PATCH leads
  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/leads?id=eq.' + encodeURIComponent(id),
    {
      method: 'patch',
      headers: {
        'apikey':          config.key,
        'Authorization':   'Bearer ' + config.key,
        'Content-Type':    'application/json',
        'Prefer':          'return=minimal',
      },
      payload:            JSON.stringify(patch),
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    throw new Error('updateLeadField エラー (HTTP ' + resp.getResponseCode() + '): ' + resp.getContentText());
  }

  // investable_capital_raw 変更時は investable_capital_yen も更新
  if (field === 'investable_capital_raw' && value) {
    var yen = parseCapitalYenGas_(value);
    if (yen !== null) {
      UrlFetchApp.fetch(
        config.url + '/rest/v1/leads?id=eq.' + encodeURIComponent(id),
        {
          method: 'patch',
          headers: {
            'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
            'Content-Type': 'application/json', 'Prefer': 'return=minimal',
          },
          payload: JSON.stringify({ investable_capital_yen: yen }),
          muteHttpExceptions: true,
        }
      );
    }
  }

  // stage_key 変更時はアクティビティを記録
  if (field === 'stage_key') {
    try {
      addLeadActivity_(id, actor, 'status_change', 'ステージ変更: → ' + value, { new_stage_key: value });
    } catch (e) {
      Logger.log('stage_change activity 記録エラー: ' + e.message);
    }
  }

  return { ok: true };
}

// ============================================================
// CRM — アクティビティ追加（メモ・通話記録等）
// ============================================================

// "3000万円" → 30000000 変換（GAS版）
function parseCapitalYenGas_(raw) {
  if (!raw) return null;
  var s = String(raw).replace(/,/g, '').replace(/\s/g, '');
  var m = s.match(/(\d+(?:\.\d+)?)\s*(億|万)?/);
  if (!m) return null;
  var num = parseFloat(m[1]);
  if (isNaN(num)) return null;
  if (m[2] === '億') return Math.round(num * 100000000);
  if (m[2] === '万') return Math.round(num * 10000);
  return Math.round(num);
}

var VALID_ACTIVITY_TYPES_ = ['memo','call','meeting','note','status_change','field_change'];

function addLeadActivity(leadId, type, body) {
  var actor = assertAuthorized_();
  if (VALID_ACTIVITY_TYPES_.indexOf(type) === -1) {
    throw new Error('不正なアクティビティタイプです: ' + type);
  }
  return addLeadActivity_(leadId, actor, type, body, {});
}

function addLeadActivity_(leadId, actor, type, body, meta) {
  var config = getSupabaseConfig_();
  var payload = {
    lead_id: leadId,
    actor:   actor,
    type:    type || 'memo',
    body:    body || '',
    meta:    meta || {},
  };
  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/lead_activities',
    {
      method: 'post',
      headers: {
        'apikey':          config.key,
        'Authorization':   'Bearer ' + config.key,
        'Content-Type':    'application/json',
        'Prefer':          'return=minimal',
      },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    throw new Error('addLeadActivity エラー (HTTP ' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  return { ok: true };
}

// ============================================================
// 一斉送信 — リードプレビュー
// ============================================================

function previewLeads(filters) {
  assertAuthorized_();
  var leads = fetchFilteredLeads_(filters);
  return {
    count: leads.length,
    leads: leads.slice(0, 200).map(function(l) {
      return {
        id:               l.id,
        name:             l.name             || '（名前なし）',
        email:            l.email,
        heat:             l.heat             || 'C',
        status:           l.status           || '未対応',
        stage_key:        l.stage_key        || 'new',
        last_marketed_at: l.last_marketed_at || null,
      };
    }),
  };
}

// ============================================================
// 一斉送信 — メール一斉送信
// params: { filters, subject, body, senderName, isDryRun }
// ============================================================

function executeBulkEmail(params) {
  assertAuthorized_();
  var leads  = fetchFilteredLeads_(params.filters);
  var result = { sent: 0, skipped: 0, errors: [], dryRun: params.isDryRun };

  if (leads.length === 0) return result;

  var campaignId   = Utilities.getUuid();
  var campaignName = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd') + '_email_bulk';
  var senderName   = params.senderName || 'Success Japan';
  var logRows      = [];

  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    var personalizedBody    = params.body.replace(/{name}/g, lead.name || 'お客様');
    var personalizedSubject = params.subject.replace(/{name}/g, lead.name || 'お客様');
    var dedupKey = lead.id + '_' + campaignId;

    if (params.isDryRun) {
      result.sent++;
      continue;
    }

    try {
      // HTML版はXSS防止のため名前をエスケープして別途生成
      var escBody = params.body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      var escName = (lead.name || 'お客様').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      var htmlBodyStr = escBody.replace(/{name}/g, escName).replace(/\n/g, '<br>');
      GmailApp.sendEmail(lead.email, personalizedSubject, personalizedBody, {
        name:     senderName,
        htmlBody: htmlBodyStr,
      });

      logRows.push({
        lead_id: lead.id, channel: 'email', subject: personalizedSubject,
        body: personalizedBody, status: 'sent', campaign_id: campaignId,
        campaign_name: campaignName, sent_by: 'manual', dedup_key: dedupKey,
      });
      result.sent++;
    } catch (e) {
      logRows.push({
        lead_id: lead.id, channel: 'email', subject: personalizedSubject,
        body: personalizedBody, status: 'failed', error: e.message,
        campaign_id: campaignId, campaign_name: campaignName, sent_by: 'manual', dedup_key: dedupKey,
      });
      result.errors.push({ name: lead.name, email: lead.email, error: e.message });
    }

    Utilities.sleep(150);
  }

  if (logRows.length > 0) {
    try { supabaseInsert('messages_log', logRows); } catch (e) {
      Logger.log('messages_log記録エラー: ' + e.message);
    }
  }

  result.campaignId = campaignId;
  return result;
}

// ============================================================
// 内部 — フィルタ済みリード取得（一斉送信用）
// ============================================================

function fetchFilteredLeads_(filters) {
  var config = getSupabaseConfig_();
  var f = filters || {};

  // 基本: opted_out=false, email あり（一斉送信に必要な列のみ取得）
  var bulkCols = 'id,name,email,heat,status,stage_key,last_marketed_at,created_at';
  var endpoint = config.url + '/rest/v1/leads?select=' + bulkCols
    + '&opted_out=eq.false&email=not.is.null&limit=5000';

  // 熱度フィルタ
  if (f.heat && f.heat.length > 0) {
    endpoint += '&heat=' + encodeURIComponent('in.(' + f.heat.join(',') + ')');
  }

  // ステータス/ステージフィルタ
  if (f.status && f.status.length > 0) {
    var statusList = f.status.map(function(s) { return '"' + s + '"'; }).join(',');
    endpoint += '&status=' + encodeURIComponent('in.(' + statusList + ')');
  } else {
    // デフォルト: ターミナルステージ除外
    // stage_key が設定されている場合は stage_key で判定、なければ status で判定
    endpoint += '&stage_key=' + encodeURIComponent('not.in.(closed_won,closed_lost)');
  }

  var resp = UrlFetchApp.fetch(endpoint, {
    method:             'get',
    headers:            { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key },
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('Supabaseクエリエラー: ' + resp.getContentText());
  }

  var leads = JSON.parse(resp.getContentText()) || [];

  // 日付フィルタ（GAS側評価）
  if (f.daysSinceMarketed && f.daysSinceMarketed > 0) {
    var threshold = Date.now() - f.daysSinceMarketed * 24 * 60 * 60 * 1000;
    leads = leads.filter(function(l) {
      var lastAt = l.last_marketed_at
        ? new Date(l.last_marketed_at).getTime()
        : new Date(l.created_at).getTime();
      return lastAt <= threshold;
    });
  }

  return leads;
}
