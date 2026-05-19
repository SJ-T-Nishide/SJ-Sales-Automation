/**
 * MinpakuWebApp.gs
 * 民泊経営パッケージ契約書 WebApp補助関数
 * Success Japan株式会社
 *
 * このファイルに doGet / doPost は定義しない
 * Installer.gs の既存関数を再利用する
 */

function createMinpakuContractFromWeb(formData) {
  try {
    var histSheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(IN_SHEETS.MINPAKU_HISTORY);
    if (!histSheet) {
      return { success: false, message: '民泊契約 履歴シートが見つかりません。setup()を実行してください。' };
    }

    var inputs = buildMinpakuInputsFromWeb_(formData);
    var errors = validateMinpakuWebInput_(inputs);
    if (errors.length > 0) {
      return { success: false, message: errors.join('\n') };
    }

    var gaiyoshoId = IN_DriveManager.findTemplateId(
      IN_CONFIG_KEYS.GAIYOSHO_TEMPLATE, '概要書面_テンプレート'
    );
    var gaiyosho = IN_DriveManager.generateFromTemplate(
      gaiyoshoId,
      inputs.fileBaseName + '_概要書面',
      inputs.folderId,
      MinpakuModule._gaiyoshoData(inputs)
    );

    var keiyakuId = IN_DriveManager.findTemplateId(
      IN_CONFIG_KEYS.KEIYAKU_TEMPLATE, 'ご契約書類一式_テンプレート'
    );
    var keiyakuElec = IN_DriveManager.generateFromTemplate(
      keiyakuId,
      inputs.fileBaseName + '_契約書類一式_電子契約用',
      inputs.folderId,
      MinpakuModule._keiyakuData(inputs),
      true
    );
    var keiyakuAnnot = IN_DriveManager.generateFromTemplate(
      keiyakuId,
      inputs.fileBaseName + '_契約書類一式_注釈付き',
      inputs.folderId,
      MinpakuModule._keiyakuData(inputs)
    );

    IN_GmailManager.createDraft(
      inputs.koEmail,
      'ご確認依頼：民泊経営パッケージ契約書の電子締結について（' +
        (inputs.propertyName || inputs.propertyAddress) + '）',
      MinpakuModule._emailBody(inputs)
    );

    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    histSheet.appendRow([
      now,
      inputs.propertyFull,
      inputs.koName,
      inputs.koEmail,
      inputs.totalAmountFormatted,
      inputs.contractDate,
      gaiyosho.docUrl,
      gaiyosho.pdfUrl,
      keiyakuElec.docUrl,
      keiyakuElec.pdfUrl,
      keiyakuAnnot.docUrl,
      keiyakuAnnot.pdfUrl,
      '作成済',
      ''
    ]);

    var historyRow = getLastMinpakuHistoryRow_();
    Logger.log('[MinpakuWebApp] 作成完了 historyRow=' + historyRow);

    return {
      success:        true,
      message:        '作成完了！',
      fileName:       inputs.fileBaseName,
      gaiyoshoDocUrl: gaiyosho.docUrl,
      gaiyoshoPdfUrl: gaiyosho.pdfUrl,
      elecDocUrl:     keiyakuElec.docUrl,
      elecPdfUrl:     keiyakuElec.pdfUrl,
      annotDocUrl:    keiyakuAnnot.docUrl,
      annotPdfUrl:    keiyakuAnnot.pdfUrl,
      historyRow:     historyRow
    };

  } catch (e) {
    Logger.log('[MinpakuWebApp] createMinpakuContractFromWeb error: ' + e.stack);
    return { success: false, message: e.message };
  }
}

function buildMinpakuInputsFromWeb_(formData) {

  var fmt = function(v) { return Number(v).toLocaleString('ja-JP'); };

  var parseLocalDate = function(s) {
    if (!s) return null;
    var p = s.toString().split('-');
    if (p.length !== 3) return null;
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  };

  var jpDate = function(s) {
    var d = parseLocalDate(s);
    if (!d) return '';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };

  var round10k = function(n) { return Math.round(n / 10000) * 10000; };

  var propertyAddress = (formData.propertyAddress || '').toString().trim();
  var propertyName    = (formData.propertyName    || '').toString().trim();
  var roomNumber      = (formData.roomNumber      || '').toString().trim();
  var propertyFull    = propertyAddress + (propertyName ? ' ' + propertyName : '') + roomNumber;

  var totalAmount = Number(formData.totalAmount) || 0;
  var sellAmount  = round10k(totalAmount * 0.65);
  var commAmount  = totalAmount - sellAmount;

  var depositTotal    = Number(formData.depositTotal) || 0;
  var depositSell     = (depositTotal > 0 && totalAmount > 0)
    ? round10k(depositTotal * (sellAmount / totalAmount)) : 0;
  var depositComm     = depositTotal - depositSell;
  var depositDeadline = jpDate(formData.depositDeadline);

  var midterm1Total    = Number(formData.midterm1Total) || 0;
  var midterm1Sell     = (midterm1Total > 0 && totalAmount > 0)
    ? round10k(midterm1Total * (sellAmount / totalAmount)) : 0;
  var midterm1Comm     = midterm1Total - midterm1Sell;
  var midterm1Deadline = jpDate(formData.midterm1Deadline);

  var midterm2Total    = Number(formData.midterm2Total) || 0;
  var midterm2Sell     = (midterm2Total > 0 && totalAmount > 0)
    ? round10k(midterm2Total * (sellAmount / totalAmount)) : 0;
  var midterm2Comm     = midterm2Total - midterm2Sell;
  var midterm2Deadline = jpDate(formData.midterm2Deadline);

  var balanceTotal    = totalAmount  - depositTotal  - midterm1Total  - midterm2Total;
  var balanceSell     = sellAmount   - depositSell   - midterm1Sell   - midterm2Sell;
  var balanceComm     = commAmount   - depositComm   - midterm1Comm   - midterm2Comm;
  var balanceDeadline = jpDate(formData.balanceDeadline);

  var deliveryDate    = jpDate(formData.deliveryDate);
  var contractDateRaw = (formData.contractDate || '').toString();
  var contractDate    = jpDate(contractDateRaw);

  var gaiyoshoDate = '';
  var cdObj        = parseLocalDate(contractDateRaw);
  if (cdObj) {
    cdObj.setDate(cdObj.getDate() - 1);
    gaiyoshoDate = cdObj.getFullYear() + '年' + (cdObj.getMonth() + 1) + '月' + cdObj.getDate() + '日';
  }

  var cleaningFee              = Number(formData.cleaningFee) || 0;
  var usageFee                 = Number(formData.usageFee)    || 0;
  var licenseStatus            = (formData.licenseStatus            || '取得済').toString().trim();
  var siteAccount              = (formData.siteAccount              || '既存のものを使用').toString().trim();
  var honkenMokutekibutsuNoUmu = (formData.honkenMokutekibutsuNoUmu || '設置済').toString().trim();
  var specialClauseInterior    = (formData.specialClauseInterior    || '').toString().trim();
  var specialClauseManagement  = (formData.specialClauseManagement  || '').toString().trim();

  var minpakuFormSheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(IN_SHEETS.MINPAKU_FORM);
  var folderSetting   = minpakuFormSheet ? minpakuFormSheet.getRange('B53').getValue().toString().trim() : '';
  var folderUrlDirect = minpakuFormSheet ? minpakuFormSheet.getRange('B54').getValue().toString().trim() : '';
  var folderResult    = IN_DriveManager.resolveFolderId(folderSetting, folderUrlDirect);
  var folderId        = folderResult.folderId;
  var folderName      = folderResult.folderName;

  var koEmail = (formData.koEmail || '').toString().trim();
  var koName  = (formData.koName  || '').toString().trim();

  var contractDateFmt = contractDateRaw.replace(/-/g, '') || 'undated';
  var fileBaseName    = '民泊契約_' + (propertyName || propertyAddress) + '_' + contractDateFmt;

  return {
    propertyAddress:            propertyAddress,
    propertyName:               propertyName,
    roomNumber:                 roomNumber,
    propertyFull:               propertyFull,
    totalAmount:                totalAmount,
    sellAmount:                 sellAmount,
    commAmount:                 commAmount,
    totalAmountFormatted:       '金' + fmt(totalAmount) + '円（税込）',
    depositTotal:               depositTotal,
    depositSell:                depositSell,
    depositComm:                depositComm,
    depositDeadline:            depositDeadline,
    midterm1Total:              midterm1Total,
    midterm1Sell:               midterm1Sell,
    midterm1Comm:               midterm1Comm,
    midterm1Deadline:           midterm1Deadline,
    midterm2Total:              midterm2Total,
    midterm2Sell:               midterm2Sell,
    midterm2Comm:               midterm2Comm,
    midterm2Deadline:           midterm2Deadline,
    balanceTotal:               balanceTotal,
    balanceSell:                balanceSell,
    balanceComm:                balanceComm,
    balanceDeadline:            balanceDeadline,
    deliveryDate:               deliveryDate,
    contractDate:               contractDate,
    gaiyoshoDate:               gaiyoshoDate,
    cleaningFee:                cleaningFee,
    usageFee:                   usageFee,
    licenseStatus:              licenseStatus,
    siteAccount:                siteAccount,
    honkenMokutekibutsuNoUmu:   honkenMokutekibutsuNoUmu,
    specialClauseInterior:      specialClauseInterior,
    specialClauseManagement:    specialClauseManagement,
    folderId:                   folderId,
    folderName:                 folderName,
    koEmail:                    koEmail,
    koName:                     koName,
    heiAddress:                 '',
    fileBaseName:               fileBaseName
  };
}

function validateMinpakuWebInput_(inputs) {
  return MinpakuModule._validate(inputs);
}

function getLastMinpakuHistoryRow_() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(IN_SHEETS.MINPAKU_HISTORY);
  if (!sheet) return -1;
  return sheet.getLastRow();
}

function notifyMinpakuContractCompleteFromWeb(historyRow) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(IN_SHEETS.MINPAKU_HISTORY);
    if (!sheet) {
      return { success: false, message: '民泊契約 履歴シートが見つかりません。' };
    }
    if (historyRow < 2 || historyRow > sheet.getLastRow()) {
      return { success: false, message: '無効な行番号です: ' + historyRow };
    }

    var row    = sheet.getRange(historyRow, 1, 1, 14).getValues()[0];
    var status = row[12] ? row[12].toString().trim() : '';
    if (status === '締結完了') {
      return { success: false, message: 'この行は既に締結完了済みです。' };
    }

    var mentions = IN_SlackManager.getMentions();
    var msg = (mentions ? mentions + '\n\n' : '')
      + '*民泊経営パッケージ契約の締結が完了しました*\n\n'
      + '物件：' + row[1] + '\n'
      + '甲：' + row[2] + '\n'
      + '金額：' + row[4] + '\n'
      + '契約日：' + row[5] + '\n\n'
      + '概要書面\n'
      + ' Doc：' + row[6] + '\n'
      + ' PDF：' + row[7] + '\n\n'
      + '契約書類一式（電子契約用）\n'
      + ' Doc：' + row[8] + '\n'
      + ' PDF：' + row[9] + '\n\n'
      + '契約書類一式（注釈付き）\n'
      + ' Doc：' + row[10] + '\n'
      + ' PDF：' + row[11] + '\n\n'
      + '内容をご確認ください。';

    IN_SlackManager.send(msg);

    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    sheet.getRange(historyRow, 13).setValue('締結完了');
    sheet.getRange(historyRow, 14).setValue(now);

    Logger.log('[MinpakuWebApp] 締結完了通知送信 row=' + historyRow);
    return { success: true };

  } catch (e) {
    Logger.log('[MinpakuWebApp] notifyMinpakuContractCompleteFromWeb error: ' + e.stack);
    return { success: false, message: e.message };
  }
}
