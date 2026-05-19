// ============================================================
// airdna_import.gs — CSV取込・AirDNA_DB書込・Import_Log記録
// ============================================================

// 日次トリガー（毎朝9時）: csv_import_folder_id を監視してCSVを処理
function processImportFolder() {
  const settings = getSettings();

  if (!settings.csv_import_folder_id) {
    console.log('processImportFolder: csv_import_folder_id が未設定');
    return;
  }

  let folder;
  try {
    folder = DriveApp.getFolderById(settings.csv_import_folder_id);
  } catch (e) {
    console.log('processImportFolder: フォルダ取得失敗 - ' + e.message);
    return;
  }

  const files = folder.getFilesByType(MimeType.CSV);
  let processed = 0;

  while (files.hasNext()) {
    const file = files.next();
    importCSVFile_(file, settings);
    processed++;
  }

  console.log(`processImportFolder: ${processed}件処理`);
}

// 単一CSVファイルをAirDNA_DBに取込
function importCSVFile_(file, settings) {
  const filename = file.getName();
  const info = parseFilename_(filename);

  if (!info) {
    moveFile_(file, settings.error_folder_id);
    appendImportLog_(null, '', '', filename, 0, 0, 'error', 'ファイル名が命名規則に合わない: ' + filename);
    return;
  }

  // ── Queueとの照合 ──────────────────────────────────────
  let queueRow = null;

  if (info.queue_id !== null) {
    queueRow = findQueueRowByQueueId(info.queue_id);
  }
  if (!queueRow) {
    queueRow = findQueueRowByMarketSubmarketDate(info.market, info.submarket, info.snapshot_date);
  }

  const queueId   = queueRow ? queueRow[QUEUE_COL.QUEUE_ID]         : null;
  const masterId  = queueRow ? queueRow[QUEUE_COL.SOURCE_MASTER_ID] : null;

  if (!queueRow) {
    console.log(`importCSVFile_: Queueに対応行なし（file=${filename}）。取込を続行。`);
  }

  // ── CSV解析 ────────────────────────────────────────────
  let csvData;
  try {
    let content;
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      content = file.getAs(MimeType.CSV).getDataAsString('UTF-8');
    } else {
      content = file.getBlob().getDataAsString('UTF-8');
    }
    csvData = parseCSVRobust_(content);
  } catch (e) {
    moveFile_(file, settings.error_folder_id);
    if (queueId) markQueueError(queueId, 'CSV解析失敗: ' + e.message);
    appendImportLog_(queueId, info.market, info.submarket, filename, 0, 0, 'error', 'CSV解析失敗: ' + e.message);
    return;
  }

  if (csvData.length < 2) {
    moveFile_(file, settings.error_folder_id);
    if (queueId) markQueueError(queueId, 'CSVにデータ行なし');
    appendImportLog_(queueId, info.market, info.submarket, filename, 0, 0, 'error', 'CSVにデータ行なし');
    return;
  }

  const csvHeaders = csvData[0];
  const dataRows   = csvData.slice(1);

  // ── DB書込 ────────────────────────────────────────────
  const dbSheet   = getSheet_(SHEET.DB);
  const importedAt = nowStr_();

  // 既存の同Submarket行をis_latest=FALSEに
  if (masterId) {
    markSubmarketIsLatestFalse_(dbSheet, masterId);
  }

  let nextDbId      = getNextId_(dbSheet);
  let rowsImported  = 0;
  let rowsSkipped   = 0;

  const newDbRows = [];

  for (const csvRow of dataRows) {
    // CSV行をキー付きオブジェクトに変換
    const rowObj = {};
    csvHeaders.forEach((h, i) => {
      const internalKey = CSV_COL_MAP[h.trim()];
      if (internalKey) rowObj[internalKey] = csvRow[i] || '';
    });

    const dedupeKey = buildDedupeKey_(masterId, rowObj, info.snapshot_date);

    // DB行を組み立て（DB_HEADERS順）
    const dbRow = DB_HEADERS.map(col => {
      switch (col) {
        case 'db_id':              return nextDbId;
        case 'submarket_master_id': return masterId || '';
        case 'queue_id':           return queueId  || '';
        case 'imported_at':        return importedAt;
        case 'snapshot_date':      return info.snapshot_date;
        case 'dedupe_key':         return dedupeKey;
        case 'is_latest':          return true;
        default:                   return rowObj[col] !== undefined ? rowObj[col] : '';
      }
    });

    newDbRows.push(dbRow);
    nextDbId++;
    rowsImported++;
  }

  if (newDbRows.length > 0) {
    dbSheet.getRange(dbSheet.getLastRow() + 1, 1, newDbRows.length, DB_HEADERS.length)
      .setValues(newDbRows);
  }

  // ── 後処理 ───────────────────────────────────────────
  const nowTime = nowStr_();

  if (queueId) markQueueImported(queueId, nowTime);
  if (masterId) updateMasterAfterImport(masterId, nowTime);

  appendImportLog_(queueId, info.market, info.submarket, filename, rowsImported, rowsSkipped, 'success', '');
  moveFile_(file, settings.processed_folder_id);

  console.log(`importCSVFile_: ${filename} → ${rowsImported}件取込`);
}

// ── 内部関数 ─────────────────────────────────────────────

// 同Submarketの既存DBレコードをis_latest=FALSEに一括更新
function markSubmarketIsLatestFalse_(dbSheet, masterId) {
  const lastRow = dbSheet.getLastRow();
  if (lastRow < 2) return;

  const masterIdColIdx  = DB_COL.MASTER_ID  + 1; // 1-indexed
  const isLatestColIdx  = DB_COL.IS_LATEST  + 1;
  const rowCount        = lastRow - 1;

  const masterIdValues  = dbSheet.getRange(2, masterIdColIdx, rowCount, 1).getValues();
  const isLatestValues  = dbSheet.getRange(2, isLatestColIdx, rowCount, 1).getValues();

  let changed = false;
  for (let i = 0; i < masterIdValues.length; i++) {
    if (String(masterIdValues[i][0]) === String(masterId) && isLatestValues[i][0] === true) {
      isLatestValues[i][0] = false;
      changed = true;
    }
  }

  if (changed) {
    dbSheet.getRange(2, isLatestColIdx, rowCount, 1).setValues(isLatestValues);
  }
}

// dedupe_key を生成
function buildDedupeKey_(masterId, rowObj, snapshotDate) {
  const airbnbId = (rowObj['airbnb_property_id'] || '').trim();
  const vrboId   = (rowObj['vrbo_property_id']   || '').trim();
  const url      = (rowObj['listing_url']         || '').trim();

  let baseKey;
  if (airbnbId) {
    baseKey = `${masterId}|${airbnbId}`;
  } else if (vrboId) {
    baseKey = `${masterId}|${vrboId}`;
  } else if (url) {
    baseKey = `${masterId}|${url}`;
  } else {
    const lat   = rowObj['latitude']  ? Math.round(parseFloat(rowObj['latitude'])  * 1000) : 0;
    const lng   = rowObj['longitude'] ? Math.round(parseFloat(rowObj['longitude']) * 1000) : 0;
    const title = (rowObj['title'] || '').slice(0, 30);
    baseKey = `${masterId}|${title}_${lat}_${lng}`;
  }

  return `${baseKey}|${snapshotDate}`;
}

// Import_Log に1行追記
function appendImportLog_(queueId, market, submarket, filename, rowsImported, rowsSkipped, status, errorMsg) {
  const sheet = getSheet_(SHEET.LOG);
  setSheetHeader_(sheet, LOG_HEADERS);
  const logId = getNextId_(sheet);

  sheet.appendRow([
    logId,         // log_id
    nowStr_(),     // imported_at
    queueId || '', // queue_id
    market,        // airdna_market
    submarket,     // airdna_submarket
    filename,      // file_name
    rowsImported,  // rows_imported
    rowsSkipped,   // rows_skipped
    status,        // status
    errorMsg       // error_message
  ]);
}

// Utilities.parseCsv の代替（BOM・CRLF・引用符内改行・エスケープに対応）
function parseCSVRobust_(csvText) {
  csvText = csvText.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch   = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuotes = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')  { inQuotes = true; }
      else if (ch === ',')  { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else                  { field += ch; }
    }
  }
  if (row.length > 0 || field !== '') { row.push(field); rows.push(row); }

  // 末尾の空行を除去
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();

  return rows;
}

// ファイルを指定フォルダに移動（フォルダIDが空の場合はスキップ）
function moveFile_(file, folderId) {
  if (!folderId) return;
  try {
    const destFolder = DriveApp.getFolderById(folderId);
    file.moveTo(destFolder);
  } catch (e) {
    console.log(`moveFile_: 移動失敗（folderId=${folderId}）- ` + e.message);
  }
}
