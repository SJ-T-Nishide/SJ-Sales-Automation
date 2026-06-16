// analysis.html 用スクリプト

const ANALYSIS_PROMPT = `
以下は東カレデートでの自動化ツールで収集したコンバージョンデータです。
各パターンはペルソナ・話し方スタイルの組み合わせです。

データ:
{DATA}

以下の観点で分析し、具体的な改善提案をしてください。

## 1. パフォーマンス評価
- 最もマッチ率が高いパターンとその特徴
- 最もアポ率が高いパターンとその特徴
- 成績の悪いパターンとその原因の仮説

## 2. ペルソナ・文体の傾向分析
- どういう書き方・トーンが効果的か
- 話し方スタイル（タメ口/敬語、絵文字あり/なし等）の影響

## 3. 具体的な改善案
- プロフィール文（ペルソナ）の書き換え例
- メッセージスタイルの調整ポイント
- アポ打診のタイミングや文面の改善

## 4. 次に試すべき新パターン
- 未試のアプローチで成果が期待できるもの
- 具体的なペルソナ文と話し方スタイルの例文を提示

日本語で、箇条書きを使って具体的に書いてください。
`.trim();

async function syncGet(keys) {
  return new Promise((r) => chrome.storage.sync.get(keys, r));
}

async function localGet(keys) {
  return new Promise((r) => chrome.storage.local.get(keys, r));
}

// ---- GASからデータ取得 ----

function gasUrl(settings, route) {
  return `${settings.gasUrl}?route=${encodeURIComponent(route)}&token=${encodeURIComponent(settings.gasToken)}`;
}

async function fetchLogs(settings) {
  const res = await fetch(gasUrl(settings, 'logs'));
  const json = await res.json();
  return json.data || [];
}

async function fetchAnalysisHistory(settings) {
  const res = await fetch(gasUrl(settings, 'analysis'));
  const json = await res.json();
  return json.data || [];
}

// ---- Claude分析呼び出し（GAS経由） ----

async function callAnalysisViaGAS(settings, data) {
  const res = await fetch(gasUrl(settings, 'generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'analysis', data }),
  });
  if (!res.ok) throw new Error(`GAS HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.analysis || json.candidates?.[0] || '';
}

// ---- サマリー集計 ----

function aggregateByPattern(logs) {
  const map = {};
  for (const row of logs) {
    const key = row['パターン名'] || row['patternName'] || '不明';
    if (!map[key]) {
      map[key] = {
        name: key,
        persona: row['ペルソナ'] || row['persona'] || '',
        style: row['スタイル'] || row['style'] || '',
        days: 0,
        likes: 0, matches: 0, apos: 0,
      };
    }
    map[key].days++;
    map[key].likes += Number(row['いいね数'] || row['likesSent'] || 0);
    map[key].matches += Number(row['マッチ数'] || row['matchesReceived'] || 0);
    map[key].apos += Number(row['アポ数'] || row['appointmentsSet'] || 0);
  }
  return Object.values(map).map((p) => ({
    ...p,
    matchRate: p.likes > 0 ? Math.round(p.matches / p.likes * 100) : 0,
    apoRate: p.matches > 0 ? Math.round(p.apos / p.matches * 100) : 0,
  }));
}

// ---- UI描画 ----

function renderSummary(logs) {
  const totals = logs.reduce((acc, r) => {
    acc.likes += Number(r['いいね数'] || 0);
    acc.matches += Number(r['マッチ数'] || 0);
    acc.apos += Number(r['アポ数'] || 0);
    return acc;
  }, { likes: 0, matches: 0, apos: 0 });

  document.getElementById('totalLikes').textContent = totals.likes;
  document.getElementById('totalMatches').textContent = totals.matches;
  document.getElementById('totalApos').textContent = totals.apos;

  const avgMatch = totals.likes > 0 ? Math.round(totals.matches / totals.likes * 100) : 0;
  const avgApo = totals.matches > 0 ? Math.round(totals.apos / totals.matches * 100) : 0;
  document.getElementById('avgMatchRate').textContent = `マッチ率 ${avgMatch}%`;
  document.getElementById('avgApoRate').textContent = `アポ率 ${avgApo}%`;

  const patterns = aggregateByPattern(logs);
  const best = patterns.sort((a, b) => b.matchRate - a.matchRate)[0];
  document.getElementById('bestPattern').textContent = best?.name || '-';
}

function renderTable(logs) {
  if (logs.length === 0) return;

  const patterns = aggregateByPattern(logs);
  patterns.sort((a, b) => b.matchRate - a.matchRate);
  const maxMatchRate = Math.max(...patterns.map((p) => p.matchRate));

  const html = `
    <table>
      <thead><tr>
        <th>パターン名</th><th>運用日数</th>
        <th>いいね</th><th>マッチ</th><th>マッチ率</th>
        <th>アポ</th><th>アポ率</th><th>ペルソナ概要</th>
      </tr></thead>
      <tbody>
        ${patterns.map((p) => `
          <tr class="${p.matchRate === maxMatchRate ? 'best-row' : ''}">
            <td><strong>${p.name}</strong></td>
            <td>${p.days}日</td>
            <td>${p.likes}</td>
            <td>${p.matches}</td>
            <td class="${p.matchRate >= 20 ? 'rate-good' : p.matchRate < 10 ? 'rate-bad' : ''}">${p.matchRate}%</td>
            <td>${p.apos}</td>
            <td class="${p.apoRate >= 30 ? 'rate-good' : ''}">${p.apoRate}%</td>
            <td style="font-size:11px;color:#666;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${p.persona}">${p.persona.substring(0, 40)}${p.persona.length > 40 ? '...' : ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  document.getElementById('tableArea').innerHTML = html;
}

function renderHistory(history) {
  const area = document.getElementById('historyArea');
  if (history.length === 0) {
    area.innerHTML = '<div style="color:#888;font-size:13px;">まだ分析履歴がありません。</div>';
    return;
  }

  area.innerHTML = [...history].reverse().slice(0, 5).map((h) => {
    const text = h['提案内容'] || h['analysis'] || '';
    const date = h['分析日時'] || h['date'] || '';
    const preview = text.substring(0, 200);
    const hasMore = text.length > 200;
    return `
      <div class="history-item">
        <div class="history-date">${date}</div>
        <div class="history-text" id="ht_${date.replace(/\W/g, '')}">${preview}${hasMore ? '...' : ''}</div>
        ${hasMore ? `<div class="expand-btn" onclick="toggleExpand('ht_${date.replace(/\W/g, '')}', '${encodeURIComponent(text)}', this)">続きを読む ▼</div>` : ''}
      </div>`;
  }).join('');
}

function toggleExpand(id, encodedText, btn) {
  const el = document.getElementById(id);
  if (el.classList.contains('expanded')) {
    el.classList.remove('expanded');
    btn.textContent = '続きを読む ▼';
  } else {
    el.textContent = decodeURIComponent(encodedText);
    el.classList.add('expanded');
    btn.textContent = '折りたたむ ▲';
  }
}

// ---- メイン ----

async function loadData() {
  const { settings = {} } = await syncGet('settings');
  if (!settings.gasUrl || !settings.gasToken) {
    document.getElementById('tableArea').innerHTML =
      '<div style="color:#e74c3c;font-size:13px;">設定にGAS URLとTokenが入力されていません。</div>';
    return null;
  }

  const [logs, history] = await Promise.all([fetchLogs(settings), fetchAnalysisHistory(settings)]);
  if (logs.length > 0) {
    renderSummary(logs);
    renderTable(logs);
  }
  renderHistory(history);
  document.getElementById('lastUpdated').textContent =
    `最終更新: ${new Date().toLocaleTimeString('ja-JP')}`;
  return { logs, settings };
}

async function runAnalysis() {
  const btn = document.getElementById('analyzeBtn');
  const spinner = document.getElementById('spinner');
  const resultEl = document.getElementById('analysisResult');

  btn.disabled = true;
  spinner.classList.add('show');
  resultEl.textContent = '分析中...（30秒ほどかかります）';
  resultEl.classList.add('loading');

  try {
    const ctx = await loadData();
    if (!ctx) return;

    const { logs, settings } = ctx;
    if (logs.length === 0) {
      resultEl.textContent = 'データがありません。先にシートに記録してください。';
      return;
    }

    const patterns = aggregateByPattern(logs);
    const analysis = await callAnalysisViaGAS(settings, patterns);

    resultEl.textContent = analysis;
    resultEl.classList.remove('loading');

    // 分析結果をGASに保存
    const saveUrl = `${settings.gasUrl}?route=analysis&token=${encodeURIComponent(settings.gasToken)}`;
    await fetch(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis, period: '全期間' }),
    });

    // 履歴を再取得して更新
    const history = await fetchAnalysisHistory(settings);
    renderHistory(history);

  } catch (err) {
    resultEl.textContent = `エラー: ${err.message}`;
    resultEl.classList.remove('loading');
  } finally {
    btn.disabled = false;
    spinner.classList.remove('show');
  }
}

document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
document.getElementById('refreshBtn').addEventListener('click', loadData);

loadData();
