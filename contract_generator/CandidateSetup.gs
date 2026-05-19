/**
 * CandidateSetup.gs
 * 候補リストシートの初期設定（ダイアログなし・即実行版）
 */
function initContract1Candidates() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('候補リスト');
  if (!sheet) sheet = ss.insertSheet('候補リスト');

  const candidates = [
    'スペースレンタル事業及び宿泊事業管理委託契約',
    '事業用賃貸借契約',
    '事業管理委託契約及び物件使用契約書',
    'なし',
    '直接入力'
  ];

  sheet.getRange('A1')
    .setValue('【契約書①名称候補】')
    .setFontWeight('bold')
    .setBackground('#E8F0FE');

  candidates.forEach(function(val, i) {
    sheet.getRange(i + 2, 1).setValue(val);
  });

  sheet.getRange('A7:A20').clearContent();

  Logger.log('候補リスト設定完了：' + candidates.length + '件');
}
