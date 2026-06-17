// ============================================================
// EventProcessor.gs — イベント駆動シーケンスエンジン (v2)
// sequence_version=2 のリードを対象にイベントを処理する
// SequenceEngine.gs (v1) と並行稼働可能
// ============================================================

/**
 * メインエントリーポイント（5分おきのトリガーから呼ばれる）
 * runSequenceEngine() の直後に同じトリガーで呼び出す。
 * 将来的には runSequenceEngine を廃止してこちらに一本化する。
 */
function runEventEngine() {
  Logger.log('=== EventProcessor 開始 ===');

  var config = getSupabaseConfig_();

  // ① 未処理イベントをファンアウト（子ノードを lead_sequence_runs に予約）
  var fanOutCount = callRpc_(config, 'fan_out_lead_events', { p_limit: 50 });
  if (fanOutCount === null) {
    Logger.log('fan_out_lead_events 失敗 → 送信スキップ');
    return;
  }
  Logger.log('fan_out_lead_events: ' + fanOutCount + ' イベント処理済み');

  // ② Gmailクォータ確認
  var quotaRemaining = MailApp.getRemainingDailyQuota();
  Logger.log('Gmail残クォータ: ' + quotaRemaining + '件');
  if (quotaRemaining <= 0) {
    Logger.log('⚠ Gmailクォータ枯渇 → 送信をスキップ');
    return;
  }

  // ③ 送信対象を取得（8分ロック取得済み）
  var runs = claimDueRuns_(config, 10);
  if (!runs || runs.length === 0) {
    Logger.log('送信対象なし');
    return;
  }

  Logger.log('送信対象: ' + runs.length + '件');

  var webAppUrl = '';
  try { webAppUrl = ScriptApp.getService().getUrl(); } catch (_) {}
  var senderName = PropertiesService.getScriptProperties().getProperty('SEQUENCE_SENDER_NAME') || 'Success Japan';

  var sent = 0, skipped = 0, errors = 0;

  for (var i = 0; i < runs.length; i++) {
    var run = runs[i];
    try {
      var result = processRun_(run, webAppUrl, senderName, config);
      if (result === 'sent')    sent++;
      else if (result === 'skip') skipped++;
    } catch (e) {
      errors++;
      Logger.log('ERROR [' + run.lead_name + ' / ' + run.node_key + ']: ' + e.message);
      markRunFailed_(config, run.run_id);
    }
    Utilities.sleep(200);
  }

  Logger.log('=== 完了: 送信' + sent + '件 / スキップ' + skipped + '件 / エラー' + errors + '件 ===');
}

/**
 * 1件の run を処理して送信する
 * @returns {'sent'|'skip'}
 */
function processRun_(run, webAppUrl, senderName, config) {
  var subject = renderTemplate_(run.subject || '', run, webAppUrl);
  var body    = renderTemplate_(run.body    || '', run, webAppUrl);

  if (run.channel === 'email') {
    if (!run.lead_email) {
      Logger.log('  ' + run.lead_name + ' / ' + run.node_key + ': メールアドレスなし → スキップ');
      completeRun_(config, run.run_id, 'skipped');
      return 'skip';
    }
    var escBody = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    GmailApp.sendEmail(run.lead_email, subject, body, {
      name:     senderName,
      htmlBody: escBody.replace(/\n/g, '<br>'),
    });
    Logger.log('  ✅ ' + run.lead_name + ' → email [' + run.node_key + ']');

  } else if (run.channel === 'line') {
    if (!run.line_uid) {
      Logger.log('  ' + run.lead_name + ' / ' + run.node_key + ': LINE UID なし → スキップ');
      completeRun_(config, run.run_id, 'skipped');
      return 'skip';
    }
    sendLineMessage_(run.line_uid, body);
    Logger.log('  ✅ ' + run.lead_name + ' → LINE [' + run.node_key + ']');

  } else {
    Logger.log('  ' + run.node_key + ': 未対応チャンネル "' + run.channel + '" → スキップ');
    completeRun_(config, run.run_id, 'skipped');
    return 'skip';
  }

  // messages_log 記録（送信失敗時も complete_run は呼ぶため try-catch で分離）
  try {
    supabaseInsert('messages_log', [{
      lead_id:       run.lead_id,
      channel:       run.channel,
      subject:       subject,
      body:          body,
      status:        'sent',
      campaign_id:   'ev2_' + run.product + '_' + run.node_key,
      campaign_name: 'EventEngine ' + run.product + ' ' + run.node_key,
      sent_by:       'auto',
      dedup_key:     run.run_id,
    }]);
  } catch (e) {
    Logger.log('  messages_log記録エラー（送信自体は成功）: ' + e.message);
  }

  // complete_run が node_sent イベントを発行し、次ノードの fan_out をトリガーする
  completeRun_(config, run.run_id, 'sent');
  return 'sent';
}

/**
 * テンプレート文字列の変数を置換する
 * 対応プレースホルダー:
 *   {name} {attend_url} {unsubscribe_url} {seminar_date}
 */
function renderTemplate_(text, run, webAppUrl) {
  var name = run.lead_name || 'お客様';
  text = text.replace(/{name}/g, name);

  // {attend_url} / {unsubscribe_url}: URL生成できない場合でも必ずプレースホルダーを除去する
  var attendUrl = (webAppUrl && run.attendance_token)
    ? webAppUrl + '?action=attend&token=' + encodeURIComponent(run.attendance_token)
    : '（出席確認リンクは管理者にご確認ください）';
  var unsubUrl = (webAppUrl && run.unsubscribe_token)
    ? webAppUrl + '?action=unsubscribe&token=' + encodeURIComponent(run.unsubscribe_token)
    : '（配信停止は admin@successjapan.jp までご連絡ください）';
  text = text.replace(/{attend_url}/g, attendUrl);
  text = text.replace(/{unsubscribe_url}/g, unsubUrl);

  // {seminar_date}: 未設定の場合はプレースホルダーを空に
  if (run.seminar_date) {
    var sd = new Date(run.seminar_date);
    var seminarStr = Utilities.formatDate(sd, 'Asia/Tokyo', 'M月d日(EEE) HH:mm');
    text = text.replace(/{seminar_date}/g, seminarStr);
  } else {
    text = text.replace(/{seminar_date}/g, '（日時未設定）');
  }

  return text;
}

// ──────────────────────────────────────────────
// Supabase RPC ラッパー
// ──────────────────────────────────────────────

/**
 * 汎用 RPC 呼び出し（JSONをそのまま返す）
 */
function callRpc_(config, rpcName, params) {
  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/rpc/' + rpcName,
    {
      method: 'post',
      headers: {
        'apikey':        config.key,
        'Authorization': 'Bearer ' + config.key,
        'Content-Type':  'application/json',
      },
      payload:            JSON.stringify(params || {}),
      muteHttpExceptions: true,
    }
  );
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log('RPC ' + rpcName + ' エラー (HTTP ' + code + '): ' + resp.getContentText());
    return null;
  }
  return JSON.parse(resp.getContentText());
}

function claimDueRuns_(config, limit) {
  var result = callRpc_(config, 'claim_due_runs', { p_limit: limit });
  return Array.isArray(result) ? result : [];
}

function completeRun_(config, runId, status) {
  var result = callRpc_(config, 'complete_run', { p_run_id: runId, p_status: status });
  if (!result || !result.ok) {
    Logger.log('complete_run 失敗: runId=' + runId + ' result=' + JSON.stringify(result));
  }
}

function markRunFailed_(config, runId) {
  completeRun_(config, runId, 'failed');
}

/**
 * リードを v2 エンジンに登録する（WebApp.gs の doPost から呼ぶ）
 * enroll_lead_v2 RPC を通じて enrolled イベントを発行する
 */
function enrollLeadV2_(leadId, product) {
  var config = getSupabaseConfig_();
  var result = callRpc_(config, 'enroll_lead_v2', {
    p_lead_id: leadId,
    p_product:  product || 'B-1',
  });
  if (!result || !result.ok) {
    throw new Error('enroll_lead_v2 失敗: ' + JSON.stringify(result));
  }
  Logger.log('enrollLeadV2_: ' + leadId + ' → ' + (product || 'B-1') + (result.already ? ' (already enrolled)' : ''));
}

/**
 * セミナー欠席フラグを立てる（デイリートリガーから呼ぶ）
 * runDailyAlerts() と同じトリガーに乗せるか、独立したトリガーを立てる
 */
function runAbsentSweep() {
  var config = getSupabaseConfig_();
  var count  = callRpc_(config, 'mark_absent_after_seminar', {});
  Logger.log('mark_absent_after_seminar: ' + count + '件の absent イベントを発行');
}

// ============================================================
// セットアップ用ユーティリティ
// ============================================================

/**
 * 既存の runSequenceEngine トリガーを runEventEngine に統合する場合に使用。
 * 現時点では runSequenceEngine と共存させるため、
 * setupSequenceTrigger() のトリガーハンドラに runEventEngine を追加する方法を推奨。
 *
 * 単独でテストしたい場合のみ呼び出す。
 */
function setupEventEngineTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'runEventEngine'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('runEventEngine')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('✅ 5分おきの runEventEngine トリガーを設定しました');
}
