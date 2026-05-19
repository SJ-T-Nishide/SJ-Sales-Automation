'use strict';

const STORAGE_KEY        = 'reins_records';
const SOURCE_NAME        = 'REINS';
const TABNAME_KEY        = 'reins_tabname';    // 最後に使ったタブ名
const TABNAMES_KEY       = 'reins_tabnames';   // 履歴（最大10件）
const TABNAMES_MAX       = 10;

// 初期候補リスト（初回起動時のみ使用）
const INITIAL_TABNAMES = [
  '01 大阪_一戸建',
  '02 大阪市_マンション',
  '03 大阪市_外全',
  '04 大阪市_外一',
  '05 東京_外全',
  '06 東京_外一',
  '07 東京_一戸建',
  '08 東京_マンション',
  '09 福岡_マンション',
  '10 福岡_一戸建',
  '11 福岡_外全',
  '12 福岡_外一',
  '13 名古屋_外一',
  '14 名古屋_外全',
  '15 名古屋_マンション',
  '16 名古屋_一戸建',
  '17 札幌_一戸建',
  '18 札幌_マンション',
  '19 札幌_外全',
  '20 札幌_外一',
];

// TSVヘッダー（55列・スプレッドシートの列順に合わせる）
const TSV_HEADERS = [
  'タブ名',
  '取得日時',
  '連番',
  '物件番号',
  '取得元',
  '物件種目',
  '所在地',
  '建物名',
  '賃料(万円)',
  '管理費(円)',
  '面積(㎡)',
  '㎡単価(万円)',
  '坪単価(万円)',
  '間取',
  '所在階',
  '築年月',
  '交通',
  '電話番号',
  '用途地域',
  '敷金',
  '保証金',
  '礼金',
  'source_url',
  '備考',
  'duplicate_key',
  'preliminary_score',
  'first_judgement',
  'manual_judgement',
  'detail_status',
  '水道光熱費',
  'Wi-Fi',
  '消耗品費',
  'リネン備品費',
  '保険料',
  'その他費用',
  '月次費用合計',
  '保守_CF/月',
  '標準_CF/月',
  '攻め_CF/月',
  '保守_年間CF',
  '標準_年間CF',
  '攻め_年間CF',
  '初期投資額',
  '保守_年間利回り%',
  '標準_年間利回り%',
  '攻め_年間利回り%',
  '投資回収月数_標準',
  '標準判定',
  '判定根拠',
  '実行日時',
  'メモ',
  '取得元シート名',
  '賃料',
  '管理費',
  '面積',
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

function isReinsPage(tab) {
  return tab && tab.url && tab.url.includes('system.reins.jp');
}

// ======================================================
// 統計ボックス
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
// プレビュー（折りたたみ式）
// ======================================================
let _previewSample = null;
let _previewOpen = false;

function showPreview(sample) {
  _previewSample = sample;
  if (!sample || sample.length === 0) {
    $('preview-toggle-section').style.display = 'none';
    $('preview-section').style.display = 'none';
    return;
  }
  $('preview-toggle-section').style.display = '';
  $('preview-section').style.display = 'none';
  _previewOpen = false;
  $('btn-toggle-preview').textContent = '▶ プレビューを表示（先頭3件）';
}

function hidePreview() {
  _previewSample = null;
  _previewOpen = false;
  $('preview-toggle-section').style.display = 'none';
  $('preview-section').style.display = 'none';
}

function togglePreview() {
  if (!_previewSample) return;
  _previewOpen = !_previewOpen;
  if (_previewOpen) {
    $('preview-json').textContent = JSON.stringify(_previewSample, null, 2);
    $('preview-section').style.display = '';
    $('btn-toggle-preview').textContent = '▼ プレビューを隠す';
  } else {
    $('preview-section').style.display = 'none';
    $('btn-toggle-preview').textContent = '▶ プレビューを表示（先頭3件）';
  }
}

// ======================================================
// 保存件数を取得して表示
// ======================================================
async function refreshCount() {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  const n = (data[STORAGE_KEY] || []).length;
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
// タブ名入力欄の初期化・保存
// ======================================================
async function initTabNameInput() {
  const inputEl   = $('tab-name-input');
  const datalistEl = $('tabname-list');

  // ストレージから前回値・履歴を復元
  const stored = await chrome.storage.local.get([TABNAME_KEY, TABNAMES_KEY]);
  const lastVal  = stored[TABNAME_KEY] || '';
  const history  = stored[TABNAMES_KEY] || INITIAL_TABNAMES;

  inputEl.value = lastVal;

  // datalist に候補をセット
  function refreshDatalist(names) {
    datalistEl.innerHTML = '';
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      datalistEl.appendChild(opt);
    });
  }
  refreshDatalist(history);

  // 変更時に保存（change = フォーカスアウト or Enter）
  inputEl.addEventListener('change', async () => {
    const val = inputEl.value.trim();
    // 履歴を更新（先頭に追加・重複除去・最大10件）
    let names = (await chrome.storage.local.get([TABNAMES_KEY]))[TABNAMES_KEY] || INITIAL_TABNAMES;
    if (val) {
      names = [val, ...names.filter(n => n !== val)].slice(0, TABNAMES_MAX);
    }
    await chrome.storage.local.set({ [TABNAME_KEY]: val, [TABNAMES_KEY]: names });
    refreshDatalist(names);
  });
}

// ======================================================
// このページを抽出
// ======================================================
async function extractCurrentPage() {
  const tab = await getActiveTab();
  if (!isReinsPage(tab)) {
    setStatus('REINSの物件一覧ページを開いてください', 'warn');
    return;
  }

  const btn = $('btn-extract');
  btn.disabled = true;
  btn.textContent = '抽出中...';
  setStatus('抽出中...', '');
  hideStats();

  const tabName = $('tab-name-input').value.trim();

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'extract', tabName: tabName });

    if (resp && resp.ok) {
      $('count').textContent = resp.total;
      showStats(resp.extracted, resp.added, resp.skipped);
      showPreview(resp.sample);

      if (resp.extracted === 0) {
        setStatus('物件行が見つかりませんでした。デバッグ出力を確認してください。', 'error');
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
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  const records = data[STORAGE_KEY] || [];

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
  setStatus(records.length + '件をコピーしました - スプレッドシート条件シートに貼り付けてください', 'ok');
}

// ======================================================
// TSVをファイルとしてダウンロード
// ======================================================
async function downloadTSV() {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  const records = data[STORAGE_KEY] || [];

  if (records.length === 0) {
    setStatus('データがありません。先に抽出してください。', 'warn');
    return;
  }

  const tsv = recordsToTSV(records);

  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  const ts =
    d.getFullYear() +
    z(d.getMonth() + 1) +
    z(d.getDate()) + '_' +
    z(d.getHours()) +
    z(d.getMinutes()) +
    z(d.getSeconds());
  const filename = 'reins_' + ts + '.tsv';

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
  if (!isReinsPage(tab)) {
    setStatus('REINSのページを開いてください', 'warn');
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
  await chrome.storage.local.remove([STORAGE_KEY]);
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
  if (!isReinsPage(tab)) {
    setStatus('REINSの物件一覧ページを開いてください', 'warn');
  } else if (n > 0) {
    setStatus(n + '件 蓄積済み', 'ok');
  } else {
    setStatus('「このページを抽出」で抽出開始', '');
  }

  await initTabNameInput();

  $('btn-extract').addEventListener('click', extractCurrentPage);
  $('btn-copy').addEventListener('click', copyTSV);
  $('btn-download').addEventListener('click', downloadTSV);
  $('btn-debug').addEventListener('click', debugOutput);
  $('btn-clear').addEventListener('click', clearData);
  $('btn-toggle-preview').addEventListener('click', togglePreview);
});
