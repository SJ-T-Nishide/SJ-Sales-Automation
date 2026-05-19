// playwright_airdna.js — AirDNA Export 自動化
// 実行: npm start  または  run.bat
// 前提: npm run login で airdna-auth.json を生成済みであること
//       Node.js v18 以上（v24推奨）— fetch は標準利用

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

// ── 設定（.env から読み込み）──────────────────────────────────
const GAS_QUEUE_URL       = process.env.GAS_QUEUE_URL       || '';
const GAS_TOKEN           = process.env.GAS_TOKEN           || '';
const DOWNLOAD_TEMP_DIR   = process.env.DOWNLOAD_TEMP_DIR   || path.join(__dirname, 'airdna_temp');
const DRIVE_IMPORT_FOLDER = process.env.DRIVE_IMPORT_FOLDER || '';
const QUEUE_LIMIT         = parseInt(process.env.QUEUE_LIMIT, 10) || 1;
const HEADLESS            = process.env.HEADLESS === 'true';
const AUTH_PATH           = path.join(__dirname, 'airdna-auth.json');

// セレクタは Playwright Codegen で確認済み（2026-05-18）
// ① Market: page.locator('button').filter({ hasText: 'Market' })
// ② Export: page.getByRole('button', { name: 'Export' })

// ── メイン ────────────────────────────────────────────────────
(async () => {
  // 起動チェック
  if (!GAS_QUEUE_URL) {
    console.error('[error] .env の GAS_QUEUE_URL が未設定です');
    process.exit(1);
  }
  if (!GAS_TOKEN) {
    console.error('[error] .env の GAS_TOKEN が未設定です');
    process.exit(1);
  }
  if (!DRIVE_IMPORT_FOLDER) {
    console.error('[error] .env の DRIVE_IMPORT_FOLDER が未設定です');
    process.exit(1);
  }
  if (!fs.existsSync(AUTH_PATH)) {
    console.error('[error] airdna-auth.json が見つかりません。先に "npm run login" を実行してください。');
    process.exit(1);
  }
  if (!fs.existsSync(DRIVE_IMPORT_FOLDER)) {
    console.error(`[error] DRIVE_IMPORT_FOLDER が存在しません: ${DRIVE_IMPORT_FOLDER}`);
    console.error('        Google Drive for Desktop が起動・同期済みか確認してください。');
    process.exit(1);
  }

  // 一時フォルダ作成（なければ自動作成）
  fs.mkdirSync(DOWNLOAD_TEMP_DIR, { recursive: true });

  // キュー取得
  console.log(`[start] キュー取得 (QUEUE_LIMIT=${QUEUE_LIMIT})`);
  let queue;
  try {
    queue = await fetchQueue();
  } catch (e) {
    console.error('[error] キュー取得失敗:', e.message);
    process.exit(1);
  }

  if (!queue.length) {
    console.log('[info] 処理対象なし。終了します。');
    return;
  }
  console.log(`[info] ${queue.length}件を処理します`);

  // ブラウザ起動（認証状態を復元）
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    storageState:    AUTH_PATH,
    acceptDownloads: true,
  });
  const page = await context.newPage();

  let successCount = 0;
  for (const item of queue) {
    console.log(`\n[queue] queue_id=${item.queue_id}  filter="${item.filter_name}"`);
    try {
      await processItem(page, item);
      successCount++;
    } catch (e) {
      console.error(`[skip] queue_id=${item.queue_id}: ${e.message}`);
    }

    // 5〜10秒ランダム待機（次のキューへ）
    const ms = 5000 + Math.floor(Math.random() * 5000);
    console.log(`[wait] ${(ms / 1000).toFixed(1)}秒待機...`);
    await page.waitForTimeout(ms);
  }

  await browser.close();
  console.log(`\n[done] 処理完了 (成功=${successCount} / 全${queue.length}件)`);
})();

// ── キュー取得（GAS doGet を呼ぶ）──────────────────────────────
// Node.js v18+ の標準 fetch を使用（node-fetch 不要）
async function fetchQueue() {
  const url = `${GAS_QUEUE_URL}?token=${encodeURIComponent(GAS_TOKEN)}&limit=${QUEUE_LIMIT}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error('GAS API エラー: ' + data.error);
  return data;
}

// ── 1件の Export 処理（My Filters / Custom Region 方式）──────
async function processItem(page, item) {
  const { queue_id, filter_name } = item;

  if (!filter_name) {
    throw new Error(`filter_name が空です。MasterシートのQ列(filter_name)を設定してください`);
  }

  // リスティングページへ遷移（AirDNAは常時通信があるため load を使用）
  await page.goto('https://app.airdna.co/data/jp/listings', { waitUntil: 'load', timeout: 60000 });
  // Save ボタンが表示されるまで待機
  await page.locator('button').filter({ hasText: 'Save' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);

  // ─ ステップ1: Save ボタン → My Filters ダイアログを開く ────
  console.log('[step1] My Filters を開く');
  // Save ボタンをクリック（アイコン付きボタンを確実に特定）
  await page.getByRole('button', { name: /save/i }).click();
  await page.waitForTimeout(2000);

  // "Apply a Saved Filter" セクションを待機
  await page.getByText('Apply a Saved Filter').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);

  // ─ ステップ2: 保存済みフィルタ名をクリック ─────────────────
  console.log(`[step2] フィルタ選択: "${filter_name}"`);

  // フィルタ名をクリック（複数の方法を順に試す）
  await page.waitForTimeout(500);
  let filterClicked = false;

  // 方法①: 直接テキスト一致
  try {
    await page.getByText(filter_name).first().click({ timeout: 5000 });
    filterClicked = true;
    console.log('[step2] 直接テキストでクリック成功');
  } catch (_) {}

  // 方法②: "Apply a Saved Filter" の直後の要素をクリック（文字コード差異を回避）
  if (!filterClicked) {
    try {
      const items = page.getByText('Apply a Saved Filter')
        .locator('xpath=following::p | following::li | following::div[not(contains(@class,"button"))]')
        .first();
      await items.click({ timeout: 5000 });
      filterClicked = true;
      console.log('[step2] XPath相対位置でクリック成功');
    } catch (_) {}
  }

  // 方法③: 先頭2文字で部分一致（最終手段）
  if (!filterClicked) {
    const partial = filter_name.slice(0, 2);
    try {
      await page.getByText(partial).first().click({ timeout: 5000 });
      filterClicked = true;
      console.log(`[step2] 部分一致 "${partial}" でクリック成功`);
    } catch (_) {}
  }

  if (!filterClicked) {
    throw new Error(`フィルタ "${filter_name}" をクリックできませんでした`);
  }
  await page.waitForTimeout(1000);
  await page.waitForTimeout(500);

  // ─ ステップ3: Apply クリック ────────────────────────────────
  console.log('[step3] Apply クリック');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.waitForLoadState('load', { timeout: 60000 });
  await page.waitForTimeout(3000);

  // ─ ステップ4: Export クリック → ダウンロード待機 ────────────
  console.log('[step4] Export クリック → ダウンロード待機（最大60秒）');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);

  // ─ ステップ5: リネームして Drive フォルダに保存 ─────────────
  const dateStr  = todayDateStr();
  const qidStr   = String(queue_id).padStart(6, '0');
  // ファイル名に使えない文字を除去（・は許容、\ / : * ? " < > | は除去）
  const safeName = filter_name.replace(/[\\/:*?"<>|]/g, '_');
  const newName  = `Q${qidStr}__${safeName}__${dateStr}.csv`;
  const tempPath = path.join(DOWNLOAD_TEMP_DIR, download.suggestedFilename());
  const destPath = path.join(DRIVE_IMPORT_FOLDER, newName);

  await download.saveAs(tempPath);
  fs.copyFileSync(tempPath, destPath);
  fs.unlinkSync(tempPath);

  console.log(`[ok] 保存: ${newName}`);
}

// ── ユーティリティ ─────────────────────────────────────────────
function todayDateStr() {
  const d  = new Date();
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}
