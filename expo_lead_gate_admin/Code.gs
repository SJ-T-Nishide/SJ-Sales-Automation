/**
 * Code.gs
 * エキスポ資料共有ゲート — リード登録フォーム（メールでURL送信＋クリック計測）
 * Success Japan株式会社
 *
 * 本体: Googleスプレッドシートに紐づくApps Script（clasp管理）
 * デプロイ方法: clasp push → clasp deploy
 */

var CONFIG = {
  DEFAULT_RESOURCE_URL: 'https://drive.google.com/file/d/1IdBdAfGHDvK75VQIqsxZfrhz_oclheFa/view?usp=sharing',
  DEFAULT_BODY_TEMPLATE: '{name} 様\n\n' +
    'お申込みありがとうございます。(株)タスワンカンパニーでございます。民泊経営パッケージの資料をお送りいたします。\n\n' +
    '{url}\n\n' +
    '株式会社タスワンカンパニー\n' +
    '06-6147-3947\n' +
    'tasone.clients@gmail.com',
  SHEET_NAME: '登録者',
  HEADERS: ['初回登録日時', '名前', 'メールアドレス', '電話番号', '送信回数', '最終送信日時', 'クリック数', '最終クリック日時', '追跡トークン'],
  SHEET_SETTINGS: '設定',
  SETTINGS_URL_CELL: 'B1',
  SETTINGS_BODY_CELL: 'B2'
};

function getSettingsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_SETTINGS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_SETTINGS);
  }
  if (!normalize(sheet.getRange('A1').getValue())) {
    sheet.getRange('A1').setValue('資料URL');
    sheet.getRange(CONFIG.SETTINGS_URL_CELL).setValue(CONFIG.DEFAULT_RESOURCE_URL);
  }
  if (!normalize(sheet.getRange('A2').getValue())) {
    sheet.getRange('A2').setValue('メール本文テンプレート（{name}=お名前 / {url}=資料URLに置換）');
    sheet.getRange(CONFIG.SETTINGS_BODY_CELL).setValue(CONFIG.DEFAULT_BODY_TEMPLATE);
  }
  return sheet;
}

function getResourceUrl() {
  var sheet = getSettingsSheet();
  var url = normalize(sheet.getRange(CONFIG.SETTINGS_URL_CELL).getValue());
  return url || CONFIG.DEFAULT_RESOURCE_URL;
}

function getBodyTemplate() {
  var sheet = getSettingsSheet();
  var template = normalize(sheet.getRange(CONFIG.SETTINGS_BODY_CELL).getValue());
  return template || CONFIG.DEFAULT_BODY_TEMPLATE;
}

function doGet(e) {
  var clickToken = e && e.parameter && e.parameter.click;
  if (clickToken) {
    return handleClick(clickToken);
  }
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('資料お申し込み')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function handleClick(token) {
  var rowIndex = findRowByToken(token);
  if (rowIndex > 0) {
    markClicked(rowIndex);
  }
  var url = getResourceUrl();
  var html = '<!DOCTYPE html><html><head><base target="_top">' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<script>window.top.location.href = ' + JSON.stringify(url) + ';</script>' +
    '</head><body style="font-family:sans-serif;padding:24px;">' +
    '資料へ移動しています…<br>自動的に移動しない場合は ' +
    '<a href="' + url + '" target="_top">こちら</a> をクリックしてください。' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('資料へ移動');
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.setFrozenRows(1);
  }
  sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
  return sheet;
}

function normalize(v) {
  return (v || '').toString().trim();
}

function nowJst() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
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

function findRowByToken(token) {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var data = sheet.getRange(2, 1, lastRow - 1, CONFIG.HEADERS.length).getValues();
  var tokenNorm = normalize(token);
  if (!tokenNorm) return -1;
  for (var i = 0; i < data.length; i++) {
    if (normalize(data[i][8]) === tokenNorm) {
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
  sheet.getRange(rowIndex, 6).setValue(nowJst());
}

function markClicked(rowIndex) {
  var sheet = getSheet();
  var countCell = sheet.getRange(rowIndex, 7);
  var current = Number(countCell.getValue()) || 0;
  countCell.setValue(current + 1);
  sheet.getRange(rowIndex, 8).setValue(nowJst());
}

function buildTrackingUrl(token) {
  return ScriptApp.getService().getUrl() + '?click=' + encodeURIComponent(token);
}

var SENDER_ALIAS = 'tasone.clients@gmail.com';
var SENDER_NAME = '株式会社タスワンカンパニー';

function sendResourceEmail(email, name, trackingUrl) {
  var subject = '【民泊経営パッケージ】資料のご案内（タスワンカンパニー）';
  var body = getBodyTemplate()
    .replace(/\{name\}/g, name)
    .replace(/\{url\}/g, trackingUrl);

  var aliases = GmailApp.getAliases();
  if (aliases.indexOf(SENDER_ALIAS) === -1) {
    // エイリアス未登録・未認証。差出人は変わらないが、表示名と返信先だけ整えて確実に送る。
    Logger.log('[sendResourceEmail] ' + SENDER_ALIAS + ' はまだ送信エイリアスとして登録されていません。表示名のみで送信します。');
    MailApp.sendEmail(email, subject, body, { name: SENDER_NAME, replyTo: SENDER_ALIAS });
    return;
  }

  GmailApp.sendEmail(email, subject, body, {
    from: SENDER_ALIAS,
    name: SENDER_NAME
  });
}

/**
 * メール送信権限を認可するための一回限りの手動実行用関数。
 * GASエディタの関数選択で authorizeMailSending を選び「実行」を押すと、
 * MailApp.sendEmail の権限確認ダイアログが表示される。認可が済んだら削除してよい。
 */
function authorizeMailSending() {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '【認可テスト】メール送信権限の確認', 'このメールが届けば、メール送信権限の認可は完了です。');
}

/**
 * GmailApp（差出人エイリアス切り替え用）の権限を認可するための
 * 一回限りの手動実行用関数。GASエディタで選んで実行すると、
 * 通常のMailAppより広い「Gmail」権限の確認ダイアログが表示される。
 * 認可後、実行ログで tasone.clients@gmail.com が一覧に出ているか確認できる。
 */
function authorizeGmailSending() {
  var aliases = GmailApp.getAliases();
  Logger.log('登録済み送信エイリアス一覧: ' + JSON.stringify(aliases));
  if (aliases.indexOf(SENDER_ALIAS) === -1) {
    Logger.log('※ ' + SENDER_ALIAS + ' がまだ一覧に無い場合、Gmail側の「送信元アドレスの追加」で確認コードの認証が完了していない可能性があります。');
  }
}

/**
 * 過去に生の日付データとして保存された既存行の日時を、日本時間の文字列表示に
 * 一括で直すための一回限りの手動実行用関数。記録された絶対時刻自体は変えず、
 * 表示だけを日本時間で再フォーマットする。GASエディタで一度実行すればよい。
 */
function migrateTimestampsToJst() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  [1, 6, 8].forEach(function(col) {
    var range = sheet.getRange(2, col, lastRow - 1, 1);
    var values = range.getValues();
    var fixed = values.map(function(row) {
      var v = row[0];
      if (Object.prototype.toString.call(v) === '[object Date]') {
        return [Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')];
      }
      return [v];
    });
    range.setValues(fixed);
  });
}

/**
 * Google Formsルートの実験で作成した onExpoFormSubmit トリガーを取り除くための
 * 一回限りの手動実行用関数。実行後は削除してよい。
 */
function removeExpoFormTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onExpoFormSubmit') {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function upsertRegistrant(name, email, phone) {
  var sheet = getSheet();
  var existingRow = findRowIndex(email, phone);
  var token;
  if (existingRow > 0) {
    markSent(existingRow);
    token = normalize(sheet.getRange(existingRow, 9).getValue());
    if (!token) {
      token = Utilities.getUuid();
      sheet.getRange(existingRow, 9).setValue(token);
    }
  } else {
    token = Utilities.getUuid();
    sheet.appendRow([nowJst(), name, email, phone, 1, nowJst(), 0, '', token]);
  }
  sendResourceEmail(email, name, buildTrackingUrl(token));
}

function registerNew(data) {
  try {
    var name = normalize(data && data.name);
    var email = normalize(data && data.email);
    var phone = normalize(data && data.phone);
    if (!name || !email || !phone) {
      return { success: false, message: '名前・メールアドレス・電話番号をすべて入力してください。' };
    }
    upsertRegistrant(name, email, phone);
    return { success: true, message: 'ご入力いただいたメールアドレス宛に資料のURLをお送りしました。' };
  } catch (e) {
    Logger.log('[registerNew] ' + e.stack);
    return { success: false, message: '送信に失敗しました。時間をおいて再度お試しください。' };
  }
}
