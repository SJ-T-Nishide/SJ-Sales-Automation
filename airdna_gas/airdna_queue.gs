// ============================================================
// airdna_queue.gs — AirDNA_Export_Queue 管理
// ============================================================

// 日次トリガー（毎朝8時）: Masterを参照しキューを構築
function buildDailyExportQueue() {
  const settings = getSettings();
  const limit = settings.daily_export_limit;
  const today = todayStr_();

  const activeSubmarkets = getAllActiveSubmarkets();
  const queueSheet = getSheet_(SHEET.QUEUE);
  const existingQueue = readAllRows_(queueSheet);

  // 既にqueued/downloadedのsubmarket_master_idセット
  const alreadyQueuedIds = new Set(
    existingQueue
      .filter(r => ['queued', 'downloaded'].includes(r[QUEUE_COL.STATUS]))
      .map(r => String(r[QUEUE_COL.SOURCE_MASTER_ID]))
  );

  // 更新対象候補を絞り込み・ソート
  const candidates = activeSubmarkets
    .filter(r => {
      if (alreadyQueuedIds.has(String(r[MASTER_COL.ID]))) return false;
      const lastImported = r[MASTER_COL.LAST_IMPORTED];
      if (!lastImported || lastImported === '') return true; // 未取得
      const cycleDays = parseInt(r[MASTER_COL.CYCLE_DAYS], 10) || 30;
      const nextDue = addDays_(dateToStr_(lastImported), cycleDays);
      return today >= nextDue;
    })
    .sort((a, b) => {
      // priority昇順 → last_imported_at昇順（nullを先頭に）
      if (a[MASTER_COL.PRIORITY] !== b[MASTER_COL.PRIORITY]) {
        return a[MASTER_COL.PRIORITY] - b[MASTER_COL.PRIORITY];
      }
      const aDate = a[MASTER_COL.LAST_IMPORTED] || '0000-00-00';
      const bDate = b[MASTER_COL.LAST_IMPORTED] || '0000-00-00';
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    })
    .slice(0, limit);

  if (candidates.length === 0) {
    console.log('buildDailyExportQueue: 追加対象なし');
    return;
  }

  // Queue末尾のIDを取得して採番
  let nextQueueId = getNextId_(queueSheet);

  const newRows = candidates.map(r => {
    const qid = nextQueueId++;
    return [
      qid,                              // queue_id
      today,                            // run_date
      r[MASTER_COL.PRIORITY],          // priority
      r[MASTER_COL.PREFECTURE],        // prefecture
      r[MASTER_COL.CITY],              // city
      r[MASTER_COL.WARD_JP],           // ward_jp
      r[MASTER_COL.MARKET],            // airdna_market
      r[MASTER_COL.SUBMARKET],         // airdna_submarket
      false,                            // is_ondemand
      r[MASTER_COL.ID],                // source_submarket_id
      'queued',                         // status
      '',                               // downloaded_at
      '',                               // imported_at
      '',                               // csv_filename
      ''                                // error_message
    ];
  });

  queueSheet.getRange(queueSheet.getLastRow() + 1, 1, newRows.length, QUEUE_HEADERS.length)
    .setValues(newRows);

  // Masterのstatusをqueuedに更新
  const masterSheet = getSheet_(SHEET.MASTER);
  const masterRows = readAllRows_(masterSheet);
  const queuedIds = new Set(candidates.map(r => String(r[MASTER_COL.ID])));

  for (let i = 0; i < masterRows.length; i++) {
    if (queuedIds.has(String(masterRows[i][MASTER_COL.ID]))) {
      masterSheet.getRange(i + 2, MASTER_COL.STATUS + 1).setValue('queued');
    }
  }

  console.log(`buildDailyExportQueue: ${newRows.length}件をQueueに追加`);
}

// オンデマンド追加: 物件DB由来の優先キュー
function addOnDemandToQueue(submarket_master_id) {
  const queueSheet = getSheet_(SHEET.QUEUE);
  const existingQueue = readAllRows_(queueSheet);

  // queued/downloaded で既に存在する場合はスキップ
  const alreadyExists = existingQueue.some(r =>
    String(r[QUEUE_COL.SOURCE_MASTER_ID]) === String(submarket_master_id) &&
    ['queued', 'downloaded'].includes(r[QUEUE_COL.STATUS])
  );
  if (alreadyExists) {
    console.log(`addOnDemandToQueue: master_id=${submarket_master_id} は既にキュー済み`);
    return;
  }

  // Masterから情報を取得
  const masterSheet = getSheet_(SHEET.MASTER);
  const masterRows = readAllRows_(masterSheet);
  const masterRow = masterRows.find(r => String(r[MASTER_COL.ID]) === String(submarket_master_id));
  if (!masterRow) {
    console.log(`addOnDemandToQueue: master_id=${submarket_master_id} がMasterに見つからない`);
    return;
  }

  const qid = getNextId_(queueSheet);
  queueSheet.appendRow([
    qid,                                     // queue_id
    todayStr_(),                             // run_date
    1,                                       // priority（最高）
    masterRow[MASTER_COL.PREFECTURE],        // prefecture
    masterRow[MASTER_COL.CITY],             // city
    masterRow[MASTER_COL.WARD_JP],          // ward_jp
    masterRow[MASTER_COL.MARKET],           // airdna_market
    masterRow[MASTER_COL.SUBMARKET],        // airdna_submarket
    true,                                    // is_ondemand
    submarket_master_id,                     // source_submarket_id
    'queued',                                // status
    '',                                      // downloaded_at
    '',                                      // imported_at
    '',                                      // csv_filename
    ''                                       // error_message
  ]);

  // Masterのstatusを更新
  const rowIdx = masterRows.findIndex(r => String(r[MASTER_COL.ID]) === String(submarket_master_id));
  if (rowIdx >= 0) {
    masterSheet.getRange(rowIdx + 2, MASTER_COL.STATUS + 1).setValue('queued');
  }

  console.log(`addOnDemandToQueue: master_id=${submarket_master_id} をqueue_id=${qid}で追加`);
}

// 物件収集DBとの照合（枠のみ: 物件DB列構成が未確定）
function checkPropertyDBForOnDemand() {
  // TODO: 物件収集DBのシート名・列構成が確定次第実装
  console.log('checkPropertyDBForOnDemand: TODO not implemented');
}

// キューのstatusをdownloadedに更新（ファイルをフォルダに置いた時点で呼べる）
function markQueueDownloaded(queueId, csvFilename) {
  updateQueueRow_(queueId, {
    [QUEUE_COL.STATUS]:        'downloaded',
    [QUEUE_COL.DOWNLOADED_AT]: nowStr_(),
    [QUEUE_COL.CSV_FILENAME]:  csvFilename
  });
}

// キューのstatusをimportedに更新
function markQueueImported(queueId, importedAt) {
  updateQueueRow_(queueId, {
    [QUEUE_COL.STATUS]:      'imported',
    [QUEUE_COL.IMPORTED_AT]: importedAt
  });
}

// キューのstatusをerrorに更新
function markQueueError(queueId, errorMsg) {
  updateQueueRow_(queueId, {
    [QUEUE_COL.STATUS]:    'error',
    [QUEUE_COL.ERROR_MSG]: errorMsg
  });
}

// queue_idで行を検索して返す（存在しない場合はnull）
function findQueueRowByQueueId(queueId) {
  const rows = readAllRows_(getSheet_(SHEET.QUEUE));
  const row = rows.find(r =>
    String(r[QUEUE_COL.QUEUE_ID]) === String(queueId) &&
    ['queued', 'downloaded'].includes(r[QUEUE_COL.STATUS])
  );
  return row || null;
}

// market + submarket + snapshot_date でフォールバック検索
function findQueueRowByMarketSubmarketDate(market, submarket, snapshotDate) {
  const rows = readAllRows_(getSheet_(SHEET.QUEUE));
  const row = rows.find(r =>
    String(r[QUEUE_COL.MARKET])    === String(market) &&
    String(r[QUEUE_COL.SUBMARKET]) === String(submarket) &&
    ['queued', 'downloaded'].includes(r[QUEUE_COL.STATUS])
  );
  return row || null;
}

// ── 内部関数 ─────────────────────────────────────────────

function updateQueueRow_(queueId, colValueMap) {
  const sheet = getSheet_(SHEET.QUEUE);
  const rows = readAllRows_(sheet);

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][QUEUE_COL.QUEUE_ID]) === String(queueId)) {
      for (const [colIdx, value] of Object.entries(colValueMap)) {
        sheet.getRange(i + 2, parseInt(colIdx) + 1).setValue(value);
      }
      return;
    }
  }
}
