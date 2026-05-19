// ============================================================
// airdna_settings.gs — AirDNA_Settings シート管理
// ============================================================

const SETTINGS_DEFAULTS = {
  daily_export_limit:       10,
  default_update_cycle_days: 30,
  initial_backfill_limit:   80,
  csv_import_folder_id:     '',
  processed_folder_id:      '',
  error_folder_id:          '',
  property_db_spreadsheet_id: '1jeMlOY8oG4kqWPTpXBCpKz6LXm1xLC7P4cMHmnvEKME',
  property_db_sheet_name:   ''
};

// AirDNA_Settings シートを読みオブジェクトで返す
function getSettings() {
  const sheet = getSheet_(SHEET.SETTINGS);

  if (sheet.getLastRow() < 2) {
    initSettingsSheet_();
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const settings = Object.assign({}, SETTINGS_DEFAULTS);

  rows.forEach(([key, value]) => {
    if (key) settings[String(key).trim()] = value;
  });

  // 数値型に変換
  settings.daily_export_limit       = parseInt(settings.daily_export_limit, 10) || 10;
  settings.default_update_cycle_days = parseInt(settings.default_update_cycle_days, 10) || 30;
  settings.initial_backfill_limit   = parseInt(settings.initial_backfill_limit, 10) || 80;

  return settings;
}

function initSettingsSheet_() {
  const sheet = getSheet_(SHEET.SETTINGS);
  setSheetHeader_(sheet, ['key', 'value', 'description']);

  const rows = [
    ['daily_export_limit',           10,    '1日のキュー追加上限'],
    ['default_update_cycle_days',    30,    'デフォルト更新サイクル（日）'],
    ['initial_backfill_limit',       80,    '初回一括取得上限'],
    ['csv_import_folder_id',         '',    '取込待ちCSVフォルダのID（要設定）'],
    ['processed_folder_id',          '',    '処理済みフォルダのID（要設定）'],
    ['error_folder_id',              '',    'エラーフォルダのID（要設定）'],
    ['property_db_spreadsheet_id',   '1jeMlOY8oG4kqWPTpXBCpKz6LXm1xLC7P4cMHmnvEKME', '物件収集DBのスプレッドシートID'],
    ['property_db_sheet_name',       '',    '物件収集DBのシート名（要設定）']
  ];

  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
}
