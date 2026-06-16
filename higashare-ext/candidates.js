// candidates.js — 生成結果ページ（chrome拡張ページとして新しいタブで開く）

const localGet = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const localSet = (o) => new Promise((r) => chrome.storage.local.set(o, r));

function escapeHtml(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setStatusBar(msg) {
  const el = document.getElementById('status-bar');
  if (el) el.textContent = msg;
}

let queuedCount = 0;

function updateFooter() {
  const footer = document.getElementById('footer');
  const btn = document.getElementById('start-btn');
  if (!footer || !btn) return;
  btn.textContent = `💌 送信開始 (${queuedCount}件)`;
  footer.style.display = queuedCount > 0 ? 'block' : 'none';
}

async function init() {
  const { candidatesJob } = await localGet('candidatesJob');
  if (!candidatesJob || !candidatesJob.job?.length) {
    setStatusBar('データなし — /friend/index で「送る」を選んでから「📝 生成」を押してください');
    return;
  }

  const { job, calendarSlots = [], patternId = '' } = candidatesJob;
  setStatusBar(`${job.length}件生成中...`);

  const content = document.getElementById('content');
  content.innerHTML = job.map((item, idx) => `
    <div id="cc-${idx}" class="card">
      <div class="card-name">${escapeHtml(item.name)}</div>
      <div class="card-status">待機中...</div>
    </div>
  `).join('');

  const { patterns = [] } = await localGet('patterns');
  const activePattern = patterns.find((p) => p.id === patternId) || patterns[0] || {};

  let doneCount = 0;

  for (let idx = 0; idx < job.length; idx++) {
    const item = job[idx];
    const card = document.getElementById(`cc-${idx}`);
    const statusEl = card?.querySelector('.card-status');
    if (statusEl) statusEl.textContent = '生成中...';

    const conversationSummary = item.lastMessage ? `相手の最後のメッセージ:\n${item.lastMessage}` : '';

    try {
      let mainCands = [], apoCands = [];

      if (item.conversationType === 'reply') {
        const [replyRes, apoRes] = await Promise.all([
          chrome.runtime.sendMessage({
            action: 'generateCandidates', mode: 'reply',
            opponentProfile: item.profile, conversationSummary,
            pattern: activePattern,
          }),
          chrome.runtime.sendMessage({
            action: 'generateCandidates', mode: 'apo',
            opponentProfile: item.profile, conversationSummary,
            pattern: activePattern, calendarSlots,
          }),
        ]);
        if (replyRes?.error) throw new Error(replyRes.error);
        if (apoRes?.error) throw new Error(apoRes.error);
        mainCands = replyRes.candidates || [];
        apoCands  = apoRes.candidates  || [];
      } else {
        const res = await chrome.runtime.sendMessage({
          action: 'generateCandidates', mode: 'first',
          opponentProfile: item.profile, conversationSummary: '',
          pattern: activePattern,
        });
        if (res?.error) throw new Error(res.error);
        mainCands = res.candidates || [];
      }

      renderCard(idx, item, mainCands, apoCands, patternId);
    } catch (err) {
      if (card) {
        const s = card.querySelector('.card-status');
        if (s) { s.textContent = 'エラー: ' + err.message; s.style.color = '#e74c3c'; }
      }
    }

    doneCount++;
    setStatusBar(`${doneCount}/${job.length}件完了`);
  }

  setStatusBar(doneCount === job.length ? '生成完了 — 候補を選んでキューに追加してください' : `${doneCount}/${job.length}件完了`);
}

function buildInfoSection(label, text) {
  if (!text || !text.trim()) return null;
  const wrap = document.createElement('div');
  wrap.className = 'info-section';

  const header = document.createElement('div');
  header.className = 'info-header';
  header.textContent = label + ' ▼';
  header.style.cursor = 'pointer';

  const body = document.createElement('div');
  body.className = 'info-body';
  body.textContent = text.trim();
  body.style.display = 'none';

  header.addEventListener('click', () => {
    const open = body.style.display === 'block';
    body.style.display = open ? 'none' : 'block';
    header.textContent = label + (open ? ' ▼' : ' ▲');
  });

  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

function renderCard(idx, item, candidates, apoCandidates, patternId) {
  const card = document.getElementById(`cc-${idx}`);
  if (!card) return;
  card.querySelector('.card-status')?.remove();

  // プロフィール・会話履歴セクション
  const profileSection = buildInfoSection('📄 プロフィール', item.profile);
  const historySection = buildInfoSection('💬 会話履歴', item.lastMessage);
  if (profileSection) card.appendChild(profileSection);
  if (historySection) card.appendChild(historySection);

  const prefix = item.conversationType === 'reply' ? '返信' : '';
  const hasApo = apoCandidates.length > 0;
  let cardQueued = false;

  function buildSection(list, labelPrefix, queueLabel, queueColor) {
    const container = document.createElement('div');

    const btnRow = document.createElement('div');
    btnRow.className = 'cand-btn-row';

    const ta = document.createElement('textarea');
    ta.className = 'cand-ta';
    ta.value = list[0] || '';

    list.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.className = 'cand-sel-btn' + (i === 0 ? ' active' : '');
      btn.textContent = `${labelPrefix}候補${i + 1}`;
      btn.addEventListener('click', () => {
        btnRow.querySelectorAll('.cand-sel-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        ta.value = text;
      });
      btnRow.appendChild(btn);
    });

    const queueBtn = document.createElement('button');
    queueBtn.className = 'queue-btn';
    queueBtn.style.background = queueColor;
    queueBtn.textContent = `✓ ${queueLabel}`;

    const queuedMsg = document.createElement('div');
    queuedMsg.className = 'queued-msg';

    queueBtn.addEventListener('click', async () => {
      if (queueBtn.disabled) return;
      queueBtn.disabled = true;

      const approvedText = ta.value?.trim() || '';
      if (!approvedText) { queueBtn.disabled = false; return; }

      const activeBtn = btnRow.querySelector('.cand-sel-btn.active');
      const selectedIdx = activeBtn
        ? [...btnRow.querySelectorAll('.cand-sel-btn')].indexOf(activeBtn)
        : 0;
      const originalText = list[selectedIdx] || '';

      chrome.runtime.sendMessage({
        action: 'saveKnowledge',
        payload: { patternId, opponentName: item.name, finalText: approvedText, originalText, edited: approvedText !== originalText },
      }).catch(() => {});

      const { batchQueue = [] } = await localGet('batchQueue');
      const existing = batchQueue.findIndex((q) => q.path === item.path);
      const entry = { path: item.path, name: item.name, approvedText };
      if (existing >= 0) batchQueue[existing] = entry;
      else batchQueue.push(entry);
      await localSet({ batchQueue });

      queueBtn.style.display = 'none';
      queuedMsg.textContent = '追加済み ✓ — ' + approvedText.slice(0, 40) + (approvedText.length > 40 ? '…' : '');
      queuedMsg.style.display = 'block';
      if (!cardQueued) { cardQueued = true; queuedCount++; updateFooter(); }
    });

    container.appendChild(btnRow);
    container.appendChild(ta);
    container.appendChild(queueBtn);
    container.appendChild(queuedMsg);
    return container;
  }

  const replyLabel = hasApo ? '返信をキューに追加' : 'キューに追加';
  card.appendChild(buildSection(candidates, prefix, replyLabel, '#1e8449'));

  if (hasApo) {
    const sep = document.createElement('div');
    sep.className = 'section-sep';
    sep.textContent = '📅 アポ打診（どちらか1つをキューに追加）';
    card.appendChild(sep);
    card.appendChild(buildSection(apoCandidates, 'アポ', 'アポをキューに追加', '#1a5276'));
  }
}

document.getElementById('start-btn').addEventListener('click', async () => {
  const { batchQueue = [] } = await localGet('batchQueue');
  if (batchQueue.length === 0) return;
  await localSet({ activeSend: true });
  const firstPath = 'https://tokyo-calendar-date.jp' + batchQueue[0].path;
  const tabs = await chrome.tabs.query({ url: 'https://tokyo-calendar-date.jp/*' });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url: firstPath, active: true });
  } else {
    chrome.tabs.create({ url: firstPath });
  }
  window.close();
});

init().catch((e) => { setStatusBar('初期化エラー: ' + e.message); });
