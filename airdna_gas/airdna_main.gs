// ============================================================
// airdna_main.gs — メニュー・トリガー・エントリーポイント
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AirDNA管理')
    .addItem('① マスタ初期化（初回のみ）', 'menuInitMaster')
    .addSeparator()
    .addItem('② キューを今すぐ構築',       'menuBuildQueue')
    .addItem('③ インポートフォルダを処理', 'menuProcessFolder')
    .addSeparator()
    .addItem('キュー状況を表示',            'menuShowQueueStatus')
    .addSeparator()
    .addItem('トリガーをセットアップ',      'setupTriggers')
    .addToUi();
}

// ── メニューハンドラ ─────────────────────────────────────

function menuInitMaster() {
  initializeSubmarketMaster();
}

function menuBuildQueue() {
  buildDailyExportQueue();
  SpreadsheetApp.getUi().alert('キューの構築が完了しました。\nAirDNA_Export_Queueシートを確認してください。');
}

function menuProcessFolder() {
  processImportFolder();
  SpreadsheetApp.getUi().alert('インポートフォルダの処理が完了しました。\nAirDNA_Import_Logシートを確認してください。');
}

function menuShowQueueStatus() {
  const sheet = getSheet_(SHEET.QUEUE);
  const rows  = readAllRows_(sheet);

  const counts = { queued: 0, downloaded: 0, imported: 0, error: 0, skipped: 0, other: 0 };
  rows.forEach(r => {
    const s = String(r[QUEUE_COL.STATUS]);
    counts[s] !== undefined ? counts[s]++ : counts.other++;
  });

  const msg = [
    `待機中 (queued):      ${counts.queued}`,
    `DL済み (downloaded):  ${counts.downloaded}`,
    `取込済 (imported):    ${counts.imported}`,
    `エラー (error):       ${counts.error}`,
    `スキップ (skipped):  ${counts.skipped}`,
    `合計:                ${rows.length}`
  ].join('\n');

  SpreadsheetApp.getUi().alert('Export Queue 状況\n\n' + msg);
}

// ── トリガー設定 ─────────────────────────────────────────

// 1回だけ実行してトリガーを登録する
function setupTriggers() {
  // 既存のトリガーを削除（重複防止）
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (['checkPropertyDBForOnDemand', 'buildDailyExportQueue', 'processImportFolder'].includes(fn)) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 毎朝7時: 物件DB照合（TODO枠）
  ScriptApp.newTrigger('checkPropertyDBForOnDemand')
    .timeBased().atHour(7).everyDays(1).create();

  // 毎朝8時: キュー構築
  ScriptApp.newTrigger('buildDailyExportQueue')
    .timeBased().atHour(8).everyDays(1).create();

  // 毎朝9時: CSVフォルダ処理
  ScriptApp.newTrigger('processImportFolder')
    .timeBased().atHour(9).everyDays(1).create();

  SpreadsheetApp.getUi().alert('トリガーを設定しました。\n・07:00 checkPropertyDBForOnDemand\n・08:00 buildDailyExportQueue\n・09:00 processImportFolder');
}

// ── Playwright連携 Web App エンドポイント ─────────────────
// [デプロイ手順]
//   拡張機能 → Apps Script → デプロイ → 新しいデプロイ
//   種類: ウェブアプリ / アクセス: 全員
// [認証設定]
//   プロジェクトの設定 → スクリプト プロパティ
//   → PLAYWRIGHT_TOKEN に任意のランダム文字列を登録
// [動作確認]
//   ブラウザで以下のURLにアクセスして JSON が返ればOK
//   https://script.google.com/macros/s/XXXXX/exec?token=（設定値）&limit=1

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};

  // トークン認証
  const token       = params.token || '';
  const storedToken = PropertiesService.getScriptProperties().getProperty('PLAYWRIGHT_TOKEN');
  if (!storedToken || token !== storedToken) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // limit パラメータ（省略時 = 10）
  const limit = parseInt(params.limit, 10) || 10;

  // Queue から status=queued の行を取得
  const queueRows  = readAllRows_(getSheet_(SHEET.QUEUE));
  const queuedRows = queueRows
    .filter(r => r[QUEUE_COL.STATUS] === 'queued')
    .slice(0, limit);

  // Master から search_text を結合（SOURCE_MASTER_ID をキーにマップ）
  const masterRows = readAllRows_(getSheet_(SHEET.MASTER));
  const masterMap  = {};
  masterRows.forEach(r => { masterMap[String(r[MASTER_COL.ID])] = r; });

  const result = queuedRows.map(r => {
    const masterId = String(r[QUEUE_COL.SOURCE_MASTER_ID]);
    const master   = masterMap[masterId] || {};
    return {
      queue_id:         r[QUEUE_COL.QUEUE_ID],
      filter_name:      master[MASTER_COL.FILTER_NAME] || '',
      airdna_market:    r[QUEUE_COL.MARKET],
      airdna_submarket: r[QUEUE_COL.SUBMARKET],
      search_text:      master[MASTER_COL.SEARCH_TEXT] || String(r[QUEUE_COL.SUBMARKET]).toLowerCase(),
      ward_jp:          r[QUEUE_COL.WARD_JP]
    };
  });

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
