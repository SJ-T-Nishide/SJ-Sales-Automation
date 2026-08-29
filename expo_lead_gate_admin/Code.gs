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
  SETTINGS_BODY_CELL: 'B2',
  SETTINGS_METHOD_CELL: 'B3'
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
  if (!normalize(sheet.getRange('A3').getValue())) {
    sheet.getRange('A3').setValue('送信方式（gmail_api = 既定 / mailapp = 従来方式に切り戻す）');
    sheet.getRange(CONFIG.SETTINGS_METHOD_CELL).setValue('gmail_api');
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
// From: ヘッダーの表示名も日本語なのでMIMEエンコードが必要
var SENDER_NAME_ENCODED = '=?UTF-8?B?' + Utilities.base64Encode(SENDER_NAME, Utilities.Charset.UTF_8) + '?=';

/**
 * MailApp/GmailAppの失敗をメールに頼らず確認するための診断ログ。
 * 「エラーログ」シートに日時・発生箇所・内容を追記する。
 */
function logSendError(context, err) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('エラーログ');
    if (!sheet) {
      sheet = ss.insertSheet('エラーログ');
      sheet.getRange(1, 1, 1, 3).setValues([['日時', '発生箇所', '内容']]);
    }
    sheet.appendRow([nowJst(), context, String((err && err.stack) || err)]);
  } catch (e2) {
    // ログ書き込み自体が失敗した場合は諦める
  }
}

/**
 * 送信方式を「設定」シートB3から読む。
 * 空欄/'gmail_api' → Gmail REST API（既定）、'mailapp' → 従来のMailApp。
 * 再デプロイなしで切り戻せるようにするための仕組み。
 */
function getSendMethod() {
  var sheet = getSettingsSheet();
  var v = normalize(sheet.getRange(CONFIG.SETTINGS_METHOD_CELL).getValue()).toLowerCase();
  return v === 'mailapp' ? 'mailapp' : 'gmail_api';
}

/**
 * 文字列をbase64url（+→-, /→_, 末尾の=除去）に変換する。
 * Gmail APIのraw形式が要求する形。
 */
function toBase64Url(bytes) {
  return Utilities.base64Encode(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 日本語の件名をMIME encoded-word形式にする。
 * これをしないと受信側で文字化けする。
 */
function encodeSubject(subject) {
  return '=?UTF-8?B?' + Utilities.base64Encode(subject, Utilities.Charset.UTF_8) + '?=';
}

/**
 * Gmail REST APIで直接送信する。UrlFetchApp経由なので、
 * 枯渇したApps ScriptのMailApp送信枠を消費しない。
 * 成功なら true、失敗なら false（例外は投げない）。
 */
function sendViaGmailApi(to, subject, body) {
  try {
    var raw =
      'From: ' + SENDER_NAME_ENCODED + ' <' + SENDER_ALIAS + '>\r\n' +
      'To: ' + to + '\r\n' +
      'Subject: ' + encodeSubject(subject) + '\r\n' +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/plain; charset="UTF-8"\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      '\r\n' +
      Utilities.base64Encode(body, Utilities.Charset.UTF_8);

    var res = UrlFetchApp.fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ raw: toBase64Url(Utilities.newBlob(raw).getBytes()) }),
        muteHttpExceptions: true
      }
    );

    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return true;

    // Gmail APIは例外ではなくHTTPステータスで失敗を返すため、明示的に判定する
    logSendError('sendViaGmailApi(' + to + ') HTTP ' + code, res.getContentText());
    return false;
  } catch (err) {
    logSendError('sendViaGmailApi(' + to + ')', err);
    return false;
  }
}

/**
 * Apps Scriptの拡張サービス(Advanced Service)経由でGmail APIを呼ぶ。
 * UrlFetchApp版と同じくMailApp送信枠を消費しないが、
 * HTTPを手組みしない分こちらのほうが素直。Gmail拡張サービスが
 * 有効になっていない環境では Gmail が未定義になるため、その場合はfalseを返す。
 */
function sendViaGmailAdvanced(to, subject, body) {
  try {
    if (typeof Gmail === 'undefined') {
      logSendError('sendViaGmailAdvanced', 'Gmail拡張サービスが有効になっていません');
      return false;
    }
    var raw =
      'From: ' + SENDER_NAME_ENCODED + ' <' + SENDER_ALIAS + '>\r\n' +
      'To: ' + to + '\r\n' +
      'Subject: ' + encodeSubject(subject) + '\r\n' +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/plain; charset="UTF-8"\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      '\r\n' +
      Utilities.base64Encode(body, Utilities.Charset.UTF_8);

    Gmail.Users.Messages.send({ raw: toBase64Url(Utilities.newBlob(raw).getBytes()) }, 'me');
    return true;
  } catch (err) {
    logSendError('sendViaGmailAdvanced(' + to + ')', err);
    return false;
  }
}

/**
 * 従来のMailApp送信。切り戻し用に残してある（削除しないこと）。
 */
function sendViaMailApp(to, subject, body) {
  try {
    MailApp.sendEmail(to, subject, body);
    return true;
  } catch (err) {
    logSendError('MailApp.sendEmail(' + to + ') 残り送信可能数=' + getRemainingQuotaSafe(), err);
    return false;
  }
}

/**
 * 資料メールを送る。送信できたら true、失敗したら false を返す（例外は投げない）。
 * メール送信は日次上限などで落ちうるが、それで登録処理全体を失敗させない。
 */
function sendResourceEmail(email, name, trackingUrl) {
  var subject = '【民泊経営パッケージ】資料のご案内（タスワンカンパニー）';
  var body = getBodyTemplate()
    .replace(/\{name\}/g, name)
    .replace(/\{url\}/g, trackingUrl);

  if (getSendMethod() === 'mailapp') {
    return sendViaMailApp(email, subject, body);
  }

  // 既定はGmail API。REST版 → 拡張サービス版 → MailApp の順に試す（三重の保険）
  if (sendViaGmailApi(email, subject, body)) return true;
  if (sendViaGmailAdvanced(email, subject, body)) return true;
  return sendViaMailApp(email, subject, body);
}

/**
 * Gmail API送信が枯渇枠を回避できているかを、本番切り替え前に確認するための
 * 手動実行用関数。GASエディタで実行し、自分宛に1通届けば成功。
 */
function testGmailApiSend() {
  var to = Session.getEffectiveUser().getEmail();
  var quota = getRemainingQuotaSafe();
  var bodyOf = function(route) {
    return 'このメールが届いていれば、' + route + '経由の送信は成功しています。\n' +
      'MailApp残り送信可能数: ' + quota + '\n' +
      '（この数値がマイナスや0のままでも届いていれば、枯渇枠の回避に成功しています）';
  };

  var rest = sendViaGmailApi(to, '【テスト1】Gmail API(REST)送信の確認', bodyOf('Gmail API(REST)'));
  var adv = sendViaGmailAdvanced(to, '【テスト2】Gmail拡張サービス送信の確認', bodyOf('Gmail拡張サービス'));

  var summary = 'REST版=' + (rest ? '成功' : '失敗') +
    ' / 拡張サービス版=' + (adv ? '成功' : '失敗') +
    ' / MailApp残り=' + quota + ' / 宛先=' + to;
  Logger.log(summary);
  logSendError('testGmailApiSend（エラーではありません）', summary);
}

function getRemainingQuotaSafe() {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch (e) {
    return '取得失敗';
  }
}

/**
 * 本日あと何通送れるかを確認するための手動実行用関数。
 * 「エラーログ」シートにも記録するので、GASエディタのログが見られない場合でも確認できる。
 */
function checkMailQuota() {
  var remaining = getRemainingQuotaSafe();
  var who = '';
  try { who = Session.getEffectiveUser().getEmail(); } catch (e) { who = '不明'; }
  Logger.log('実行アカウント: ' + who + ' / 本日の残り送信可能数: ' + remaining);
  logSendError('checkMailQuota（エラーではありません）', '実行アカウント=' + who + ' 残り送信可能数=' + remaining);
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
  var trackingUrl = buildTrackingUrl(token);
  var emailSent = sendResourceEmail(email, name, trackingUrl);
  return { url: trackingUrl, emailSent: emailSent };
}

function registerNew(data) {
  try {
    var name = normalize(data && data.name);
    var email = normalize(data && data.email);
    var phone = normalize(data && data.phone);
    if (!name || !email || !phone) {
      return { success: false, message: '名前・メールアドレス・電話番号をすべて入力してください。' };
    }
    var result = upsertRegistrant(name, email, phone);

    // 資料はメールでのみ渡す。虚偽のメールアドレスでは受け取れないようにするため、
    // 画面上に資料URLは一切出さない。送信できなければ失敗として扱う。
    if (!result.emailSent) {
      return {
        success: false,
        message: 'メールを送信できませんでした。お手数ですがスタッフにお声がけください。'
      };
    }
    return {
      success: true,
      message: 'ご登録ありがとうございます。ご入力のメールアドレス宛に資料をお送りしました。'
    };
  } catch (e) {
    Logger.log('[registerNew] ' + e.stack);
    logSendError('registerNew', e);
    return { success: false, message: '送信に失敗しました。時間をおいて再度お試しください。' };
  }
}
