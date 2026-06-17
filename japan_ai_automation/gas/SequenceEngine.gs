// ============================================================
// SequenceEngine.gs — メールシーケンス自動送信エンジン
// 5分おきのトリガーで実行する
// ============================================================

/**
 * メインエントリーポイント（時間トリガーに登録する）
 * setupSequenceTrigger() で5分おきのトリガーを設定する
 */
function runSequenceEngine() {
  Logger.log('=== SequenceEngine 開始 ===');

  var config = getSupabaseConfig_();

  // 送信対象リードをロック取得（重複送信防止・8分ロック）
  var leads = claimLeadsForSending_(config, 10);
  if (!leads || leads.length === 0) {
    Logger.log('送信対象なし');
    return;
  }

  // Gmail残クォータチェック（Gmail無料: 500/日、Workspace: 1500/日）
  var quotaRemaining = MailApp.getRemainingDailyQuota();
  Logger.log('Gmail残クォータ: ' + quotaRemaining + '件');
  if (quotaRemaining <= 0) {
    Logger.log('⚠ Gmailクォータ枯渇 → 全リードのロックを解除して終了');
    for (var qi = 0; qi < leads.length; qi++) { unlockLead_(leads[qi].id, config); }
    return;
  }

  Logger.log('対象リード: ' + leads.length + '件');

  // シーケンス定義を取得
  var sequences = fetchSequences_(config);

  var sent = 0, skipped = 0, errors = 0;

  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    try {
      var result = processLead_(lead, sequences, config);
      if (result === 'sent')      sent++;
      else if (result === 'done') skipped++;
      else                        skipped++;
    } catch (e) {
      errors++;
      Logger.log('ERROR [' + lead.name + ']: ' + e.message);
      // エラー時はロックを解除して次回リトライできるようにする
      unlockLead_(lead.id, config);
    }
    Utilities.sleep(300); // Brevo レートリミット対策
  }

  Logger.log('=== 完了: 送信' + sent + '件 / スキップ' + skipped + '件 / エラー' + errors + '件 ===');

  // v2エンジンも同じトリガーで実行（新規登録リードを処理）
  runEventEngine();
}

/**
 * 1リードのシーケンス処理
 * @returns {'sent'|'done'|'skip'}
 */
function processLead_(lead, sequences, config) {
  var step = lead.sequence_step;

  // ステップ0または負数 = シーケンス完了
  if (!step || step <= 0) {
    unlockLead_(lead.id, config);
    return 'done';
  }

  // 該当ステップのシーケンス定義を取得
  var seqDef = sequences.filter(function(s) {
    return s.product === lead.product && s.step === step && s.active;
  })[0];

  if (!seqDef) {
    // 定義がない = このステップは存在しない → シーケンス完了
    Logger.log('  ' + lead.name + ': step ' + step + ' 定義なし → 完了');
    advanceLeadStep_(lead.id, 0, config); // 0 = 完了
    return 'done';
  }

  // 送信タイミングチェック（delay_hours）
  var enrolledAt = new Date(lead.sequence_enrolled_at).getTime();
  var delayHours = Number(seqDef.delay_hours);
  if (isNaN(delayHours)) delayHours = 0;
  var stepDelay  = delayHours * 60 * 60 * 1000;

  // シーケンス専用タイムスタンプで基準時刻を計算（CRM汎用のlast_marketed_atは使わない）
  var baseTime = lead.last_sequence_sent_at
    ? new Date(lead.last_sequence_sent_at).getTime()
    : enrolledAt;

  if (Date.now() < baseTime + stepDelay) {
    // まだ送信時刻ではない → ロック解除して戻す
    Logger.log('  ' + lead.name + ': step ' + step + ' 送信待ち（あと' +
      Math.ceil((baseTime + stepDelay - Date.now()) / 3600000) + '時間）');
    unlockLead_(lead.id, config);
    return 'skip';
  }

  // 重複送信チェック（前回実行でメール送信済みだがstep更新が失敗した場合を防ぐ）
  var dedupKey = lead.id + '_seq_' + lead.product + '_step' + step;
  var dedupResp = UrlFetchApp.fetch(
    config.url + '/rest/v1/messages_log?dedup_key=eq.' + encodeURIComponent(dedupKey) + '&select=id&limit=1',
    { headers: { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key }, muteHttpExceptions: true }
  );
  if (dedupResp.getResponseCode() === 200 && (JSON.parse(dedupResp.getContentText()) || []).length > 0) {
    Logger.log('  ' + lead.name + ': step ' + step + ' 送信済み(dedup検出) → 次ステップへ進める');
    var ndStep = step + 1;
    var hasNd  = sequences.some(function(s) { return s.product === lead.product && s.step === ndStep && s.active; });
    advanceLeadStep_(lead.id, hasNd ? ndStep : 0, config);
    return 'skip';
  }

  // 配信停止の直前チェック（ロック取得後に配信停止された場合を防ぐ）
  if (lead.opted_out || lead.sequence_step <= 0) {
    Logger.log('  ' + lead.name + ': 配信停止済み or シーケンス完了 → スキップ');
    unlockLead_(lead.id, config);
    return 'skip';
  }

  // 送信実行
  var subject = seqDef.subject || '';
  var body    = seqDef.body || '';
  var name    = lead.name || 'お客様';

  subject = subject.replace(/{name}/g, name);
  body    = body.replace(/{name}/g, name);

  // 出席確認・配信停止 URL の動的置換（トークンは別々）
  try {
    var webAppUrl = ScriptApp.getService().getUrl();
    if (webAppUrl) {
      var attendUrl = lead.attendance_token
        ? webAppUrl + '?action=attend&token='      + encodeURIComponent(lead.attendance_token)
        : '';
      var unsubUrl  = lead.unsubscribe_token
        ? webAppUrl + '?action=unsubscribe&token=' + encodeURIComponent(lead.unsubscribe_token)
        : '';
      if (attendUrl) {
        subject = subject.replace(/{attend_url}/g, attendUrl);
        body    = body.replace(/{attend_url}/g, attendUrl);
      }
      if (unsubUrl) {
        subject = subject.replace(/{unsubscribe_url}/g, unsubUrl);
        body    = body.replace(/{unsubscribe_url}/g, unsubUrl);
      }
    }
  } catch (_) {}

  if (seqDef.channel === 'email') {
    if (!lead.email) {
      Logger.log('  ' + lead.name + ': メールアドレスなし → スキップ');
      unlockLead_(lead.id, config);
      return 'skip';
    }
    var senderName = PropertiesService.getScriptProperties().getProperty('SEQUENCE_SENDER_NAME') || 'Success Japan';
    var escBody = body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    GmailApp.sendEmail(lead.email, subject, body, {
      name:     senderName,
      htmlBody: escBody.replace(/\n/g, '<br>'),
    });
    Logger.log('  ✅ ' + lead.name + ' → email step ' + step);
  } else if (seqDef.channel === 'line') {
    if (!lead.line_uid) {
      Logger.log('  ' + lead.name + ': LINE UID なし → スキップ');
      unlockLead_(lead.id, config);
      return 'skip';
    }
    sendLineMessage_(lead.line_uid, body);
    Logger.log('  ✅ ' + lead.name + ' → LINE step ' + step);
  }

  // messages_log 記録
  var campaignId = 'seq_' + lead.product + '_step' + step;
  try {
    supabaseInsert('messages_log', [{
      lead_id:       lead.id,
      channel:       seqDef.channel,
      subject:       subject,
      body:          body,
      status:        'sent',
      campaign_id:   campaignId,
      campaign_name: 'Sequence ' + lead.product + ' Step' + step,
      sent_by:       'auto',
      dedup_key:     lead.id + '_' + campaignId,
    }]);
  } catch (e) {
    Logger.log('  messages_log記録エラー（送信自体は成功）: ' + e.message);
  }

  // 次ステップへ進める（次のステップ定義があるかチェック）
  var nextStep = step + 1;
  var hasNext  = sequences.some(function(s) {
    return s.product === lead.product && s.step === nextStep && s.active;
  });
  advanceLeadStep_(lead.id, hasNext ? nextStep : 0, config);

  return 'sent';
}

// ──────────────────────────────────────────────

function claimLeadsForSending_(config, limit) {
  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/rpc/claim_leads_for_sending',
    {
      method: 'post',
      headers: {
        'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify({ p_limit: limit }),
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() !== 200) {
    Logger.log('claim_leads_for_sending エラー: ' + resp.getContentText());
    return [];
  }
  return JSON.parse(resp.getContentText()) || [];
}

function fetchSequences_(config) {
  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/sequences?select=*&active=eq.true&order=product.asc,step.asc',
    {
      headers: { 'apikey': config.key, 'Authorization': 'Bearer ' + config.key },
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() !== 200) return [];
  return JSON.parse(resp.getContentText()) || [];
}

function advanceLeadStep_(leadId, nextStep, config) {
  var now = new Date().toISOString();
  var patch = {
    sequence_step:         nextStep,
    last_marketed_at:      now,   // CRM全体の最終AT（汎用）
    last_sequence_sent_at: now,   // シーケンス専用（タイミング計算用）
  };
  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/leads?id=eq.' + encodeURIComponent(leadId),
    {
      method: 'patch',
      headers: {
        'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      payload: JSON.stringify(patch),
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    Logger.log('advanceLeadStep_ エラー (HTTP ' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
}

function unlockLead_(leadId, config) {
  var resp = UrlFetchApp.fetch(
    config.url + '/rest/v1/leads?id=eq.' + encodeURIComponent(leadId),
    {
      method: 'patch',
      headers: {
        'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      payload: JSON.stringify({ sending_locked_until: null }),
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    Logger.log('unlockLead_ エラー (HTTP ' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
}

function sendLineMessage_(lineUid, text) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');

  var resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type':  'application/json',
    },
    payload: JSON.stringify({
      to:       lineUid,
      messages: [{ type: 'text', text: text }],
    }),
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('LINE送信エラー (HTTP ' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
}

// ============================================================
// セットアップ用ユーティリティ
// ============================================================

/**
 * 5分おきのシーケンストリガーを設定（初回のみ手動実行）
 */
function setupSequenceTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'runSequenceEngine'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('runSequenceEngine')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('✅ 5分おきのシーケンストリガーを設定しました');
}

/**
 * リードをシーケンスに手動登録する（テスト用）
 * 例: enrollLeadInSequence('lead-uuid-here', 'B-1')
 */
function enrollLeadInSequence(leadId, product) {
  var config          = getSupabaseConfig_();
  var attendanceToken = Utilities.getUuid();  // 出席確認専用
  var unsubscribeToken= Utilities.getUuid();  // 配信停止専用（トークンを分離）
  UrlFetchApp.fetch(
    config.url + '/rest/v1/leads?id=eq.' + encodeURIComponent(leadId),
    {
      method: 'patch',
      headers: {
        'apikey': config.key, 'Authorization': 'Bearer ' + config.key,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      payload: JSON.stringify({
        sequence_step:        1,
        sequence_enrolled_at: new Date().toISOString(),
        product:              product || 'B-1',
        attendance_token:     attendanceToken,
        unsubscribe_token:    unsubscribeToken,
        opted_in_email:       true,   // claim_leads_for_sending の条件
      }),
      muteHttpExceptions: true,
    }
  );
  Logger.log('✅ 登録完了: ' + leadId + ' → ' + (product || 'B-1') + ' Step 1');
}
