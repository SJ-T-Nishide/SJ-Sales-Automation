// ============================================================
// AlertEngine.gs — 追客アラートルール評価 → Slack通知
// 毎朝8時のトリガーで実行
// ============================================================

// メインエントリーポイント（時間トリガーに登録する関数）
function runDailyAlerts() {
  Logger.log('=== 追客アラートチェック開始 ===');

  const rules = supabaseSelect('alert_rules', { active: true });

  if (!rules || rules.length === 0) {
    Logger.log('有効なアラートルールがありません');
    return;
  }

  let totalAlerts = 0;

  for (const rule of rules) {
    Logger.log(`\nルール評価: ${rule.name}`);
    const leads = fetchLeadsForAlert_(rule.condition);
    Logger.log(`  対象リード: ${leads.length}件`);

    for (const lead of leads) {
      sendSlackAlert_(lead, rule);
      totalAlerts++;

      // Slack レートリミット対策
      Utilities.sleep(300);
    }

    // ルールの最終実行日時を更新（SECURITY DEFINER RPC 経由）
    markAlertRuleRun_(rule.id);
  }

  Logger.log(`\n=== アラート完了: ${totalAlerts}件通知 ===`);

  // v2エンジン: セミナー日時超過の未出席リードに absent イベントを発行
  try {
    runAbsentSweep();
  } catch (e) {
    Logger.log('runAbsentSweep エラー（無視）: ' + e.message);
  }
}

// アラート条件に合致するリードをSupabaseから取得
function fetchLeadsForAlert_(condition) {
  const { url, key } = getSupabaseConfig_();

  // 基本フィルタ: 配信停止でないリード（必要列のみ取得）
  const alertCols = 'id,name,phone,email,source,heat,status,stage_key,assigned_to,last_marketed_at,last_contacted_at,next_action_at,created_at';
  let endpoint = `${url}/rest/v1/leads?opted_out=eq.false&select=${alertCols}`;

  // next_action_overdue: サーバー側フィルタ（GAS側評価の前段として件数削減）
  if (condition.next_action_overdue) {
    const nowIso = new Date().toISOString();
    endpoint += `&next_action_at=not.is.null&next_action_at=lt.${encodeURIComponent(nowIso)}`;
  }

  // status_not_in フィルタ（旧フィールド互換）
  if (condition.status_not_in && condition.status_not_in.length > 0) {
    const statusList = condition.status_not_in.map(s => `"${s}"`).join(',');
    endpoint += `&status=${encodeURIComponent('not.in.(' + statusList + ')')}`;
  }

  // stage_key_not_in フィルタ（pipeline_stages キーで除外）
  if (condition.stage_key_not_in && condition.stage_key_not_in.length > 0) {
    const stageList = condition.stage_key_not_in.map(s => `"${s}"`).join(',');
    endpoint += `&stage_key=${encodeURIComponent('not.in.(' + stageList + ')')}`;
  }

  // heat_in フィルタ
  if (condition.heat_in && condition.heat_in.length > 0) {
    const heatList = condition.heat_in.join(',');
    endpoint += `&heat=${encodeURIComponent('in.(' + heatList + ')')}`;
  }

  // product フィルタ
  if (condition.product) {
    endpoint += `&product=${encodeURIComponent('eq.' + condition.product)}`;
  }

  const props = PropertiesService.getScriptProperties();
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'get',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`ERROR: Supabaseクエリ失敗: ${response.getContentText()}`);
    return [];
  }

  const allLeads = JSON.parse(response.getContentText()) || [];

  // days_since_last_marketed フィルタ（GAS側で評価）
  return allLeads.filter(lead => evaluateTimingCondition_(lead, condition));
}

// タイミング条件の評価（GAS側で実行）
function evaluateTimingCondition_(lead, condition) {
  const now = Date.now();

  if (condition.days_since_last_marketed) {
    const lastMarketed = lead.last_marketed_at
      ? new Date(lead.last_marketed_at).getTime()
      : new Date(lead.created_at).getTime();
    const daysSince = (now - lastMarketed) / (1000 * 60 * 60 * 24);
    if (daysSince < condition.days_since_last_marketed) return false;
  }

  if (condition.days_since_last_contacted) {
    const lastContacted = lead.last_contacted_at
      ? new Date(lead.last_contacted_at).getTime()
      : new Date(lead.created_at).getTime();
    const daysSince = (now - lastContacted) / (1000 * 60 * 60 * 24);
    if (daysSince < condition.days_since_last_contacted) return false;
  }

  // next_action_overdue: true の場合は next_action_at が過去のリードのみ対象
  if (condition.next_action_overdue) {
    if (!lead.next_action_at) return false;
    if (new Date(lead.next_action_at).getTime() > now) return false;
  }

  return true;
}

// Slackにアラート通知を送信
function sendSlackAlert_(lead, rule) {
  const slackWebhookUrl = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
  if (!slackWebhookUrl) {
    Logger.log('WARNING: SLACK_WEBHOOK_URL が未設定です');
    return;
  }

  const daysSinceMarketed = lead.last_marketed_at
    ? Math.floor((Date.now() - new Date(lead.last_marketed_at).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const nextActionOverdueDays = lead.next_action_at
    ? Math.floor((Date.now() - new Date(lead.next_action_at).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // テンプレート変数を置換
  let message = rule.message_template
    .replace('{name}',                    lead.name          || '（名前不明）')
    .replace('{phone}',                   lead.phone         || '（電話なし）')
    .replace('{email}',                   lead.email         || '（メールなし）')
    .replace('{source}',                  lead.source        || '（流入元不明）')
    .replace('{heat}',                    lead.heat          || 'C')
    .replace('{status}',                  lead.status        || '未対応')
    .replace('{days_since_marketed}',     daysSinceMarketed !== null ? `${daysSinceMarketed}日` : '不明')
    .replace('{next_action_at}',          lead.next_action_at ? lead.next_action_at.slice(0, 10) : '未設定')
    .replace('{next_action_overdue_days}',nextActionOverdueDays !== null ? `${nextActionOverdueDays}日超過` : '未設定');

  // 担当者メンション
  let mention = '';
  if (rule.mention_assigned_to && lead.assigned_to) {
    const slackMentions = getSlackMentions_();
    mention = slackMentions[lead.assigned_to]
      ? `<${slackMentions[lead.assigned_to]}> ` : `${lead.assigned_to} `;
  }

  const payload = {
    text: mention + message,
    channel: rule.notify_slack_channel || '#sales-alerts',
  };

  UrlFetchApp.fetch(slackWebhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  Logger.log(`  Slack通知: ${lead.name} (${lead.heat}熱)`);
}

// 担当者名 → Slack メンション ID マップ
// PropertiesService に "SLACK_MENTION_西出" = "@U12345678" 形式で登録
function getSlackMentions_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const mentions = {};
  Object.entries(props).forEach(([k, v]) => {
    if (k.startsWith('SLACK_MENTION_')) {
      const name = k.replace('SLACK_MENTION_', '');
      mentions[name] = v;
    }
  });
  return mentions;
}

// alert_rules.last_run_at を更新する専用 RPC（anon は UPDATE 不可のため RPC 経由）
function markAlertRuleRun_(ruleId) {
  const { url, key } = getSupabaseConfig_();
  const resp = UrlFetchApp.fetch(url + '/rest/v1/rpc/mark_alert_rule_run', {
    method: 'post',
    headers: {
      'apikey':        key,
      'Authorization': 'Bearer ' + key,
      'Content-Type':  'application/json',
    },
    payload:            JSON.stringify({ p_rule_id: ruleId }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    Logger.log('mark_alert_rule_run エラー: ' + resp.getContentText());
  }
}

// ============================================================
// セットアップ用ユーティリティ
// ============================================================

// 毎朝8時のトリガーを登録（初回のみ手動実行）
function setupDailyAlertTrigger() {
  // 既存トリガーを削除
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runDailyAlerts')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 毎朝8時（JST）に設定
  ScriptApp.newTrigger('runDailyAlerts')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone('Asia/Tokyo')
    .create();

  Logger.log('✅ 毎朝8時のアラートトリガーを設定しました');
}
