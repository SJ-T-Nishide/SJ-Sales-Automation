/**
 * SpreadsheetSetup.gs
 * スプレッドシートの初期セットアップスクリプト
 */

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  _createFormSheet(ss);
  _createConfigSheet(ss);
  _createHistorySheet(ss);
  _createCandidatesSheet(ss);

  ss.setActiveSheet(ss.getSheetByName('入力フォーム'));

  ui.alert(
    '✅ セットアップ完了',
    '以下のシートを作成しました:\n' +
    '・入力フォーム\n・設定\n・履歴\n・候補リスト\n\n' +
    '「設定」シートにひな形ドキュメントIDと\n' +
    '保存先フォルダIDを入力してください。',
    ui.ButtonSet.OK
  );
}

function _createFormSheet(ss) {
  let sheet = ss.getSheetByName('入力フォーム');
  if (!sheet) {
    sheet = ss.insertSheet('入力フォーム');
  } else {
    return;
  }

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 420);

  const rows = [
    ['【買取契約書 作成フォーム】', ''],
    ['', ''],
    ['▼ ① 物件情報', ''],
    ['物件住所', ''],
    ['物件名', ''],
    ['部屋番号', ''],
    ['本件物件（自動生成）', '=IF(B4="","",B4&" "&B5&B6)'],
    ['', ''],
    ['▼ ② 契約条件', ''],
    ['第1条の日付', ''],
    ['契約書①の名称', ''],
    ['契約書②の名称（任意）', ''],
    ['買取金額（税込）', ''],
    ['消費税額（自動計算）', '=IF(B13="","",ROUND(B13/1.1*0.1))'],
    ['決済期限', ''],
    ['', ''],
    ['▼ ③ 秘密保持・特約', ''],
    ['秘密保持開始日時', ''],
    ['追加の特約事項（任意）', ''],
    ['', ''],
    ['▼ ④ 契約当事者', ''],
    ['甲のメールアドレス', ''],
    ['甲の氏名（メール宛名）', ''],
    ['丙の住所', ''],
    ['丙の名称', ''],
    ['契約日', ''],
    ['', ''],
    ['▼ ⑤ 保存設定', ''],
    ['保存先フォルダ（選択）', ''],
    ['保存先フォルダURL（直接入力）', ''],
    ['', ''],
    ['▼ ⑥ Slack通知設定', ''],
    ['通知先Slackチャンネル', ''],
    ['メンション担当者①', ''],
    ['メンション担当者②', ''],
    ['メンション担当者③', ''],
  ];

  rows.forEach((row, i) => {
    sheet.getRange(i + 1, 1).setValue(row[0]);
    if (row[1]) sheet.getRange(i + 1, 2).setFormula ? sheet.getRange(i + 1, 2).setFormula(row[1]) : sheet.getRange(i + 1, 2).setValue(row[1]);
  });

  sheet.getRange('B7').setFormula('=IF(B4="","",B4&" "&B5&B6)');
  sheet.getRange('B14').setFormula('=IF(B13="","",ROUND(B13/1.1*0.1))');

  sheet.getRange('B13').setNumberFormat('#,##0');
  sheet.getRange('B14').setNumberFormat('#,##0');
  sheet.getRange('B10').setNumberFormat('yyyy"年"m"月"d"日"');
  sheet.getRange('B15').setNumberFormat('yyyy"年"m"月"d"日"');
  sheet.getRange('B26').setNumberFormat('yyyy"年"m"月"d"日"');

  [1, 3, 9, 17, 21, 28, 32].forEach(row => {
    sheet.getRange(row, 1).setFontWeight('bold').setBackground('#E8F0FE');
  });

  [4, 5, 10, 11, 13, 15, 18, 22, 23, 24, 25, 26].forEach(row => {
    sheet.getRange(row, 2).setBackground('#FFFDE7');
  });

  const contract1Rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      'スペースレンタル事業及び宿泊事業管理委託契約',
      '事業用賃貸借契約',
      'その他（直接入力）'
    ], true)
    .build();
  sheet.getRange('B11').setDataValidation(contract1Rule);

  const contract2Rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      '事業用賃貸借契約',
      'スペースレンタル事業及び宿泊事業管理委託契約',
      'その他（直接入力）',
      '（なし）'
    ], true)
    .build();
  sheet.getRange('B12').setDataValidation(contract2Rule);

  Logger.log('入力フォームシートを作成しました');
}

function _createConfigSheet(ss) {
  let sheet = ss.getSheetByName('設定');
  if (!sheet) {
    sheet = ss.insertSheet('設定');
  } else {
    return;
  }

  sheet.setColumnWidth(1, 240);
  sheet.setColumnWidth(2, 400);

  const rows = [
    ['【システム設定】', ''],
    ['ひな形GoogleドキュメントID', '（ここにドキュメントIDを貼り付け）'],
    ['', ''],
    ['【よく使う保存先フォルダ】', ''],
    ['保存先①名称', '契約書2026'],
    ['保存先①フォルダID', '（ここにフォルダIDを貼り付け）'],
    ['保存先②名称', '重要案件'],
    ['保存先②フォルダID', '（ここにフォルダIDを貼り付け）'],
    ['', ''],
    ['【Slack設定】', ''],
    ['Slack Webhook URL', '（例：https://hooks.slack.com/services/T.../B.../...）'],
    ['', ''],
    ['【乙情報（固定）】', ''],
    ['乙の住所', '大阪府大阪市浪速区元町2-8-20'],
    ['乙の名称', 'Success Japan株式会社　代表取締役 西出 高宏'],
  ];

  rows.forEach((row, i) => {
    sheet.getRange(i + 1, 1).setValue(row[0]);
    sheet.getRange(i + 1, 2).setValue(row[1]);
  });

  [1, 4, 10, 13].forEach(row => {
    sheet.getRange(row, 1).setFontWeight('bold').setBackground('#E8F0FE');
  });

  Logger.log('設定シートを作成しました');
}

function _createHistorySheet(ss) {
  let sheet = ss.getSheetByName('履歴');
  if (!sheet) {
    sheet = ss.insertSheet('履歴');
  } else {
    return;
  }

  const headers = [
    '作成日時', '物件名', '甲（氏名）', '甲（メール）', '丙（名称）',
    '買取金額', '決済期限', 'GoogleドキュメントURL', 'PDF URL',
    'ファイル名', 'ステータス', '締結完了日時'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#37474F')
    .setFontColor('#FFFFFF');

  [1, 2, 3, 4, 5, 6].forEach(col => sheet.setColumnWidth(col, 150));
  sheet.setColumnWidth(8, 300);
  sheet.setColumnWidth(9, 300);
  sheet.setColumnWidth(10, 250);

  sheet.getRange(1, 1, 1, headers.length).createFilter();

  Logger.log('履歴シートを作成しました');
}

function _createCandidatesSheet(ss) {
  let sheet = ss.getSheetByName('候補リスト');
  if (!sheet) {
    sheet = ss.insertSheet('候補リスト');
  } else {
    return;
  }

  sheet.getRange('A1').setValue('【契約書①名称候補】').setFontWeight('bold').setBackground('#E8F0FE');
  sheet.getRange('A2').setValue('スペースレンタル事業及び宿泊事業管理委託契約');
  sheet.getRange('A3').setValue('事業用賃貸借契約');
  sheet.getRange('A4').setValue('事業管理委託契約及び物件使用契約書');
  sheet.getRange('A5').setValue('なし');
  sheet.getRange('A6').setValue('直接入力');

  sheet.getRange('C1').setValue('【Slackチャンネル】').setFontWeight('bold');
  sheet.getRange('D1').setValue('【チャンネルID】').setFontWeight('bold');
  sheet.getRange('C2').setValue('#contracts');
  sheet.getRange('D2').setValue('（チャンネルIDを入力）');

  sheet.getRange('F1').setValue('【担当者名】').setFontWeight('bold');
  sheet.getRange('G1').setValue('【Slackメンション】').setFontWeight('bold');
  sheet.getRange('F2').setValue('営業担当');
  sheet.getRange('G2').setValue('@yamada');
  sheet.getRange('F3').setValue('契約担当');
  sheet.getRange('G3').setValue('@sato');
  sheet.getRange('F4').setValue('経理担当');
  sheet.getRange('G4').setValue('@suzuki');

  Logger.log('候補リストシートを作成しました');
}
