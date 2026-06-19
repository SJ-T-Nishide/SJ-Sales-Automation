
// ---- ストレージユーティリティ ----

function syncGet(keys) {
  return new Promise((r) => chrome.storage.sync.get(keys, r));
}
function syncSet(obj) {
  return new Promise((r) => chrome.storage.sync.set(obj, r));
}
function localGet(keys) {
  return new Promise((r) => chrome.storage.local.get(keys, r));
}
function localSet(obj) {
  return new Promise((r) => chrome.storage.local.set(obj, r));
}

function uid() {
  return 'p_' + Date.now().toString(36);
}

// ---- パターン管理 ----

async function getPatterns() {
  const { patterns } = await localGet('patterns');
  return patterns || [];
}

async function savePatterns(patterns) {
  await localSet({ patterns });
}

async function getActivePatternId() {
  let { activePatternId } = await localGet('activePatternId');
  // migration: sync → local（初回のみ）
  if (!activePatternId) {
    const s = await syncGet('activePatternId');
    if (s.activePatternId) { activePatternId = s.activePatternId; await localSet({ activePatternId }); }
  }
  return activePatternId || null;
}

async function setActivePatternId(id) {
  await localSet({ activePatternId: id });
}

// ---- UI更新 ----

function renderPatternSelect(patterns, activeId) {
  const sel = document.getElementById('patternSelect');
  sel.innerHTML = '';
  if (patterns.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'パターンなし';
    sel.appendChild(opt);
    return;
  }
  for (const p of patterns) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    opt.selected = p.id === activeId;
    sel.appendChild(opt);
  }
}

function renderStats(pattern) {
  if (!pattern) {
    ['statLikes', 'statMatches', 'statApos'].forEach((id) => {
      document.getElementById(id).textContent = '0';
    });
    document.getElementById('rateMatch').textContent = '-';
    document.getElementById('rateApo').textContent = '-';
    return;
  }

  const s = pattern.stats || { likesSent: 0, matchesReceived: 0, appointmentsSet: 0 };
  document.getElementById('statLikes').textContent = s.likesSent;
  document.getElementById('statMatches').textContent = s.matchesReceived;
  document.getElementById('statApos').textContent = s.appointmentsSet;

  const matchRate = s.likesSent > 0 ? Math.round((s.matchesReceived / s.likesSent) * 100) : null;
  const apoRate = s.matchesReceived > 0 ? Math.round((s.appointmentsSet / s.matchesReceived) * 100) : null;

  document.getElementById('rateMatch').textContent = matchRate != null ? `${matchRate}%` : '-';
  document.getElementById('rateApo').textContent = apoRate != null ? `${apoRate}%` : '-';
}

function renderSettingsForm(pattern) {
  if (!pattern) return;
  const fields = ['patternName', 'persona', 'style', 'maxLikesPerRun', 'maxLikesDaily', 'excludeAge'];
  for (const f of fields) {
    const el = document.getElementById(f);
    if (!el) continue;
    const key = f === 'patternName' ? 'name' : f;
    if (pattern[key] != null) el.value = pattern[key];
  }
  // 除外職業（multi-select）
  const jobsSel = document.getElementById('excludeJobs');
  if (jobsSel) {
    const selected = pattern.excludeJobs || [];
    for (const opt of jobsSel.options) opt.selected = selected.includes(opt.value);
  }
  // 自動メッセージテンプレート
  const tmplFields = ['msg1Template', 'msg1InboundTemplate', 'msg2Template', 'apoMsg1Template', 'apoMsg2Template', 'inboundApoTemplate',
    'apoMealPart1', 'apoMealPart2', 'apoCafePart1', 'apoCafePart2', 'apoPhonePart1', 'apoPhonePart2',
    'lineTemplate', 'lineApprovedTemplate'];
  for (const f of tmplFields) {
    const el = document.getElementById(f);
    if (el) el.value = pattern[f] || '';
  }
  const atcEl = document.getElementById('apoTriggerCount');
  if (atcEl) atcEl.value = pattern.apoTriggerCount != null ? pattern.apoTriggerCount : 3;
  // 非マッチ送信設定
  const smtEl = document.getElementById('scoutMsgTemplate');
  if (smtEl) smtEl.value = pattern.scoutMsgTemplate || '';
  const sprEl = document.getElementById('maxScoutPerRun');
  if (sprEl) sprEl.value = pattern.maxScoutPerRun != null ? pattern.maxScoutPerRun : 10;
  const sdEl = document.getElementById('maxScoutDaily');
  if (sdEl) sdEl.value = pattern.maxScoutDaily != null ? pattern.maxScoutDaily : 20;
  renderBatchTimes(pattern.batchScheduleTimes || []);
}

// ---- スケジュール時刻UI ----

function getBatchTimesFromDOM() {
  return [...document.querySelectorAll('.batch-time-input')].map((el) => el.value).filter(Boolean);
}

function renderBatchTimes(times) {
  const container = document.getElementById('batchTimesContainer');
  if (!container) return;
  container.innerHTML = '';
  (times || []).forEach((t, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;';
    const inp = document.createElement('input');
    inp.type = 'time';
    inp.className = 'batch-time-input';
    inp.value = t;
    inp.style.cssText = 'padding:3px 6px;border:1px solid #ccc;border-radius:4px;font-size:13px;';
    inp.addEventListener('change', scheduleAutoSave);
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.textContent = '×';
    rmBtn.style.cssText = 'padding:2px 8px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;';
    rmBtn.addEventListener('click', () => {
      const updated = getBatchTimesFromDOM();
      updated.splice(i, 1);
      renderBatchTimes(updated);
      scheduleAutoSave();
    });
    row.appendChild(inp);
    row.appendChild(rmBtn);
    container.appendChild(row);
  });
}

function setLikeButtonState(running) {
  document.getElementById('startLikeBtn').disabled = running;
  document.getElementById('stopLikeBtn').disabled = !running;
  document.getElementById('likeStatus').textContent = running ? '自動いいね実行中...' : '';
}

function setFootprintButtonState(running) {
  document.getElementById('startFootprintBtn').disabled = running;
  document.getElementById('stopFootprintBtn').disabled = !running;
  document.getElementById('footprintStatus').textContent = running ? '足跡モード実行中...' : '';
}

function setScoutButtonState(running) {
  document.getElementById('startScoutBtn').disabled = running;
  document.getElementById('stopScoutBtn').disabled = !running;
  document.getElementById('scoutStatus').textContent = running ? '非マッチ送信実行中...' : '';
}

// ---- 初期化 ----

async function init() {
  let [patterns, activeId, localSettingsResult, runState] = await Promise.all([
    getPatterns(),
    getActivePatternId(),
    localGet(['settings']),
    localGet(['autoLikeRunning', 'footprintRunning', 'scoutRunning']),
  ]);

  // settings: local優先、なければsyncからマイグレーション
  let settings = localSettingsResult.settings || {};
  if (!settings.gasUrl) {
    const syncSettings = await syncGet(['settings']);
    if (syncSettings.settings?.gasUrl) {
      settings = syncSettings.settings;
      await localSet({ settings });
    }
  }

  // GAS設定
  if (settings.gasUrl)   document.getElementById('gasUrl').value   = settings.gasUrl;
  if (settings.gasToken) document.getElementById('gasToken').value = settings.gasToken;

  // パターンが1件もなければデフォルト作成
  if (patterns.length === 0) {
    const defaultPattern = {
      id: uid(), name: 'デフォルト',
      persona: '', style: '', maxLikesPerRun: 30, maxLikesDaily: 50,
      excludeAge: '', excludeJobs: [],
      msg1Template:        'プロフィールを参考に、見た目がタイプでいいねした旨を自然に伝え、共通点に触れて親しみやすい初回メッセージを書いてください。3〜4文。タメ口。',
      msg1InboundTemplate: '相手から届いたメッセージと会話履歴を踏まえ、自然に反応しながらプロフィールへの興味や共通点に触れて返信してください。3〜4文。タメ口。',
      msg2Template:        '相手の返信に自然に反応しつつ、相手のことをもっと知りたいという気持ちを伝える返信を書いてください。2〜3文。',
      apoTemplate:         '会話の流れを踏まえ、自然な形でご飯かカフェに誘うメッセージを書いてください。押しつけがましくなく、相手の都合も聞く形で。',
      inboundApoTemplate:  '相手の最初のメッセージと会話の流れを踏まえ、自然な形でご飯かカフェに誘うメッセージを書いてください。初回返信直後なので短くて温度感のある誘い方で。',
      apoMealPart1:  'うれしいです！是非行きましょう。\n楽しみ！',
      apoMealPart2:  'よかったらＬＩＮＥで店決めたり予定たてませんか？\nこれ、ＬＩＮＥの友達追加のやつです。\nラインだと絶対気付けるんですが、このままが良ければ大丈夫ですよ！',
      apoCafePart1:  'うれしいです！是非行きましょう。\n楽しみ！',
      apoCafePart2:  'よかったらＬＩＮＥで店決めたり予定たてませんか？\nラインだと絶対気付けるんですが、このままが良ければ大丈夫ですよ。',
      apoPhonePart1: '電話ありです！是非しましょう。',
      apoPhonePart2: 'LINE電話でもいいですか？\nこれLINEの友達追加のやつです。\n\nこのままが良ければそれでもOKです！',
      lineTemplate: '',
      apoTriggerCount: 3, scoutMsgTemplate: '', maxScoutPerRun: 10, maxScoutDaily: 20,
      batchScheduleTimes: [],
      stats: { likesSent: 0, matchesReceived: 0, appointmentsSet: 0 },
    };
    patterns = [defaultPattern];
    await savePatterns(patterns);
    activeId = defaultPattern.id;
    await setActivePatternId(activeId);
  }

  // パターン
  renderPatternSelect(patterns, activeId);
  const active = patterns.find((p) => p.id === activeId) || patterns[0] || null;
  renderStats(active);
  renderSettingsForm(active);

  // ボタン状態を復元
  setLikeButtonState(!!runState.autoLikeRunning);
  setFootprintButtonState(!!runState.footprintRunning);
  setScoutButtonState(!!runState.scoutRunning);
}

init();

// ---- パターン切り替え ----

document.getElementById('patternSelect').addEventListener('change', async (e) => {
  const id = e.target.value;
  await setActivePatternId(id);
  const patterns = await getPatterns();
  const pattern = patterns.find((p) => p.id === id) || null;
  renderStats(pattern);
  renderSettingsForm(pattern);
});

// ---- パターン追加 ----

document.getElementById('addPatternBtn').addEventListener('click', async () => {
  const name = prompt('新しいパターン名を入力してください（例：フランク系、丁寧系）');
  if (!name) return;

  const patterns = await getPatterns();
  const newPattern = {
    id: uid(),
    name,
    persona: '',
    style: '',
    maxLikesPerRun: 30,
    maxLikesDaily: 50,
    excludeAge: '',
    excludeJobs: [],
    msg1Template: '',
    msg1InboundTemplate: '',
    msg2Template: '',
    apoTemplate: '',
    inboundApoTemplate: '',
    apoMealPart1:  'うれしいです！是非行きましょう。\n楽しみ！',
    apoMealPart2:  'よかったらＬＩＮＥで店決めたり予定たてませんか？\nこれ、ＬＩＮＥの友達追加のやつです。\nラインだと絶対気付けるんですが、このままが良ければ大丈夫ですよ！',
    apoCafePart1:  'うれしいです！是非行きましょう。\n楽しみ！',
    apoCafePart2:  'よかったらＬＩＮＥで店決めたり予定たてませんか？\nラインだと絶対気付けるんですが、このままが良ければ大丈夫ですよ。',
    apoPhonePart1: '電話ありです！是非しましょう。',
    apoPhonePart2: 'LINE電話でもいいですか？\nこれLINEの友達追加のやつです。\n\nこのままが良ければそれでもOKです！',
    lineTemplate: '',
    apoTriggerCount: 3,
    scoutMsgTemplate: '',
    maxScoutPerRun: 10,
    maxScoutDaily: 20,
    batchScheduleTimes: [],
    stats: { likesSent: 0, matchesReceived: 0, appointmentsSet: 0 },
  };

  patterns.push(newPattern);
  await savePatterns(patterns);
  await setActivePatternId(newPattern.id);

  renderPatternSelect(patterns, newPattern.id);
  renderStats(newPattern);
  renderSettingsForm(newPattern);
});

// ---- パターン削除 ----

document.getElementById('deletePatternBtn').addEventListener('click', async () => {
  const activeId = await getActivePatternId();
  let patterns = await getPatterns();
  const target = patterns.find((p) => p.id === activeId);
  if (!target) return;
  if (!confirm(`「${target.name}」を削除しますか？`)) return;

  patterns = patterns.filter((p) => p.id !== activeId);
  await savePatterns(patterns);
  const newActiveId = patterns[0]?.id || null;
  await setActivePatternId(newActiveId);

  renderPatternSelect(patterns, newActiveId);
  const newActive = patterns[0] || null;
  renderStats(newActive);
  renderSettingsForm(newActive);
});

// ---- 今日のリセット ----

document.getElementById('resetStatsBtn').addEventListener('click', async () => {
  const activeId = await getActivePatternId();
  const patterns = await getPatterns();
  const pattern = patterns.find((p) => p.id === activeId);
  if (!pattern || !confirm('今日の統計をリセットしますか？')) return;

  pattern.stats = { likesSent: 0, matchesReceived: 0, appointmentsSet: 0 };
  await savePatterns(patterns);
  renderStats(pattern);
});

// ---- いいね開始/停止 ----

async function sendToActiveTab(message) {
  const tabs = await chrome.tabs.query({ url: 'https://tokyo-calendar-date.jp/*' });
  const tab = tabs[0];
  if (tab?.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
}

document.getElementById('popoutBtn').addEventListener('click', () => {
  chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 440, height: 700 });
  window.close();
});

document.getElementById('startLikeBtn').addEventListener('click', async () => {
  const { settings = {} } = await localGet('settings');
  if (!settings.gasUrl || !settings.gasToken) {
    document.getElementById('likeStatus').textContent = '先にGAS URLとTokenを設定してください';
    document.getElementById('likeStatus').style.color = '#e74c3c';
    return;
  }

  const activeId = await getActivePatternId();
  const patterns = await getPatterns();
  const pattern = patterns.find((p) => p.id === activeId);
  if (!pattern?.maxLikesPerRun || !pattern?.maxLikesDaily) {
    document.getElementById('likeStatus').textContent = 'パターンのいいね上限を設定してください';
    document.getElementById('likeStatus').style.color = '#e74c3c';
    return;
  }

  setLikeButtonState(true);
  document.getElementById('likeStatus').style.color = '#27ae60';
  sendToActiveTab({ action: 'startLike' });
});

document.getElementById('stopLikeBtn').addEventListener('click', () => {
  setLikeButtonState(false);
  sendToActiveTab({ action: 'stopLike' });
});

// ---- 足跡モード開始/停止 ----

document.getElementById('startFootprintBtn').addEventListener('click', async () => {
  const { settings = {} } = await localGet('settings');
  if (!settings.gasUrl || !settings.gasToken) {
    document.getElementById('footprintStatus').textContent = '先にGAS URLとTokenを設定してください';
    document.getElementById('footprintStatus').style.color = '#e74c3c';
    return;
  }
  setFootprintButtonState(true);
  document.getElementById('footprintStatus').style.color = '#27ae60';
  sendToActiveTab({ action: 'startFootprint' });
});

document.getElementById('stopFootprintBtn').addEventListener('click', () => {
  setFootprintButtonState(false);
  sendToActiveTab({ action: 'stopFootprint' });
});

// ---- 非マッチ送信開始/停止 ----

document.getElementById('startScoutBtn').addEventListener('click', async () => {
  const activeId = await getActivePatternId();
  const patterns = await getPatterns();
  const pattern = patterns.find((p) => p.id === activeId);
  if (!pattern?.scoutMsgTemplate) {
    document.getElementById('scoutStatus').textContent = '詳細設定の非マッチ送信テンプレートを入力してください';
    document.getElementById('scoutStatus').style.color = '#e74c3c';
    return;
  }
  setScoutButtonState(true);
  document.getElementById('scoutStatus').style.color = '#27ae60';
  sendToActiveTab({ action: 'startScout' });
});

document.getElementById('stopScoutBtn').addEventListener('click', () => {
  setScoutButtonState(false);
  sendToActiveTab({ action: 'stopScout' });
});

// ---- シートに記録 ----

document.getElementById('syncSheetBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncSheetBtn');
  const msg = document.getElementById('syncMsg');
  const { settings = {} } = await localGet('settings');

  if (!settings.gasUrl || !settings.gasToken) {
    msg.style.color = '#e74c3c';
    msg.textContent = '設定にGAS URLとTokenを入力してください';
    return;
  }

  const activeId = await getActivePatternId();
  const patterns = await getPatterns();
  const pattern = patterns.find((p) => p.id === activeId);
  if (!pattern) { msg.textContent = 'パターンが選択されていません'; return; }

  btn.disabled = true;
  msg.style.color = '#888';
  msg.textContent = '送信中...';

  try {
    const url = `${settings.gasUrl}?route=log&token=${encodeURIComponent(settings.gasToken)}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'manual_sync',
        patternId: pattern.id,
        patternName: pattern.name,
      }),
    });
    msg.style.color = '#27ae60';
    msg.textContent = 'シートに記録しました ✓';
  } catch {
    msg.style.color = '#e74c3c';
    msg.textContent = '送信エラー。GAS URLとTokenを確認してください';
  } finally {
    btn.disabled = false;
    setTimeout(() => { msg.textContent = ''; }, 3000);
  }
});

// ---- 分析ページを開く ----

document.getElementById('openAnalysisBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('analysis.html') });
});

document.getElementById('openScheduleBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('schedule.html') });
});

// ---- 設定収集（保存・自動保存共通） ----

async function collectAndSave(showFeedback = false) {
  const settings = {
    gasUrl:   document.getElementById('gasUrl').value.trim(),
    gasToken: document.getElementById('gasToken').value.trim(),
  };
  await localSet({ settings });

  const activeId = await getActivePatternId();
  const patterns = await getPatterns();
  const pattern = patterns.find((p) => p.id === activeId);
  if (pattern) {
    pattern.name            = document.getElementById('patternName').value || pattern.name;
    pattern.persona         = document.getElementById('persona').value;
    pattern.style           = document.getElementById('style').value;
    pattern.maxLikesPerRun  = Number(document.getElementById('maxLikesPerRun').value) || 30;
    pattern.maxLikesDaily   = Number(document.getElementById('maxLikesDaily').value) || 50;
    pattern.excludeAge      = document.getElementById('excludeAge').value.trim();
    pattern.excludeJobs     = [...document.getElementById('excludeJobs').selectedOptions].map((o) => o.value);
    pattern.msg1Template    = document.getElementById('msg1Template').value;
    pattern.msg2Template    = document.getElementById('msg2Template').value;
    pattern.apoMsg1Template     = document.getElementById('apoMsg1Template').value;
    pattern.apoMsg2Template     = document.getElementById('apoMsg2Template').value;
    pattern.inboundApoTemplate  = document.getElementById('inboundApoTemplate').value;
    pattern.apoMealPart1        = document.getElementById('apoMealPart1').value;
    pattern.apoMealPart2    = document.getElementById('apoMealPart2').value;
    pattern.apoCafePart1    = document.getElementById('apoCafePart1').value;
    pattern.apoCafePart2    = document.getElementById('apoCafePart2').value;
    pattern.apoPhonePart1   = document.getElementById('apoPhonePart1').value;
    pattern.apoPhonePart2   = document.getElementById('apoPhonePart2').value;
    pattern.lineTemplate         = document.getElementById('lineTemplate').value;
    pattern.lineApprovedTemplate = document.getElementById('lineApprovedTemplate').value;
    pattern.apoTriggerCount = Number(document.getElementById('apoTriggerCount').value) || 3;
    pattern.msg1InboundTemplate = document.getElementById('msg1InboundTemplate').value;
    pattern.scoutMsgTemplate    = document.getElementById('scoutMsgTemplate').value;
    pattern.maxScoutPerRun      = Number(document.getElementById('maxScoutPerRun').value) || 10;
    pattern.maxScoutDaily       = Number(document.getElementById('maxScoutDaily').value) || 20;
    pattern.batchScheduleTimes  = getBatchTimesFromDOM();
    await savePatterns(patterns);
    // バックグラウンドにアラーム更新を通知
    chrome.runtime.sendMessage({ action: 'refreshBatchAlarms' }).catch(() => {});
    if (showFeedback) renderPatternSelect(patterns, activeId);
  }

  if (showFeedback) {
    const msg = document.getElementById('saveMsg');
    if (pattern) {
      msg.style.color = '#27ae60';
      msg.textContent = '保存しました ✓';
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = 'パターンが選択されていません';
    }
    setTimeout(() => { msg.textContent = ''; }, 3000);
  }
}

// ---- 自動保存（入力から1秒後） ----

let autoSaveTimer = null;

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => collectAndSave(false), 1000);
}

[
  'gasUrl', 'gasToken',
  'patternName', 'persona', 'style',
  'maxLikesPerRun', 'maxLikesDaily', 'excludeAge',
  'msg1Template', 'msg2Template', 'apoMsg1Template', 'apoMsg2Template', 'inboundApoTemplate',
  'apoMealPart1', 'apoMealPart2', 'apoCafePart1', 'apoCafePart2', 'apoPhonePart1', 'apoPhonePart2',
  'lineTemplate', 'lineApprovedTemplate', 'apoTriggerCount',
  'msg1InboundTemplate',
  'scoutMsgTemplate', 'maxScoutPerRun', 'maxScoutDaily',
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', scheduleAutoSave);
});
document.getElementById('excludeJobs').addEventListener('change', scheduleAutoSave);

// ---- マッチ送信操作ボタン ----

async function getHigashareTab() {
  const [tab] = await chrome.tabs.query({ url: 'https://tokyo-calendar-date.jp/*' });
  return tab || null;
}

function showMatchMsg(text, color = '#27ae60') {
  const el = document.getElementById('matchMsg');
  if (!el) return;
  el.style.color = color;
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; }, 3000);
}

async function initMatchCount() {
  const { selectedPaths = [] } = await chrome.storage.local.get('selectedPaths');
  const el = document.getElementById('matchCount');
  if (el) el.textContent = selectedPaths.length > 0 ? `${selectedPaths.length}件選択中` : '選択なし';
}

initMatchCount();

document.getElementById('selectAllBtn').addEventListener('click', async () => {
  const tab = await getHigashareTab();
  if (!tab) { showMatchMsg('東カレの友達一覧を開いてください', '#e74c3c'); return; }
  chrome.tabs.sendMessage(tab.id, { action: 'selectAllMatches' }).catch(() => {});
});

document.getElementById('deselectAllBtn').addEventListener('click', async () => {
  const tab = await getHigashareTab();
  if (!tab) { showMatchMsg('東カレの友達一覧を開いてください', '#e74c3c'); return; }
  chrome.tabs.sendMessage(tab.id, { action: 'deselectAllMatches' }).catch(() => {});
});

document.getElementById('genCandidatesBtn').addEventListener('click', async () => {
  const tab = await getHigashareTab();
  if (!tab) { showMatchMsg('東カレのタブを開いてください', '#e74c3c'); return; }
  chrome.tabs.sendMessage(tab.id, { action: 'genCandidatesFromPopup' }).catch(() => {});
  window.close();
});

document.getElementById('matchFullBatchBtn').addEventListener('click', async () => {
  const tab = await getHigashareTab();
  if (!tab) { showMatchMsg('東カレのタブを開いてください', '#e74c3c'); return; }
  chrome.tabs.sendMessage(tab.id, { action: 'startFullBatchSend' }).catch(() => {});
  showMatchMsg('⚡ 全体送信を起動しました ✓');
});

document.getElementById('matchCheckedBatchBtn').addEventListener('click', async () => {
  const tab = await getHigashareTab();
  if (!tab) { showMatchMsg('東カレのタブを開いてください', '#e74c3c'); return; }
  chrome.tabs.sendMessage(tab.id, { action: 'startBatchSend' }).catch(() => {});
  showMatchMsg('✅ 選択のみ送信を起動しました ✓', '#8e44ad');
});

document.getElementById('matchBatchStopBtn').addEventListener('click', async () => {
  const tab = await getHigashareTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { action: 'stopBatchSend' }).catch(() => {});
  await chrome.storage.local.set({ checkQueue: [], batchQueue: [], queueNavTarget: null, selectedPaths: [] });
  showMatchMsg('一斉送信を停止しました', '#e67e22');
  const el = document.getElementById('matchCount');
  if (el) el.textContent = '選択なし';
});

document.getElementById('matchResetBtn').addEventListener('click', async () => {
  if (!confirm('conversationStates（追跡データ）を全消しします。よいですか？')) return;
  await chrome.storage.local.remove('conversationStates');
  showMatchMsg('✅ ステートリセット完了');
});

// ---- スケジュール時刻追加ボタン ----

document.getElementById('addBatchTimeBtn').addEventListener('click', () => {
  const times = getBatchTimesFromDOM();
  times.push('08:00');
  renderBatchTimes(times);
  scheduleAutoSave();
});

// ---- 保存ボタン（即時・フィードバックあり） ----

document.getElementById('saveBtn').addEventListener('click', () => {
  clearTimeout(autoSaveTimer);
  collectAndSave(true);
});

// ---- モバイルエミュレーション切替 ----

const MOBILE_METRICS = {
  width: 390, height: 844, deviceScaleFactor: 3,
  mobile: true, screenOrientation: { angle: 0, type: 'portraitPrimary' },
};
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

let mobileEnabled = false;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function debuggerSend(target, method, params = {}) {
  return new Promise((res) => chrome.debugger.sendCommand(target, method, params, res));
}

function showMobileStatus(msg, color = '#e74c3c') {
  const el = document.getElementById('mobileStatus');
  if (el) { el.textContent = msg; el.style.color = color; }
}

async function setMobileEmulation(enable, specificTab = null) {
  const tab = specificTab || await getActiveTab();
  if (!tab) { showMobileStatus('タブが見つかりません'); return; }

  const target = { tabId: tab.id };
  showMobileStatus('切替中...', '#888');

  try {
    if (enable) {
      await new Promise((res, rej) =>
        chrome.debugger.attach(target, '1.3', () => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || '';
            if (msg.includes('already attached')) res();
            else rej(chrome.runtime.lastError);
          } else {
            res();
          }
        })
      );
      await debuggerSend(target, 'Emulation.setDeviceMetricsOverride', MOBILE_METRICS);
      await debuggerSend(target, 'Emulation.setUserAgentOverride', { userAgent: MOBILE_UA });
    } else {
      try {
        await debuggerSend(target, 'Emulation.clearDeviceMetricsOverride');
        await debuggerSend(target, 'Emulation.setUserAgentOverride', { userAgent: '' });
      } catch { /* デバッガー未接続時はスキップ */ }
      await new Promise((res) => chrome.debugger.detach(target, res));
    }

    await chrome.tabs.reload(tab.id);
    mobileEnabled = enable;
    updateMobileBtn();
    showMobileStatus(enable ? 'モバイル表示ON ✓' : 'デスクトップ表示ON ✓', '#27ae60');
  } catch (e) {
    const msg = e?.message || String(e);
    showMobileStatus('エラー: ' + msg);
    console.warn('モバイルエミュレーション切替エラー:', e);
  }
}

function updateMobileBtn() {
  const btn = document.getElementById('mobileToggleBtn');
  btn.textContent = mobileEnabled ? '📱 モバイル表示 ON' : '📱 モバイル表示 OFF';
  btn.style.background = mobileEnabled ? '#27ae60' : '#7f8c8d';
}

// ---- ワンクリック: 東カレをモバイルで開く ----

async function openTokyoCalMobile() {
  const btn = document.getElementById('openMobileBtn');
  btn.textContent = '📱 開いています...';
  btn.disabled = true;

  const TARGET_URL = 'https://tokyo-calendar-date.jp/search/list';

  try {
    const existing = await chrome.tabs.query({ url: 'https://tokyo-calendar-date.jp/*' });

    if (existing.length > 0) {
      const tab = existing[0];
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await setMobileEmulation(true, tab);
      window.close();
    } else {
      const tab = await chrome.tabs.create({ url: TARGET_URL });

      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 10000);
        function onUpdated(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            clearTimeout(timeout);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(onUpdated);
      });

      await setMobileEmulation(true, tab);
      window.close();
    }
  } catch (e) {
    console.warn('東カレ起動エラー:', e);
    btn.textContent = '📱 東カレをモバイルで開く';
    btn.disabled = false;
  }
}

document.getElementById('openMobileBtn').addEventListener('click', openTokyoCalMobile);

document.getElementById('mobileToggleBtn').addEventListener('click', () => {
  setMobileEmulation(!mobileEnabled);
});

// ---- content.jsからの停止通知受信（コンテンツ側で停止した場合にUI更新） ----

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'likeStopped') {
    setLikeButtonState(false);
  }
  if (message.action === 'footprintStopped') {
    setFootprintButtonState(false);
  }
  if (message.action === 'scoutStopped') {
    setScoutButtonState(false);
  }
  if (message.action === 'statsUpdate') {
    (async () => {
      const activeId = await getActivePatternId();
      const patterns = await getPatterns();
      const pattern = patterns.find((p) => p.id === activeId);
      if (pattern) renderStats(pattern);
    })();
  }
  if (message.action === 'matchCountUpdate') {
    const el = document.getElementById('matchCount');
    if (!el) return;
    if (message.checked > 0) {
      el.textContent = `${message.checked}件選択中 / 全${message.total}件`;
    } else {
      el.textContent = `全${message.total}件`;
    }
  }
});
