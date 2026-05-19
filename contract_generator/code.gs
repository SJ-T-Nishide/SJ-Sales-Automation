/**
 * code.gs
 * 買取契約書自動化ツール - メイン処理
 * Success Japan株式会社
 */

const CONFIG = {
  SHEET_FORM:      '入力フォーム',
  SHEET_CONFIG:    '設定',
  SHEET_HISTORY:   '履歴',
  SHEET_CANDIDATES:'候補リスト',
  CONFIG_TEMPLATE_DOC_ID: 'B2',
  CONFIG_SLACK_WEBHOOK:   'B11',
};

const FIXED = {
  OTSU_ADDRESS: '大阪府大阪市浪速区元町2-8-20',
  OTSU_NAME:    'Success Japan株式会社　代表取締役 西出 高宏',
};

function onOpen(e) { onOpen_unified(e); }

function createContract() {
  const ui = SpreadsheetApp.getUi();
  try {
    const inputs = getInputValues();
    const errors = validateInputs(inputs);
    if (errors.length > 0) {
      ui.alert('⚠️ 入力エラー', errors.join('\n'), ui.ButtonSet.OK);
      return;
    }
    const confirmMsg =
      `以下の内容で契約書を作成します。\n\n` +
      `📍 物件：${inputs.propertyFullName}\n` +
      `💰 買取金額：${inputs.priceFormatted}\n` +
      `📅 決済期限：${inputs.paymentDeadlineFormatted}\n` +
      `👤 甲（相手方）：${inputs.koBuyer}（${inputs.koEmail}）\n` +
      `🏢 丙：${inputs.heiName}\n` +
      `📁 保存先：${inputs.folderName}\n\nよろしいですか？`;
    const confirm = ui.alert('確認', confirmMsg, ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) return;
    const result = DocumentGen.generate(inputs);
    GmailDraft.create(inputs, result);
    saveToHistory(inputs, result);
    const doneMsg =
      `✅ 作成が完了しました！\n\n` +
      `📄 ファイル名：${result.fileName}\n` +
      `📁 保存先：${result.folderName}\n\n` +
      `📧 Gmailに下書きを作成しました\n` +
      `　 宛先：${inputs.koEmail}\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `⚠️ 次のステップ（手動）:\n` +
      `① Gmailの下書きを確認して送信\n` +
      `② マネーフォワードクラウド契約を開いて\n` +
      `　 PDFをアップロード・送信`;
    ui.alert('作成完了', doneMsg, ui.ButtonSet.OK);
  } catch (e) {
    Logger.log(`[ERROR] createContract: ${e.stack}`);
    ui.alert('❌ エラー', `エラーが発生しました:\n${e.message}\n\n管理者に連絡してください。`, ui.ButtonSet.OK);
  }
}

function getInputValues() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_FORM);
  if (!sheet) throw new Error(`シート「${CONFIG.SHEET_FORM}」が見つかりません`);
  const get = (cell) => sheet.getRange(cell).getValue();

  const propertyAddress = get('B4').toString().trim();
  const propertyName    = get('B5').toString().trim();
  const roomNumber      = get('B6').toString().trim();
  const propertyFullName = `${propertyAddress} ${propertyName}${roomNumber}`;

  const article1DateRaw       = get('B10');
  const contract1Name         = get('B11').toString().trim();
  const contract2Name         = get('B12').toString().trim();
  const priceIncTax           = Number(get('B13'));
  const paymentDeadlineRaw    = get('B15');

  const taxNum        = Math.round(priceIncTax / 1.1 * 0.1);
  const priceFormatted = `金${priceIncTax.toLocaleString('ja-JP')}円（内消費税額：${taxNum.toLocaleString('ja-JP')}円）`;

  const article1DateFormatted    = formatJapaneseDate(article1DateRaw);
  const paymentDeadlineFormatted = formatJapaneseDate(paymentDeadlineRaw);

  const confidentialDate = get('B18').toString().trim();
  const specialClause    = get('B19').toString().trim();

  const koEmail   = get('B22').toString().trim();
  const koBuyer   = get('B23').toString().trim();
  const heiAddress= get('B24').toString().trim();
  const heiName   = get('B25').toString().trim();

  const contractDateRaw = get('B26');
  const contractDateObj = contractDateRaw instanceof Date ? contractDateRaw : new Date(contractDateRaw);
  const contractYear    = isNaN(contractDateObj.getTime()) ? '' : contractDateObj.getFullYear() + '年';
  const contractMonth   = isNaN(contractDateObj.getTime()) ? '' : (contractDateObj.getMonth() + 1) + '月';
  const contractDay     = isNaN(contractDateObj.getTime()) ? '' : contractDateObj.getDate() + '';
  const contractDateStr = isNaN(contractDateObj.getTime()) ? '' :
    Utilities.formatDate(contractDateObj, 'Asia/Tokyo', 'yyyyMMdd');

  const folderSetting  = get('B29').toString().trim();
  const folderUrlDirect= get('B30').toString().trim();
  const { folderId, folderName } = resolveFolderId(folderSetting, folderUrlDirect);

  const slackChannel = get('B33').toString().trim();
  const mentions = [get('B34'), get('B35'), get('B36')]
    .map(v => v.toString().trim())
    .filter(v => v !== '')
    .join(' ');

  const fileName = `買取契約_${propertyName}${roomNumber}_${koBuyer}_${contractDateStr || '未定'}`;

  return {
    propertyAddress, propertyName, roomNumber, propertyFullName,
    article1DateFormatted,
    contract1Name, contract2Name,
    priceIncTax, taxNum, priceFormatted,
    paymentDeadlineFormatted,
    confidentialDate, specialClause,
    koEmail, koBuyer,
    heiAddress, heiName,
    contractYear, contractMonth, contractDay,
    fileName, folderId, folderName,
    slackChannel, mentions
  };
}

function resolveFolderId(folderSetting, folderUrlDirect) {
  if (folderUrlDirect && folderUrlDirect.includes('drive.google.com')) {
    const match = folderUrlDirect.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match) {
      try {
        const folder = DriveApp.getFolderById(match[1]);
        return { folderId: match[1], folderName: folder.getName() };
      } catch (e) {
        throw new Error(`指定のGoogle Driveフォルダにアクセスできませんでした。URLを確認してください。\n${folderUrlDirect}`);
      }
    }
  }
  const configSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_CONFIG);
  if (!configSheet) throw new Error(`シート「${CONFIG.SHEET_CONFIG}」が見つかりません`);
  const rows = configSheet.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === folderSetting) {
      const folderId = rows[i + 1] && rows[i + 1][1] ? rows[i + 1][1].toString().trim() : '';
      if (folderId) {
        try {
          const folder = DriveApp.getFolderById(folderId);
          return { folderId: folderId, folderName: folder.getName() };
        } catch (e) {
          throw new Error(`設定シートのフォルダID「${folderId}」にアクセスできません。`);
        }
      }
    }
  }
  throw new Error(`保存先フォルダが設定されていません。\n「設定」シートまたはフォルダURL欄を確認してください。`);
}

function validateInputs(inputs) {
  const errors = [];
  if (!inputs.propertyAddress)           errors.push('・物件住所を入力してください（B4）');
  if (!inputs.propertyName)              errors.push('・物件名を入力してください（B5）');
  if (!inputs.article1DateFormatted)     errors.push('・第1条の日付を入力してください（B10）');
  if (!inputs.contract1Name)             errors.push('・契約書①の名称を入力してください（B11）');
  if (!inputs.priceIncTax || inputs.priceIncTax <= 0) errors.push('・買取金額（税込）を入力してください（B13）');
  if (!inputs.paymentDeadlineFormatted)  errors.push('・決済期限を入力してください（B15）');
  if (!inputs.confidentialDate)          errors.push('・秘密保持開始日時を入力してください（B18）');
  if (!inputs.koEmail)                   errors.push('・甲のメールアドレスを入力してください（B22）');
  if (!inputs.koBuyer)                   errors.push('・甲の氏名を入力してください（B23）');
  if (!inputs.heiAddress)                errors.push('・丙の住所を入力してください（B24）');
  if (!inputs.heiName)                   errors.push('・丙の名称を入力してください（B25）');
  if (!inputs.contractYear)              errors.push('・契約日を入力してください（B26）');
  if (!inputs.folderId)                  errors.push('・保存先フォルダを設定してください（B29またはB30）');
  return errors;
}

function formatJapaneseDate(dateValue) {
  if (!dateValue) return '';
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (isNaN(d.getTime())) return dateValue.toString();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function saveToHistory(inputs, result) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_HISTORY);
  if (!sheet) return;
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.appendRow([
    now,
    inputs.propertyFullName,
    inputs.koBuyer,
    inputs.koEmail,
    inputs.heiName,
    inputs.priceFormatted,
    inputs.paymentDeadlineFormatted,
    result.docUrl,
    result.pdfUrl,
    result.fileName,
    '作成済',
    ''
  ]);
}

function openSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_CONFIG);
  if (sheet) ss.setActiveSheet(sheet);
}

function runTest() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_FORM);
  if (!sheet) {
    ui.alert('テストエラー', '入力フォームシートが見つかりません', ui.ButtonSet.OK);
    return;
  }
  sheet.getRange('B4').setValue('大阪府大阪市浪速区日本橋5-5-4');
  sheet.getRange('B5').setValue('メルディアキューブ難波南');
  sheet.getRange('B6').setValue('303');
  sheet.getRange('B10').setValue(new Date('2026-05-01'));
  sheet.getRange('B11').setValue('スペースレンタル事業及び宿泊事業管理委託契約');
  sheet.getRange('B12').setValue('事業用賃貸借契約');
  sheet.getRange('B13').setValue(200000);
  sheet.getRange('B15').setValue(new Date('2026-04-30'));
  sheet.getRange('B18').setValue('2025年10月31日14時00分');
  sheet.getRange('B19').setValue('');
  sheet.getRange('B22').setValue('test@example.com');
  sheet.getRange('B23').setValue('田中様');
  sheet.getRange('B24').setValue('大阪府大阪市〇〇区〇〇1-2-3');
  sheet.getRange('B25').setValue('株式会社テスト');
  sheet.getRange('B26').setValue(new Date('2026-04-30'));
  ui.alert('テストデータ設定完了', 'テストデータを入力フォームに設定しました。\n「契約書を作成する」を実行してください。', ui.ButtonSet.OK);
}

function testLogin() {
  const result = checkLogin('Nishide', 'Nishide2123');
  Logger.log('ログイン結果: ' + result);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName('設定');
  const a17 = configSheet.getRange('A17').getValue();
  const b17 = configSheet.getRange('B17').getValue();
  Logger.log('設定シートA17: ' + a17);
  Logger.log('設定シートB17: ' + b17);
}
