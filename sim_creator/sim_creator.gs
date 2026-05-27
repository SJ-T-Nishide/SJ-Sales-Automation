// ============================================================
// sim_creator.gs — 詳細SIM自動作成
// 物件収集DB（1jeMlOY8oG4kqWPTpXBCpKz6LXm1xLC7P4cMHmnvEKME）に追加するGAS
//
// 使い方:
//   1. 物件シートで対象行を選択
//   2. メニュー「物件管理」→「詳細SIM作成」をクリック
// ============================================================

'use strict';

const SIM_TEMPLATE_SS_ID   = '1cwSq7yAF9BR9T-_7-gm13SEnvLZgzJ5YvJ61vOdV9SM';
const SIM_TEMPLATE_SHEET   = '分析データ';
const SIM_OUTPUT_FOLDER_ID = '1D3nyqVKPYtVj5DgK4K_E1JJ8hjlw_35j';

// 物件シートの列名（52列構成）
const COL = {
  PROPERTY_NO:  '物件番号',
  ADDRESS:      '所在地',
  BUILDING:     '建物名',
  RENT_MAN:     '賃料(万円)',
  AREA:         '面積(㎡)',
  DETAIL_STATUS:'detail_status',
  LAT:          'AirDNA_対象緯度',
  LNG:          'AirDNA_対象経度',
  SIM_DATE:     'AirDNA_SIM実行日時',
};

// ── メニューハンドラ ─────────────────────────────────────────
// ※ onOpen() は既存ファイルに定義済み。
//    既存の onOpen() 内に以下の1行を追加してメニュー登録してください:
//      .addItem('詳細SIM作成', 'menuCreateDetailSim')
function menuCreateDetailSim() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row   = sheet.getActiveRange().getRow();

  if (row <= 1) {
    SpreadsheetApp.getUi().alert('物件データの行を選択してから実行してください（ヘッダー行は不可）。');
    return;
  }

  try {
    const url = createDetailSim(sheet, row);
    SpreadsheetApp.getUi().alert('詳細SIMを作成しました。\n\n' + url);
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー: ' + e.message);
  }
}

// ── SIM作成本体 ──────────────────────────────────────────────
function createDetailSim(sheet, rowIndex) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowData = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];

  // ヘッダー名 → 値 のマップ
  function val(colName) {
    const idx = headers.indexOf(colName);
    return idx >= 0 ? rowData[idx] : '';
  }
  function colIdx(colName) {
    return headers.indexOf(colName); // 0-based
  }

  const propertyNo   = String(val(COL.PROPERTY_NO)  || '').trim();
  const buildingName = String(val(COL.BUILDING)      || '').trim();
  const address      = String(val(COL.ADDRESS)       || '').trim();
  const rentMan      = parseFloat(val(COL.RENT_MAN)  || 0);
  const area         = parseFloat(val(COL.AREA)      || 0);
  const lat          = parseFloat(val(COL.LAT)       || '');
  const lng          = parseFloat(val(COL.LNG)       || '');

  // バリデーション
  if (!propertyNo) throw new Error('物件番号が取得できません。選択行を確認してください。');
  if (isNaN(lat) || isNaN(lng) || !lat || !lng) {
    throw new Error(
      '緯度・経度（AE/AF列: AirDNA_対象緯度/AirDNA_対象経度）が入力されていません。\n' +
      '先に座標を入力してから再実行してください。'
    );
  }

  const rentYen  = Math.round(rentMan * 10000);
  const mapUrl   = 'https://maps.google.com/?q=' + lat + ',' + lng;
  const simTitle = '詳細SIM_' + (buildingName || address || propertyNo);

  // テンプレートをコピーして値を入力
  const simUrl = copyAndFillSimTemplate_({
    title: simTitle,
    lat, lng, area,
    rent: rentYen,
    mapUrl,
  });

  // 元シートのSIM実行日時を更新
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  const simDateIdx = colIdx(COL.SIM_DATE);
  if (simDateIdx >= 0) {
    sheet.getRange(rowIndex, simDateIdx + 1).setValue(nowStr);
  }

  // SIM結果管理シートに記録
  logToSimResultSheet_(propertyNo, buildingName, address, simUrl, nowStr);

  return simUrl;
}

// ── テンプレートコピー＆入力 ─────────────────────────────────
function copyAndFillSimTemplate_(params) {
  const { title, lat, lng, area, rent, mapUrl } = params;

  const templateSS    = SpreadsheetApp.openById(SIM_TEMPLATE_SS_ID);
  const templateSheet = templateSS.getSheetByName(SIM_TEMPLATE_SHEET);
  if (!templateSheet) {
    throw new Error('テンプレートシート「' + SIM_TEMPLATE_SHEET + '」が見つかりません。');
  }

  // 新スプレッドシートを作成（マイドライブに一時作成→フォルダ移動）
  const newSS = SpreadsheetApp.create(title);

  // テンプレートシートをコピー
  const copiedSheet = templateSheet.copyTo(newSS);
  copiedSheet.setName(SIM_TEMPLATE_SHEET);

  // 自動作成された「シート1」を削除
  const sheets = newSS.getSheets();
  sheets.forEach(s => {
    if (s.getName() !== SIM_TEMPLATE_SHEET) newSS.deleteSheet(s);
  });

  // 値を入力（数式を上書きしないよう値のみセット）
  copiedSheet.getRange('B5').setValue(mapUrl);
  copiedSheet.getRange('B6').setValue(area);
  copiedSheet.getRange('B7').setValue(rent);
  copiedSheet.getRange('D7').setValue(lat);
  copiedSheet.getRange('E7').setValue(lng);

  // 出力フォルダに移動
  const file   = DriveApp.getFileById(newSS.getId());
  const folder = DriveApp.getFolderById(SIM_OUTPUT_FOLDER_ID);
  folder.addFile(file);
  // マイドライブから除去
  file.getParents().next().removeFile(file);

  return newSS.getUrl();
}

// ── SIM結果管理シートに記録 ──────────────────────────────────
function logToSimResultSheet_(propertyNo, buildingName, address, simUrl, nowStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 「詳細SIM完了フラグ」列を持つシートを検索
  const resultSheet = findSheetByHeaderCol_(ss, '詳細SIM完了フラグ');
  if (!resultSheet) return;

  const headers    = resultSheet.getRange(1, 1, 1, resultSheet.getLastColumn()).getValues()[0];
  const propNoIdx  = headers.indexOf('物件番号');
  const simDateIdx = headers.indexOf('詳細SIM実行日時');
  const flagIdx    = headers.indexOf('詳細SIM完了フラグ');

  if (propNoIdx < 0) return;

  // 既存行を検索して更新
  const lastRow = resultSheet.getLastRow();
  if (lastRow >= 2) {
    const propNos = resultSheet.getRange(2, propNoIdx + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < propNos.length; i++) {
      if (String(propNos[i][0]).trim() === String(propertyNo).trim()) {
        const rowNum = i + 2;
        if (simDateIdx >= 0) resultSheet.getRange(rowNum, simDateIdx + 1).setValue(nowStr);
        if (flagIdx >= 0)    resultSheet.getRange(rowNum, flagIdx + 1).setValue(simUrl);
        return;
      }
    }
  }

  // 行が存在しない場合は末尾に追記
  const newRow = new Array(headers.length).fill('');
  newRow[propNoIdx] = propertyNo;
  if (headers.indexOf('建物名') >= 0) newRow[headers.indexOf('建物名')] = buildingName;
  if (headers.indexOf('所在地') >= 0) newRow[headers.indexOf('所在地')] = address;
  if (simDateIdx >= 0) newRow[simDateIdx] = nowStr;
  if (flagIdx >= 0)    newRow[flagIdx]    = simUrl;
  resultSheet.appendRow(newRow);
}

// ── ユーティリティ ──────────────────────────────────────────
function findSheetByHeaderCol_(ss, colName) {
  const sheets = ss.getSheets();
  for (const sheet of sheets) {
    if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) continue;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.includes(colName)) return sheet;
  }
  return null;
}
