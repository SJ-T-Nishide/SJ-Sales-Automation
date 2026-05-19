/**
 * slack_notify.gs
 * Slack通知モジュール（複数Webhook対応）
 *
 * 列構成（履歴シート）
 *   K列（index=10）: ステータス
 *   L列（index=11）: 締結完了日時（=通知済み判定列として兼用）
 */

const HISTORY_STATUS_COL   = 11;
const HISTORY_NOTIFIED_COL = 12;

const SlackNotify = {

  send: function(inputs, result) {
    const urls = this._getWebhookUrls();
    if (urls.length === 0) {
      Logger.log('[SlackNotify] Slack Webhook URLが設定されていません');
      return;
    }
    const message = this._buildMessage(inputs, result);
    let successCount = 0;
    urls.forEach(function(webhookUrl, idx) {
      try {
        const response = UrlFetchApp.fetch(webhookUrl, {
          method: 'POST',
          contentType: 'application/json',
          payload: JSON.stringify({ text: message, unfurl_links: true, link_names: true }),
          muteHttpExceptions: true
        });
        if (response.getResponseCode() === 200) {
          successCount++;
        } else {
          Logger.log('[SlackNotify] 送信失敗 URL' + (idx + 1) + ': ' + response.getContentText());
        }
      } catch (e) {
        Logger.log('[SlackNotify] エラー URL' + (idx + 1) + ': ' + e.message);
      }
    });
    Logger.log('[SlackNotify] ' + successCount + '/' + urls.length + '件送信完了');
  },

  _getWebhookUrls: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName(CONFIG.SHEET_CONFIG);
    if (!configSheet) return [];
    const urls = [];
    let row = 11;
    while (row <= 30) {
      const val = configSheet.getRange('B' + row).getValue().toString().trim();
      if (!val) break;
      if (val.startsWith('https://hooks.slack.com/')) urls.push(val);
      row++;
    }
    return urls;
  },

  _buildMessage: function(inputs, result) {
    const mentionLine = inputs.mentions ? inputs.mentions + '\n\n' : '';
    return mentionLine +
      '✅ *買取契約の締結が完了しました*\n\n' +
      '📍 物件：' + inputs.propertyFullName + '\n' +
      '👤 甲：' + inputs.koBuyer + '\n' +
      '🏢 丙：' + inputs.heiName + '\n' +
      '💰 買取金額：' + inputs.priceFormatted + '\n' +
      '📅 決済期限：' + inputs.paymentDeadlineFormatted + '\n\n' +
      '📄 契約書：\n' +
      '• Googleドキュメント：' + result.docUrl + '\n' +
      '• PDF：' + result.pdfUrl + '\n\n' +
      '内容をご確認ください。';
  },

  _getMentions: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(CONFIG.SHEET_FORM);
    if (!formSheet) return '';
    return [
      formSheet.getRange('B34').getValue().toString().trim(),
      formSheet.getRange('B35').getValue().toString().trim(),
      formSheet.getRange('B36').getValue().toString().trim()
    ].filter(function(v) { return v !== ''; }).join(' ');
  },

  notifyRow: function(rowIndex, forceResend) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const historySheet = ss.getSheetByName(CONFIG.SHEET_HISTORY);
    if (!historySheet) {
      return { success: false, message: '履歴シートが見つかりません' };
    }
    const lastRow = historySheet.getLastRow();
    if (rowIndex < 2 || rowIndex > lastRow) {
      return { success: false, message: '行番号が範囲外です（行: ' + rowIndex + '、最終行: ' + lastRow + '）' };
    }
    const rowData      = historySheet.getRange(rowIndex, 1, 1, HISTORY_NOTIFIED_COL).getValues()[0];
    const status       = rowData[HISTORY_STATUS_COL - 1] ? rowData[HISTORY_STATUS_COL - 1].toString().trim() : '';
    const notifiedDate = rowData[HISTORY_NOTIFIED_COL - 1] ? rowData[HISTORY_NOTIFIED_COL - 1].toString().trim() : '';

    if (status !== '作成済' && status !== '締結完了') {
      return { success: false, message: 'ステータスが対象外です（現在: 「' + status + '」）' };
    }
    if (!forceResend && notifiedDate !== '') {
      return { success: false, message: '既にSlack通知済みです（通知日時: ' + notifiedDate + '）' };
    }

    const inputs = {
      propertyFullName:         rowData[1] ? rowData[1].toString() : '',
      koBuyer:                  rowData[2] ? rowData[2].toString() : '',
      heiName:                  rowData[4] ? rowData[4].toString() : '',
      priceFormatted:           rowData[5] ? rowData[5].toString() : '',
      paymentDeadlineFormatted: rowData[6] ? rowData[6].toString() : '',
      mentions: this._getMentions()
    };
    const result = {
      docUrl: rowData[7] ? rowData[7].toString() : '',
      pdfUrl: rowData[8] ? rowData[8].toString() : ''
    };

    this.send(inputs, result);

    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    historySheet.getRange(rowIndex, HISTORY_STATUS_COL).setValue('締結完了');
    historySheet.getRange(rowIndex, HISTORY_NOTIFIED_COL).setValue(now);

    return { success: true, message: '通知しました（行: ' + rowIndex + '）' };
  },

  checkAndNotifyAll: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const historySheet = ss.getSheetByName(CONFIG.SHEET_HISTORY);
    if (!historySheet) return 0;
    const lastRow = historySheet.getLastRow();
    if (lastRow < 2) return 0;

    const allData  = historySheet.getRange(2, 1, lastRow - 1, HISTORY_NOTIFIED_COL).getValues();
    const mentions = this._getMentions();
    let notifyCount = 0;

    for (let i = 0; i < allData.length; i++) {
      const row          = allData[i];
      const actualRow    = i + 2;
      const status       = row[HISTORY_STATUS_COL - 1] ? row[HISTORY_STATUS_COL - 1].toString().trim() : '';
      const notifiedDate = row[HISTORY_NOTIFIED_COL - 1] ? row[HISTORY_NOTIFIED_COL - 1].toString().trim() : '';

      if ((status === '作成済' || status === '締結完了') && notifiedDate === '') {
        const inputs = {
          propertyFullName:         row[1] ? row[1].toString() : '',
          koBuyer:                  row[2] ? row[2].toString() : '',
          heiName:                  row[4] ? row[4].toString() : '',
          priceFormatted:           row[5] ? row[5].toString() : '',
          paymentDeadlineFormatted: row[6] ? row[6].toString() : '',
          mentions: mentions
        };
        const result = {
          docUrl: row[7] ? row[7].toString() : '',
          pdfUrl: row[8] ? row[8].toString() : ''
        };
        this.send(inputs, result);
        const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
        historySheet.getRange(actualRow, HISTORY_STATUS_COL).setValue('締結完了');
        historySheet.getRange(actualRow, HISTORY_NOTIFIED_COL).setValue(now);
        notifyCount++;
        if (notifyCount > 1) Utilities.sleep(500);
      }
    }
    Logger.log('[SlackNotify] 合計 ' + notifyCount + '件通知しました');
    return notifyCount;
  },

  checkAndNotify: function() {
    const searchQuery = [
      'is:unread',
      'from:(noreply@contract.moneyforward.com OR noreply@mfcloud.com)',
      'subject:(締結完了 OR "契約が完了" OR "電子署名が完了")'
    ].join(' ');
    let threads;
    try {
      threads = GmailApp.search(searchQuery, 0, 10);
    } catch (e) {
      Logger.log('[SlackNotify] Gmail検索エラー: ' + e.message);
      return;
    }
    if (threads.length === 0) return;
    threads.forEach(function(thread) {
      try {
        const msg = thread.getMessages()[thread.getMessages().length - 1];
        Logger.log('[SlackNotify] 検知: "' + msg.getSubject() + '"');
        SlackNotify.checkAndNotifyAll();
        thread.markRead();
      } catch (e) {
        Logger.log('[SlackNotify] エラー: ' + e.message);
      }
    });
  }
};

function checkContractCompletion() {
  const count = SlackNotify.checkAndNotifyAll();
  const ui = SpreadsheetApp.getUi();
  if (count > 0) {
    ui.alert('✅ Slack通知完了', count + '件の通知を送信しました。', ui.ButtonSet.OK);
  } else {
    ui.alert('⚠️ 通知対象なし', '通知対象のレコードが見つかりませんでした。\n\n確認ポイント：\n① 履歴シートにデータが存在するか\n② K列のステータスが「作成済」または「締結完了」\n③ L列（締結完了日時）が空欄', ui.ButtonSet.OK);
  }
}

function notifyContractComplete(rowIndex) {
  try {
    Logger.log('[notifyContractComplete] 呼び出し rowIndex=' + rowIndex);
    return SlackNotify.notifyRow(Number(rowIndex), false);
  } catch (e) {
    Logger.log('[notifyContractComplete] エラー: ' + e.stack);
    return { success: false, message: e.message };
  }
}

function testSlackNotify() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName(CONFIG.SHEET_HISTORY);
  const data = historySheet ? historySheet.getDataRange().getValues() : [];
  let inputs, result;
  if (data.length >= 2) {
    const row = data[data.length - 1];
    inputs = {
      propertyFullName:         row[1] || 'テスト物件',
      koBuyer:                  row[2] || 'テスト甲',
      heiName:                  row[4] || 'テスト丙',
      priceFormatted:           row[5] || '金200,000円',
      paymentDeadlineFormatted: row[6] || '2026年4月30日',
      mentions: ''
    };
    result = { docUrl: row[7] || 'https://docs.google.com/TEST', pdfUrl: row[8] || 'https://drive.google.com/TEST' };
  } else {
    inputs = {
      propertyFullName: 'メルディアキューブ難波南303（テスト）',
      koBuyer: '田中様', heiName: '株式会社テスト',
      priceFormatted: '金200,000円（内消費税額：18,181円）',
      paymentDeadlineFormatted: '2026年4月30日', mentions: ''
    };
    result = { docUrl: 'https://docs.google.com/document/d/DUMMY/edit', pdfUrl: 'https://drive.google.com/file/d/DUMMY/view' };
  }
  SlackNotify.send(inputs, result);
  SpreadsheetApp.getUi().alert('Slackテスト通知を送信しました。\nSlackを確認してください。');
}
