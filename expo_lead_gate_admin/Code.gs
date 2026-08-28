/**
 * Code.gs
 * エキスポ資料共有ゲート — リード登録フォーム（メールでURL送信するだけの簡易版）
 * Success Japan株式会社
 *
 * 本体: Googleスプレッドシートに紐づくApps Script（clasp管理）
 * デプロイ方法: clasp push → clasp deploy
 */

var CONFIG = {
  DEFAULT_RESOURCE_URL: 'https://drive.google.com/file/d/1IdBdAfGHDvK75VQIqsxZfrhz_oclheFa/view?usp=sharing',
  SHEET_NAME: '登録者',
  HEADERS: ['初回登録日時', '名前', 'メールアドレス', '電話番号', '送信回数', '最終送信日時'],
  SHEET_SETTINGS: '設定',
  SETTINGS_URL_CELL: 'B1'
};

function getResourceUrl() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_SETTINGS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_SETTINGS);
    sheet.getRange('A1').setValue('資料URL');
    sheet.getRange(CONFIG.SETTINGS_URL_CELL).setValue(CONFIG.DEFAULT_RESOURCE_URL);
  }
  var url = normalize(sheet.getRange(CONFIG.SETTINGS_URL_CELL).getValue());
  return url || CONFIG.DEFAULT_RESOURCE_URL;
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('資料お申し込み')
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

function markSent(rowIndex) {
  var sheet = getSheet();
  var countCell = sheet.getRange(rowIndex, 5);
  var current = Number(countCell.getValue()) || 0;
  countCell.setValue(current + 1);
  sheet.getRange(rowIndex, 6).setValue(new Date());
}

function sendResourceEmail(email, name) {
  var subject = '【Success Japan】資料のご案内';
  var body = name + ' 様\n\n' +
    'お申し込みいただきありがとうございます。\n' +
    '下記のURLより資料をご覧いただけます。\n\n' +
    getResourceUrl() + '\n';
  MailApp.sendEmail(email, subject, body);
}

/**
 * メール送信権限を認可するための一回限りの手動実行用関数。
 * GASエディタの関数選択で authorizeMailSending を選び「実行」を押すと、
 * MailApp.sendEmail の権限確認ダイアログが表示される。認可が済んだら削除してよい。
 */
function authorizeMailSending() {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '【認可テスト】メール送信権限の確認', 'このメールが届けば、メール送信権限の認可は完了です。');
}

function registerNew(data) {
  try {
    var name = normalize(data && data.name);
    var email = normalize(data && data.email);
    var phone = normalize(data && data.phone);
    if (!name || !email || !phone) {
      return { success: false, message: '名前・メールアドレス・電話番号をすべて入力してください。' };
    }

    var sheet = getSheet();
    var existingRow = findRowIndex(email, phone);
    if (existingRow > 0) {
      markSent(existingRow);
    } else {
      sheet.appendRow([new Date(), name, email, phone, 1, new Date()]);
    }

    sendResourceEmail(email, name);
    return { success: true, message: 'ご入力いただいたメールアドレス宛に資料のURLをお送りしました。' };
  } catch (e) {
    Logger.log('[registerNew] ' + e.stack);
    return { success: false, message: '送信に失敗しました。時間をおいて再度お試しください。' };
  }
}
