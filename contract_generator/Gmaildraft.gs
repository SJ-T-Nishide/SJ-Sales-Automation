/**
 * Gmaildraft.gs
 * Gmail下書き作成モジュール
 */

const GmailDraft = {

  create: function(inputs, result) {
    const subject = this._getSubject(inputs);
    const body    = this._getBody(inputs, result);
    GmailApp.createDraft(inputs.koEmail, subject, body);
    Logger.log(`[GmailDraft] 下書き作成完了: ${inputs.koEmail}`);
  },

  _getSubject: function(inputs) {
    const tmpl = this._getTemplate();
    const subject = tmpl.subject ||
      `【ご確認依頼】買取契約書の電子締結について（${inputs.propertyName}${inputs.roomNumber}）`;
    return this._replaceTmplVars(subject, inputs, {});
  },

  _getBody: function(inputs, result) {
    const tmpl = this._getTemplate();
    const body = tmpl.body || this._defaultBody();
    return this._replaceTmplVars(body, inputs, result);
  },

  _getTemplate: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Gmailテンプレート');
    if (!sheet) return { subject: '', body: '' };
    const subject = sheet.getRange('B2').getValue().toString().trim();
    const body    = sheet.getRange('B3').getValue().toString().trim();
    return { subject, body };
  },

  _replaceTmplVars: function(text, inputs, result) {
    return text
      .replace(/\{\{氏名\}\}/g,     inputs.koBuyer || '')
      .replace(/\{\{物件名\}\}/g,   inputs.propertyFullName || '')
      .replace(/\{\{物件\}\}/g,     inputs.propertyName + (inputs.roomNumber || ''))
      .replace(/\{\{買取金額\}\}/g, inputs.priceFormatted || '')
      .replace(/\{\{決済期限\}\}/g, inputs.paymentDeadlineFormatted || '')
      .replace(/\{\{DocURL\}\}/g,   (result && result.docUrl) || '')
      .replace(/\{\{PDFURL\}\}/g,   (result && result.pdfUrl) || '');
  },

  _defaultBody: function() {
    return `{{氏名}}様

お世話になっております。
Success Japan株式会社です。

{{物件名}}に関する買取契約書の電子契約を作成いたしました。

お手数ですが、マネーフォワードクラウド契約より以下をご入力のうえ、
内容をご確認・ご締結ください。

■ ご入力いただく項目
・振込先口座
・住所
・名称

■ 電子契約ご確認URL
（※担当者がマネーフォワードクラウド契約のURLをご確認後、こちらに記載してご送信ください）

ご不明な点がございましたら、お気軽にご連絡ください。
どうぞよろしくお願いいたします。

━━━━━━━━━━━━━━━━━━━━━━━━
Success Japan株式会社
〒556-0013 大阪府大阪市浪速区元町2-8-20
━━━━━━━━━━━━━━━━━━━━━━━━`;
  }
};
