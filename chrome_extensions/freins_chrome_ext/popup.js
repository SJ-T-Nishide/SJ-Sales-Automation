'use strict';

// TSVヘッダー（content.js と同一順序）
const TSV_HEADERS = [
  'source',
  'source_property_id',
  'source_url',
  'collected_at',
  '所在地',
  '賃料',
  '専有面積',
  '物件種別',
  '築年数',
  '最寄駅',
  '徒歩(分)',
  '管理費',
  '敷金',
  '礼金',
  '間取り',
  '建物種別',
  '階数',
  '物件名',
  '備考',
  'duplicate_key',
  'detail_status',
  'minpaku_score',
  'first_judgement',
];

// ======================================================
// ユーティリティ
// ======================================================
function $(id) { return document.getElementById(id); }

function setStatus(text, type) {
  $('dot').className = 'dot' + (type ? ' ' + type : '');
  $('status-text').textContent = text;
}

function showFlash(msg) {
  const el = $('flash');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isFreinsPage(tab) {
  return tab && tab.url && tab.url.includes('f-takken.com/freins');
}

// ======================================================
// 統計ボックスを表示・更新
// ======================================================
function showStats(extracted, added, skipped) {
  $('val-extracted').textContent = extracted;
  $('val-added').textContent     = added;
  $('val-skipped').textContent   = skipped;

  $('stat-extracted').classList.remove('hidden');
  $('stat-added').classList.remove('hidden');
  $('stat-skipped').classList.remove('hidden');
}

function hideStats() {
  $('stat-extracted').classList.add('hidden');
  $('stat-added').classList.add('hidden');
  $('stat-skipped').classList.add('hidden');
}

// ======================================================
// 抽出プレビュー表示（テスト用）
// ======================================================
function showPreview(sample) {
  if (!sample || sample.length === 0) {
    $('preview-section').style.display = 'none';
    return;
  }
  $('preview-json').textContent = JSON.stringify(sample, null, 2);
  $('preview-section').style.display = '';
}

function hidePreview() {
  $('preview-section').style.display = 'none';
}

// ======================================================
// 保存件数を取得して表示
// ======================================================
async function refreshCount() {
  const data = await chrome.storage.local.get(['freins_records']);
  const n = (data.freins_records || []).length;
  $('count').textContent = n;
  return n;
}

// ======================================================
// TSV 生成
// ======================================================
function recordsToTSV(records) {
  const header = TSV_HEADERS.join('\t');
  const rows = records.map(r =>
    TSV_HEADERS.map(h => {
      const v = r[h] !== undefined ? r[h] : '';
      return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
    }).join('\t')
  );
  return [header, ...rows].join('\n');
}

// ======================================================
// このページを抽出
// ======================================================
async function extractCurrentPage() {
  const tab = await getActiveTab();
  if (!isFreinsPage(tab)) {
    setStatus('ふれんずの検索結果ページを開いてください', 'warn');
    return;
  }

  const btn = $('btn-extract');
  btn.disabled = true;
  btn.textContent = '抽出中...';
  setStatus('抽出中...', '');
  hideStats();

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });

    if (resp && resp.ok) {
      $('count').textContent = resp.total;
      showStats(resp.extracted, resp.added, resp.skipped);
      showPreview(resp.sample);   // テスト用プレビュー

      if (resp.extracted === 0) {
        setStatus('物件カードが見つかりませんでした。デバッグ出力を確認してください。', 'error');
      } else if (resp.added === 0) {
        setStatus('抽出 ' + resp.extracted + '件 - すべて重複スキップ', 'warn');
      } else {
        setStatus(
          '抽出 ' + resp.extracted + '件 → 新規 ' + resp.added + '件 追加 (合計 ' + resp.total + '件)',
          'ok'
        );
        showFlash('✅ +' + resp.added + '件 追加 (合計 ' + resp.total + '件)');
      }
    } else {
      setStatus('抽出に失敗しました', 'error');
    }
  } catch (e) {
    setStatus('エラー: ' + e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'このページを抽出';
  }
}

// ======================================================
// TSVをクリップボードにコピー
// ======================================================
async function copyTSV() {
  const data = await chrome.storage.local.get(['freins_records']);
  const records = data.freins_records || [];

  if (records.length === 0) {
    setStatus('データがありません。先に抽出してください。', 'warn');
    return;
  }

  const tsv = recordsToTSV(records);

  try {
    await navigator.clipboard.writeText(tsv);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = tsv;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  showFlash('✅ ' + records.length + '件 コピーしました');
  setStatus(records.length + '件をコピーしました - スプレッドシートに貼り付けてください', 'ok');
}

// ======================================================
// TSVをファイルとしてダウンロード
// ======================================================
async function downloadTSV() {
  const data = await chrome.storage.local.get(['freins_records']);
  const records = data.freins_records || [];

  if (records.length === 0) {
    setStatus('データがありません。先に抽出してください。', 'warn');
    return;
  }

  const tsv = recordsToTSV(records);

  // ファイル名: freins_YYYYMMDD_HHMMSS.tsv
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  const ts =
    d.getFullYear() +
    z(d.getMonth() + 1) +
    z(d.getDate()) + '_' +
    z(d.getHours()) +
    z(d.getMinutes()) +
    z(d.getSeconds());
  const filename = 'freins_' + ts + '.tsv';

  // Blob → objectURL → <a> クリックでダウンロード
  const blob = new Blob(['﻿' + tsv], { type: 'text/tab-separated-values;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showFlash('💾 ' + filename + ' を保存しました');
  setStatus(records.length + '件を ' + filename + ' に保存しました', 'ok');
}

// ======================================================
// デバッグ情報をコンソールに出力
// ======================================================
async function debugOutput() {
  const tab = await getActiveTab();
  if (!isFreinsPage(tab)) {
    setStatus('ふれんずのページを開いてください', 'warn');
    return;
  }
  await chrome.tabs.sendMessage(tab.id, { action: 'debug' });
  setStatus('DevTools (F12) > Console を確認してください', 'ok');
}

// ======================================================
// データクリア
// ======================================================
async function clearData() {
  const n = await refreshCount();
  if (n === 0) {
    setStatus('クリアするデータがありません', '');
    return;
  }
  if (!confirm(n + '件のデータをクリアしますか？')) return;
  await chrome.storage.local.remove(['freins_records']);
  $('count').textContent = '0';
  hideStats();
  hidePreview();
  showFlash('🗑 クリアしました');
  setStatus('データをクリアしました', '');
}

// ======================================================
// 初期化
// ======================================================
document.addEventListener('DOMContentLoaded', async () => {
  const n = await refreshCount();

  const tab = await getActiveTab();
  if (!isFreinsPage(tab)) {
    setStatus('ふれんずの検索結果ページを開いてください', 'warn');
  } else if (n > 0) {
    setStatus(n + '件 蓄積済み', 'ok');
  } else {
    setStatus('「このページを抽出」で抽出開始', '');
  }

  $('btn-extract').addEventListener('click', extractCurrentPage);
  $('btn-copy').addEventListener('click', copyTSV);
  $('btn-download').addEventListener('click', downloadTSV);
  $('btn-debug').addEventListener('click', debugOutput);
  $('btn-clear').addEventListener('click', clearData);
});
