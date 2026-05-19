/**
 * WebApp.gs
 * 買取・民泊契約書 Webアプリ版入力フォーム
 * Success Japan株式会社
 *
 * 固定保存先フォルダID: 1e9L5i7jkhGLm1J_zn6Rn6GmmCqXWclIB
 * デプロイ方法: デプロイを管理 → 既存デプロイを編集 → 新しいバージョン → 保存
 */

var FIXED_FOLDER_URL = 'https://drive.google.com/drive/folders/1e9L5i7jkhGLm1J_zn6Rn6GmmCqXWclIB';
var FIXED_FOLDER_ID  = '1e9L5i7jkhGLm1J_zn6Rn6GmmCqXWclIB';

function getLoginCredentials() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var configSheet = ss.getSheetByName(CONFIG.SHEET_CONFIG);
  if (!configSheet) return [];
  var credentials = [];
  var row = 17;
  while (row <= 40) {
    var id = configSheet.getRange('A' + row).getValue().toString().trim();
    var pw = configSheet.getRange('B' + row).getValue().toString().trim();
    if (!id || !pw) break;
    credentials.push({ id: id, pw: pw });
    row++;
  }
  return credentials;
}

function checkLogin(id, pw) {
  var credentials = getLoginCredentials();
  return credentials.some(function(c) { return c.id === id && c.pw === pw; });
}

function doGet() {
  return HtmlService.createHtmlOutput(getWebAppHtml())
    .setTitle('契約書 作成フォーム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getContract1Options() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_CANDIDATES);
  var defaults = [
    'スペースレンタル事業及び宿泊事業管理委託契約',
    '事業用賃貸借契約',
    '事業管理委託契約及び物件使用契約書',
    'なし',
    '直接入力'
  ];
  if (!sheet) return defaults;
  var values = sheet.getRange('A2:A30').getValues()
    .map(function(r) { return r[0].toString().trim(); })
    .filter(function(v) { return v !== ''; });
  return values.length > 0 ? values : defaults;
}

function createContractFromWeb(formData) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEET_FORM);
    if (!sheet) throw new Error('入力フォームシートが見つかりません');

    sheet.getRange('B4').setValue(formData.propertyAddress);
    sheet.getRange('B5').setValue(formData.propertyName);
    sheet.getRange('B6').setValue(formData.roomNumber);
    sheet.getRange('B10').setValue(new Date(formData.article1Date));
    sheet.getRange('B11').setValue(formData.contract1Name);
    sheet.getRange('B12').setValue(formData.contract2Name || '');
    sheet.getRange('B13').setValue(Number(formData.priceIncTax));
    sheet.getRange('B15').setValue(new Date(formData.paymentDeadline));
    sheet.getRange('B18').setValue(formData.confidentialDate);
    sheet.getRange('B19').setValue((formData.specialClause || '').replace(/\\n/g, '\n'));
    sheet.getRange('B22').setValue(formData.koEmail);
    sheet.getRange('B23').setValue(formData.koBuyer);
    sheet.getRange('B24').setValue(formData.heiAddress);
    sheet.getRange('B25').setValue(formData.heiName);
    sheet.getRange('B26').setValue(new Date(formData.contractDate));
    sheet.getRange('B29').setValue('');
    sheet.getRange('B30').setValue(FIXED_FOLDER_URL);

    var inputs = getInputValues();
    var errors = validateInputs(inputs);
    if (errors.length > 0) return { success: false, message: errors.join('\n') };

    var result = DocumentGen.generate(inputs);
    GmailDraft.create(inputs, result);
    saveToHistory(inputs, result);

    var historyRow = getLastHistoryRow();
    Logger.log('[WebApp] 作成完了 historyRow=' + historyRow);

    return {
      success:    true,
      message:    '作成完了！',
      docUrl:     result.docUrl,
      pdfUrl:     result.pdfUrl,
      fileName:   result.fileName,
      historyRow: historyRow
    };
  } catch (e) {
    Logger.log('[WebApp] createContractFromWeb エラー: ' + e.stack);
    return { success: false, message: e.message };
  }
}

function getLastHistoryRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_HISTORY);
  if (!sheet) return -1;
  return sheet.getLastRow();
}

// HTMLは長いため省略 — 実際のコードはGASエディタのWebApp.gsを参照
// getWebAppHtml() 関数はGASエディタ上の完全版を使用すること
function getWebAppHtml() {
  // NOTE: この関数の完全な実装はGASエディタ（スプレッドシートの拡張機能 → Apps Script）に存在します
  // このファイルはバックアップ・バージョン管理用です
  throw new Error('getWebAppHtml() はGASエディタの完全版を使用してください');
}
