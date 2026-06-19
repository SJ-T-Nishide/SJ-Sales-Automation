// ============================================================
// Service Worker - GAS API中継
// 送信トリガー:
//   1. 一斉送信ボタン（手動）
//   2. 今すぐ送信ボタン（手動）
//   3. 詳細設定で時刻を登録した場合の batch_HH_MM アラーム（自動スケジュール）
//      ※ 時刻未登録の場合はアラーム未生成 → 自動送信なし
// ============================================================

// 旧バージョンの自動送信残留データをクリア（インストール/更新時のみ）
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.clear('checkReplies').catch(() => {});
  chrome.storage.local.remove('inboundApoPending').catch(() => {});
});

// ---- GAS API 呼び出し ----

async function callGAS(route, payload = {}, method = 'POST') {
  let { settings = {} } = await localGet('settings');
  // migration: sync → local（初回のみ）
  if (!settings.gasUrl) {
    const s = await syncGet('settings');
    if (s.settings?.gasUrl) { settings = s.settings; await localSet({ settings }); }
  }
  const { gasUrl, gasToken } = settings;
  if (!gasUrl || !gasToken) throw new Error('GAS URLまたはTokenが未設定です');

  let url = `${gasUrl}?route=${encodeURIComponent(route)}&token=${encodeURIComponent(gasToken)}`;

  let options;
  if (method === 'GET') {
    for (const [k, v] of Object.entries(payload)) {
      url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    }
    options = { method: 'GET' };
  } else {
    options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
  }

  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`GAS HTTP ${res.status}`);
  const json = await res.json();
  if (json && json.error) throw new Error(`GAS error: ${json.error}`);
  return json;
}

function syncGet(keys) {
  return new Promise((r) => chrome.storage.sync.get(keys, r));
}
function localGet(keys) {
  return new Promise((r) => chrome.storage.local.get(keys, r));
}
function localSet(obj) {
  return new Promise((r) => chrome.storage.local.set(obj, r));
}

// ---- メッセージハンドラ ----

// MV3サービスワーカーは30秒で終了する。長いGAS呼び出し中にSWが落ちると
// "message channel closed" エラーになる。25秒ごとにstorage.getを呼んでSWを生かし続ける。
function withKeepAlive(fn) {
  const timer = setInterval(() => chrome.storage.local.get('__noop__', () => {}), 25000);
  return fn().finally(() => clearInterval(timer));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {

    case 'generateCandidates':
      withKeepAlive(() => handleGenerate(message)).then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'fetchCalendarSlots':
      withKeepAlive(() => callGAS('calendar', {}, 'GET')).then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'logEvent':
      callGAS('log', message.payload)
        .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'runAnalysis':
      withKeepAlive(() => callGAS('generate', { ...message.payload, type: 'analysis' }))
        .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'judgeApo':
      withKeepAlive(() => callGAS('judge', message.payload))
        .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'extractName':
      withKeepAlive(() => callGAS('extractName', message.payload))
        .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'refreshBatchAlarms':
      refreshBatchAlarms().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'openCandidates':
      chrome.tabs.create({ url: chrome.runtime.getURL('candidates.html') })
        .then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'saveKnowledge':
      callGAS('saveKnowledge', message.payload)
        .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'keepalive':
      sendResponse({ ok: true });
      return true;

  }
});

async function handleGenerate(message) {
  const { patterns = [] } = await localGet('patterns');
  let { activePatternId } = await localGet('activePatternId');
  // migration: sync → local（初回のみ）
  if (!activePatternId) {
    const s = await syncGet('activePatternId');
    if (s.activePatternId) { activePatternId = s.activePatternId; await localSet({ activePatternId }); }
  }
  const pattern = patterns.find((p) => p.id === activePatternId) || {};

  console.log('[handleGenerate] mode:', message.mode, '| firstMsgPrompt length:', (pattern.firstMsgPrompt || '').length, '| firstMsgPrompt preview:', (pattern.firstMsgPrompt || '').slice(0, 50));

  return callGAS('generate', {
    mode: message.mode || 'reply',
    stagePrompt: message.stagePrompt || '',
    conversationSummary: message.conversationSummary || '',
    opponentProfile: message.opponentProfile || '',
    firstMsgPrompt: pattern.firstMsgPrompt || '',
    pattern: {
      persona:   pattern.persona,
      style:     pattern.style,
      apoArea:   pattern.apoArea,
      apoVenue:  pattern.apoVenue,
    },
    calendarSlots: message.calendarSlots || [],
  });
}

// ---- 返信チェックアラーム: 削除（自動送信はボタン操作のみ） ----
// checkReplies の自動アラームは廃止。送信は 一斉送信ボタン / 今すぐ送信ボタン のみ。

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('batch_')) {
    const tabs = await chrome.tabs.query({ url: 'https://tokyo-calendar-date.jp/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'startBatchSend' })
        .catch((e) => console.warn(`[東カレ] startBatchSend送信失敗 tab=${tab.id}: ${e.message}`));
    }
    console.log(`[東カレ] バッチ送信アラーム起動: ${alarm.name}`);
  }
});

// ---- バッチ送信アラーム管理 ----

async function refreshBatchAlarms() {
  const allAlarms = await new Promise((r) => chrome.alarms.getAll(r));
  for (const alarm of allAlarms) {
    if (alarm.name.startsWith('batch_')) {
      await new Promise((r) => chrome.alarms.clear(alarm.name, r));
    }
  }

  const { patterns = [] } = await localGet('patterns');
  const { activePatternId } = await localGet('activePatternId');
  const pattern = patterns.find((p) => p.id === activePatternId) || {};
  const times = pattern.batchScheduleTimes || [];

  for (const hhmm of times) {
    const [hh, mm] = hhmm.split(':').map(Number);
    if (isNaN(hh) || isNaN(mm)) continue;

    const now = new Date();
    const next = new Date(now);
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delayInMinutes = (next - now) / 60000;
    const alarmName = `batch_${String(hh).padStart(2, '0')}_${String(mm).padStart(2, '0')}`;
    chrome.alarms.create(alarmName, { delayInMinutes, periodInMinutes: 24 * 60 });
    console.log(`[東カレ] バッチアラーム設定: ${alarmName} (${Math.round(delayInMinutes)}分後)`);
  }
}
