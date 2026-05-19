// ============================================================
// airdna_utils.gs — 定数・共通ユーティリティ
// ============================================================

const AIRDNA_SS_ID = '1rW9bCWgHFeL4TuSIGVVrjq3iCstZuyJAY0_-d7KCxjg';

const SHEET = {
  MASTER:    'AirDNA_Submarket_Master',
  QUEUE:     'AirDNA_Export_Queue',
  DB:        'AirDNA_DB',
  LOG:       'AirDNA_Import_Log',
  SETTINGS:  'AirDNA_Settings',
  UNMATCHED: 'Unmatched_Area_Log'
};

// 各シートの列インデックス（0始まり）
const MASTER_COL = {
  ID: 0, PREFECTURE: 1, CITY: 2, WARD_JP: 3, AREA_GROUP: 4,
  MARKET: 5, SUBMARKET: 6, SEARCH_TEXT: 7, PRIORITY: 8,
  IS_ACTIVE: 9, CYCLE_DAYS: 10, LAST_EXPORTED: 11,
  LAST_IMPORTED: 12, NEXT_DUE: 13, STATUS: 14, NOTE: 15,
  FILTER_NAME: 16   // AirDNA "My Filters" に保存した名前（例: 大阪府, 鹿児島県）
};

const QUEUE_COL = {
  QUEUE_ID: 0, RUN_DATE: 1, PRIORITY: 2, PREFECTURE: 3, CITY: 4,
  WARD_JP: 5, MARKET: 6, SUBMARKET: 7, IS_ONDEMAND: 8,
  SOURCE_MASTER_ID: 9, STATUS: 10, DOWNLOADED_AT: 11,
  IMPORTED_AT: 12, CSV_FILENAME: 13, ERROR_MSG: 14
};

const DB_COL = {
  DB_ID: 0, MASTER_ID: 1, QUEUE_ID: 2, IMPORTED_AT: 3,
  SNAPSHOT_DATE: 4, DEDUPE_KEY: 5, IS_LATEST: 6,
  // CSV列は7番目以降
  AIRBNB_PROPERTY_ID: 48, VRBO_PROPERTY_ID: 49
};

const MASTER_HEADERS = [
  'id', 'prefecture', 'city', 'ward_jp', 'area_group',
  'airdna_market', 'airdna_submarket', 'search_text',
  'priority', 'is_active', 'update_cycle_days',
  'last_exported_at', 'last_imported_at', 'next_due_at', 'status', 'note',
  'filter_name'   // AirDNA My Filters 保存名（Custom Region方式）
];

const QUEUE_HEADERS = [
  'queue_id', 'run_date', 'priority', 'prefecture', 'city', 'ward_jp',
  'airdna_market', 'airdna_submarket', 'is_ondemand', 'source_submarket_id',
  'status', 'downloaded_at', 'imported_at', 'csv_filename', 'error_message'
];

const DB_HEADERS = [
  'db_id', 'submarket_master_id', 'queue_id', 'imported_at', 'snapshot_date', 'dedupe_key', 'is_latest',
  'title', 'property_manager_host', 'contact',
  'revenue', 'revenue_potential', 'adr', 'occupancy', 'days_available',
  'bedrooms', 'bathrooms', 'accommodates',
  'has_air_conditioning', 'has_gym', 'has_hot_tub', 'has_kitchen', 'has_parking', 'has_pets', 'has_pool',
  'listing_type', 'property_type', 'real_estate_type',
  'overall_rating', 'number_of_reviews', 'minimum_stay', 'host_unit_count', 'price_tier',
  'airbnb_superhost', 'cleaning_fee', 'instant_book', 'reserved_days', 'number_of_bookings',
  'last_update', 'airdna_market_csv', 'airdna_submarket_csv',
  'city_csv', 'state_csv', 'zipcode', 'country', 'location_type',
  'listing_url', 'main_listing_image', 'airbnb_property_id', 'vrbo_property_id',
  'latitude', 'longitude'
];

const LOG_HEADERS = [
  'log_id', 'imported_at', 'queue_id', 'airdna_market', 'airdna_submarket',
  'file_name', 'rows_imported', 'rows_skipped', 'status', 'error_message'
];

const UNMATCHED_HEADERS = [
  'logged_at', 'source', 'prefecture', 'city', 'ward_jp', 'raw_address', 'reason', 'status', 'note'
];

// CSVヘッダー名 → DB内部列名（AirDNA Export CSV の全45列）
const CSV_COL_MAP = {
  'Title': 'title',
  'Property Manager/Host': 'property_manager_host',
  'Contact': 'contact',
  'Revenue': 'revenue',
  'Revenue Potential': 'revenue_potential',
  'ADR': 'adr',
  'Occupancy': 'occupancy',
  'Days Available': 'days_available',
  'Bedrooms': 'bedrooms',
  'Bathrooms': 'bathrooms',
  'Accommodates': 'accommodates',
  'Has Air Conditioning': 'has_air_conditioning',
  'Has Gym': 'has_gym',
  'Has Hot Tub': 'has_hot_tub',
  'Has Kitchen': 'has_kitchen',
  'Has Parking': 'has_parking',
  'Has Pets': 'has_pets',
  'Has Pool': 'has_pool',
  'Listing Type': 'listing_type',
  'Property Type': 'property_type',
  'Real Estate Type': 'real_estate_type',
  'Overall Rating': 'overall_rating',
  'Number of Reviews': 'number_of_reviews',
  'Minimum Stay': 'minimum_stay',
  'Host Unit Count': 'host_unit_count',
  'Price Tier': 'price_tier',
  'Airbnb Superhost': 'airbnb_superhost',
  'Cleaning Fee': 'cleaning_fee',
  'Instant Book': 'instant_book',
  'Reserved Days': 'reserved_days',
  'Number of Bookings': 'number_of_bookings',
  'Last Update': 'last_update',
  'AirDNA Market': 'airdna_market_csv',
  'AirDNA Subarket': 'airdna_submarket_csv', // CSVのtypoそのまま対応
  'City': 'city_csv',
  'State': 'state_csv',
  'Zipcode': 'zipcode',
  'Country': 'country',
  'Location Type': 'location_type',
  'Listing URL': 'listing_url',
  'Main Listing Image': 'main_listing_image',
  'Airbnb Property ID': 'airbnb_property_id',
  'Vrbo Property ID': 'vrbo_property_id',
  'Latitude': 'latitude',
  'Longitude': 'longitude'
};

// ── ヘルパー関数 ──────────────────────────────────────────

function getAirdnaSS_() {
  return SpreadsheetApp.openById(AIRDNA_SS_ID);
}

function getSheet_(name) {
  const ss = getAirdnaSS_();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function nowStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

function todayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function dateToStr_(date) {
  if (date === '' || date === null || date === undefined) return '';
  try {
    return Utilities.formatDate(new Date(date), 'Asia/Tokyo', 'yyyy-MM-dd');
  } catch (e) {
    return String(date);
  }
}

function addDays_(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setDate(d.getDate() + days);
  return dateToStr_(d);
}

// ファイル名からqueue_id/filter_name/snapshot_dateを抽出
function parseFilename_(filename) {
  // 新形式: Q000003__大阪府__20260518.csv  (Custom Region方式)
  let m = filename.match(/^Q(\d+)__(.+?)__(\d{8})\.csv$/i);
  if (m) {
    const d = m[3];
    return {
      queue_id:      parseInt(m[1], 10),
      filter_name:   m[2],
      market:        m[2],   // 後方互換
      submarket:     m[2],   // 後方互換
      snapshot_date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`
    };
  }
  // 旧形式: Q000123__Osaka__Miyakojima-ku__20260517.csv  (Market/Submarket方式)
  m = filename.match(/^Q(\d+)__(.+?)__(.+?)__(\d{8})\.csv$/i);
  if (m) {
    const d = m[4];
    return {
      queue_id:      parseInt(m[1], 10),
      filter_name:   `${m[2]}__${m[3]}`,
      market:        m[2],
      submarket:     m[3],
      snapshot_date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`
    };
  }
  // Fallback: FilterName__20260517.csv
  m = filename.match(/^(.+?)__(\d{8})\.csv$/i);
  if (m) {
    const d = m[2];
    return {
      queue_id:      null,
      filter_name:   m[1],
      market:        m[1],
      submarket:     m[1],
      snapshot_date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`
    };
  }
  return null;
}

function readAllRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
}

function setSheetHeader_(sheet, headers) {
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function getNextId_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  const lastId = sheet.getRange(lastRow, 1).getValue();
  return (parseInt(lastId, 10) || 0) + 1;
}
