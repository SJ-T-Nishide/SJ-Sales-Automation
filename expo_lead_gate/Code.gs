/**
 * Code.gs
 * エキスポ資料共有ゲート — リード登録Webフォーム
 * Success Japan株式会社
 *
 * 本体: Googleスプレッドシートに紐づくApps Script（clasp管理）
 * デプロイ方法: clasp push → clasp deploy
 */

var CONFIG = {
  SLIDE_ID: '16wVlmSRrnOucCxOOFoTK8tBxMFfi47eD',
  SHEET_NAME: '登録者',
  HEADERS: ['初回登録日時', '名前', 'メールアドレス', '電話番号', '閲覧回数', '最終閲覧日時']
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('資料閲覧のご案内')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function normalize(v) {
  return (v || '').toString().trim();
}

function normalizePhone(v) {
  return normalize(v).replace(/[^0-9]/g, '');
}

function findRowIndex(email, phone) {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var data = sheet.getRange(2, 1, lastRow - 1, CONFIG.HEADERS.length).getValues();
  var emailNorm = normalize(email).toLowerCase();
  var phoneNorm = normalizePhone(phone);
  for (var i = 0; i < data.length; i++) {
    var rowEmail = normalize(data[i][2]).toLowerCase();
    var rowPhone = normalizePhone(data[i][3]);
    if ((emailNorm && rowEmail === emailNorm) || (phoneNorm && rowPhone === phoneNorm)) {
      return i + 2;
    }
  }
  return -1;
}

function markVisit(rowIndex) {
  var sheet = getSheet();
  var countCell = sheet.getRange(rowIndex, 5);
  var current = Number(countCell.getValue()) || 0;
  countCell.setValue(current + 1);
  sheet.getRange(rowIndex, 6).setValue(new Date());
}

function getSlideEmbedUrl() {
  return 'https://docs.google.com/presentation/d/' + CONFIG.SLIDE_ID + '/embed?start=false&loop=false&delayms=5000';
}

function registerNew(data) {
  try {
    var name = normalize(data && data.name);
    var email = normalize(data && data.email);
    var phone = normalize(data && data.phone);
    if (!name || !email || !phone) {
      return { success: false, message: '名前・メールアドレス・電話番号をすべて入力してください。' };
    }
    var existingRow = findRowIndex(email, phone);
    if (existingRow > 0) {
      markVisit(existingRow);
    } else {
      getSheet().appendRow([new Date(), name, email, phone, 1, new Date()]);
    }
    return { success: true, slideUrl: getSlideEmbedUrl() };
  } catch (e) {
    Logger.log('[registerNew] ' + e.stack);
    return { success: false, message: '登録に失敗しました。時間をおいて再度お試しください。' };
  }
}

function lookupReturning(contact) {
  try {
    var value = normalize(contact);
    if (!value) {
      return { success: false, message: 'メールアドレスまたは電話番号を入力してください。' };
    }
    var rowIndex = findRowIndex(value, value);
    if (rowIndex < 0) {
      return { success: false, message: '登録が見つかりませんでした。お手数ですが初回登録をお願いします。' };
    }
    markVisit(rowIndex);
    return { success: true, slideUrl: getSlideEmbedUrl() };
  } catch (e) {
    Logger.log('[lookupReturning] ' + e.stack);
    return { success: false, message: '確認に失敗しました。時間をおいて再度お試しください。' };
  }
}
