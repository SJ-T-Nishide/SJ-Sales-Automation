// ============================================================
// airdna_master.gs — Submarket_Master / Unmatched_Area_Log 管理
// ============================================================

// 5都市80区の初期マスタデータ
// airdna_submarket は AirDNA画面での実際の表記を要確認。
// 不明なものは search_text でヒントを示している。
const INITIAL_SUBMARKETS = [
  // ── 大阪市（Osaka: 24区）─────────────────────────────────
  { prefecture:'大阪府', city:'大阪市', ward_jp:'都島区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Miyakojima-ku',      search_text:'miyakojima',     priority:1, update_cycle_days:30, note:'沖縄宮古島と検索混同注意' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'中央区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Chuo-ku',             search_text:'chuo',           priority:1, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'浪速区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Naniwa-ku',           search_text:'naniwa',         priority:1, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'西区',      area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Nishi-ku',            search_text:'nishi',          priority:1, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'北区',      area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Kita-ku',             search_text:'kita',           priority:1, update_cycle_days:30, note:'大阪市北区' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'天王寺区',  area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Tennoji-ku',          search_text:'tennoji',        priority:1, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'港区',      area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Minato-ku',           search_text:'minato',         priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'淀川区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Yodogawa-ku',         search_text:'yodogawa',       priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'生野区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Ikuno-ku',            search_text:'ikuno',          priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'東成区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Higashinari-ku',      search_text:'higashinari',    priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'西成区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Nishinari-ku',        search_text:'nishinari',      priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'住之江区',  area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Suminoe-ku',          search_text:'suminoe',        priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'住吉区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Sumiyoshi-ku',        search_text:'sumiyoshi',      priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'東住吉区',  area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Higashisumiyoshi-ku', search_text:'higashisumiyoshi', priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'阿倍野区',  area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Abeno-ku',            search_text:'abeno',          priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'東淀川区',  area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Higashiyodogawa-ku',  search_text:'higashiyodogawa', priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'旭区',      area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Asahi-ku',            search_text:'asahi',          priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'城東区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Joto-ku',             search_text:'joto',           priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'平野区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Hirano-ku',           search_text:'hirano',         priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'鶴見区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Tsurumi-ku',          search_text:'tsurumi',        priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'西淀川区',  area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Nishiyodogawa-ku',    search_text:'nishiyodogawa',  priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'福島区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Fukushima-ku',        search_text:'fukushima',      priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'此花区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Konohana-ku',         search_text:'konohana',       priority:2, update_cycle_days:30, note:'' },
  { prefecture:'大阪府', city:'大阪市', ward_jp:'大正区',    area_group:'大阪', airdna_market:'Osaka', airdna_submarket:'Taisho-ku',           search_text:'taisho',         priority:2, update_cycle_days:30, note:'' },

  // ── 福岡市（Fukuoka: 7区）────────────────────────────────
  { prefecture:'福岡県', city:'福岡市', ward_jp:'中央区',    area_group:'福岡', airdna_market:'Fukuoka', airdna_submarket:'Chuo-ku',     search_text:'chuo',     priority:1, update_cycle_days:30, note:'福岡市中央区' },
  { prefecture:'福岡県', city:'福岡市', ward_jp:'博多区',    area_group:'福岡', airdna_market:'Fukuoka', airdna_submarket:'Hakata-ku',   search_text:'hakata',   priority:1, update_cycle_days:30, note:'' },
  { prefecture:'福岡県', city:'福岡市', ward_jp:'東区',      area_group:'福岡', airdna_market:'Fukuoka', airdna_submarket:'Higashi-ku',  search_text:'higashi',  priority:2, update_cycle_days:30, note:'福岡市東区' },
  { prefecture:'福岡県', city:'福岡市', ward_jp:'西区',      area_group:'福岡', airdna_market:'Fukuoka', airdna_submarket:'Nishi-ku',    search_text:'nishi',    priority:2, update_cycle_days:30, note:'福岡市西区' },
  { prefecture:'福岡県', city:'福岡市', ward_jp:'南区',      area_group:'福岡', airdna_market:'Fukuoka', airdna_submarket:'Minami-ku',   search_text:'minami',   priority:2, update_cycle_days:30, note:'福岡市南区' },
  { prefecture:'福岡県', city:'福岡市', ward_jp:'城南区',    area_group:'福岡', airdna_market:'Fukuoka', airdna_submarket:'Jonan-ku',    search_text:'jonan',    priority:2, update_cycle_days:30, note:'' },
  { prefecture:'福岡県', city:'福岡市', ward_jp:'早良区',    area_group:'福岡', airdna_market:'Fukuoka', airdna_submarket:'Sawara-ku',   search_text:'sawara',   priority:2, update_cycle_days:30, note:'' },

  // ── 札幌市（Sapporo: 10区）───────────────────────────────
  { prefecture:'北海道', city:'札幌市', ward_jp:'中央区',    area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Chuo-ku',      search_text:'chuo',      priority:1, update_cycle_days:30, note:'札幌市中央区' },
  { prefecture:'北海道', city:'札幌市', ward_jp:'北区',      area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Kita-ku',      search_text:'kita',      priority:2, update_cycle_days:30, note:'札幌市北区' },
  { prefecture:'北海道', city:'札幌市', ward_jp:'東区',      area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Higashi-ku',   search_text:'higashi',   priority:2, update_cycle_days:30, note:'札幌市東区' },
  { prefecture:'北海道', city:'札幌市', ward_jp:'白石区',    area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Shiroishi-ku', search_text:'shiroishi', priority:2, update_cycle_days:30, note:'' },
  { prefecture:'北海道', city:'札幌市', ward_jp:'厚別区',    area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Atsubetsu-ku', search_text:'atsubetsu', priority:2, update_cycle_days:30, note:'' },
  { prefecture:'北海道', city:'札幌市', ward_jp:'豊平区',    area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Toyohira-ku',  search_text:'toyohira',  priority:2, update_cycle_days:30, note:'' },
  { prefecture:'北海道', city:'札幌市', ward_jp:'清田区',    area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Kiyota-ku',    search_text:'kiyota',    priority:2, update_cycle_days:30, note:'' },
  { prefecture:'北海道', city:'札幌市', ward_jp:'南区',      area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Minami-ku',    search_text:'minami',    priority:2, update_cycle_days:30, note:'札幌市南区' },
  { prefecture:'北海道', city:'札幌市', ward_jp:'西区',      area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Nishi-ku',     search_text:'nishi',     priority:2, update_cycle_days:30, note:'札幌市西区' },
  { prefecture:'北海道', city:'札幌市', ward_jp:'手稲区',    area_group:'札幌', airdna_market:'Sapporo', airdna_submarket:'Teine-ku',     search_text:'teine',     priority:2, update_cycle_days:30, note:'' },

  // ── 名古屋市（Nagoya: 16区）──────────────────────────────
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'中区',    area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Naka-ku',     search_text:'naka',     priority:1, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'中村区',  area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Nakamura-ku', search_text:'nakamura', priority:1, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'東区',    area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Higashi-ku',  search_text:'higashi',  priority:2, update_cycle_days:30, note:'名古屋市東区' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'昭和区',  area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Showa-ku',    search_text:'showa',    priority:2, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'瑞穂区',  area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Mizuho-ku',   search_text:'mizuho',   priority:2, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'熱田区',  area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Atsuta-ku',   search_text:'atsuta',   priority:2, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'中川区',  area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Nakagawa-ku', search_text:'nakagawa', priority:2, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'港区',    area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Minato-ku',   search_text:'minato',   priority:2, update_cycle_days:30, note:'名古屋市港区' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'南区',    area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Minami-ku',   search_text:'minami',   priority:2, update_cycle_days:30, note:'名古屋市南区' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'守山区',  area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Moriyama-ku', search_text:'moriyama', priority:2, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'緑区',    area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Midori-ku',   search_text:'midori',   priority:2, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'名東区',  area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Meito-ku',    search_text:'meito',    priority:2, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'天白区',  area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Tenpaku-ku',  search_text:'tenpaku',  priority:2, update_cycle_days:30, note:'' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'北区',    area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Kita-ku',     search_text:'kita',     priority:2, update_cycle_days:30, note:'名古屋市北区' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'西区',    area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Nishi-ku',    search_text:'nishi',    priority:2, update_cycle_days:30, note:'名古屋市西区' },
  { prefecture:'愛知県', city:'名古屋市', ward_jp:'千種区',  area_group:'名古屋', airdna_market:'Nagoya', airdna_submarket:'Chikusa-ku',  search_text:'chikusa',  priority:2, update_cycle_days:30, note:'' },

  // ── 東京23区（Tokyo: 23区）───────────────────────────────
  { prefecture:'東京都', city:'東京23区', ward_jp:'千代田区', area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Chiyoda-ku',    search_text:'chiyoda',    priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'中央区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Chuo-ku',        search_text:'chuo',       priority:1, update_cycle_days:30, note:'東京都中央区' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'港区',     area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Minato-ku',      search_text:'minato',     priority:1, update_cycle_days:30, note:'東京都港区' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'新宿区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Shinjuku-ku',    search_text:'shinjuku',   priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'文京区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Bunkyo-ku',      search_text:'bunkyo',     priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'台東区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Taito-ku',       search_text:'taito',      priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'墨田区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Sumida-ku',      search_text:'sumida',     priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'江東区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Koto-ku',        search_text:'koto',       priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'品川区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Shinagawa-ku',   search_text:'shinagawa',  priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'目黒区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Meguro-ku',      search_text:'meguro',     priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'大田区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Ota-ku',         search_text:'ota',        priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'世田谷区', area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Setagaya-ku',    search_text:'setagaya',   priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'渋谷区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Shibuya-ku',     search_text:'shibuya',    priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'中野区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Nakano-ku',      search_text:'nakano',     priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'杉並区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Suginami-ku',    search_text:'suginami',   priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'豊島区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Toshima-ku',     search_text:'toshima',    priority:1, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'北区',     area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Kita-ku',        search_text:'kita',       priority:2, update_cycle_days:30, note:'東京都北区' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'荒川区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Arakawa-ku',     search_text:'arakawa',    priority:2, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'板橋区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Itabashi-ku',    search_text:'itabashi',   priority:2, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'練馬区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Nerima-ku',      search_text:'nerima',     priority:2, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'足立区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Adachi-ku',      search_text:'adachi',     priority:2, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'葛飾区',   area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Katsushika-ku',  search_text:'katsushika', priority:2, update_cycle_days:30, note:'' },
  { prefecture:'東京都', city:'東京23区', ward_jp:'江戸川区', area_group:'東京', airdna_market:'Tokyo', airdna_submarket:'Edogawa-ku',     search_text:'edogawa',    priority:2, update_cycle_days:30, note:'' }
];

// ── 公開関数 ─────────────────────────────────────────────

// 初回のみ実行：6シート作成 + Masterデータ初期投入
function initializeSubmarketMaster() {
  setupAllSheets_();

  const sheet = getSheet_(SHEET.MASTER);
  if (sheet.getLastRow() >= 2) {
    SpreadsheetApp.getUi().alert('AirDNA_Submarket_Master にすでにデータが存在します。\n初期化をスキップしました。');
    return;
  }

  const rows = INITIAL_SUBMARKETS.map((s, i) => [
    i + 1,                   // id
    s.prefecture,            // prefecture
    s.city,                  // city
    s.ward_jp,               // ward_jp
    s.area_group,            // area_group
    s.airdna_market,         // airdna_market
    s.airdna_submarket,      // airdna_submarket
    s.search_text,           // search_text
    s.priority,              // priority
    true,                    // is_active
    s.update_cycle_days,     // update_cycle_days
    '',                      // last_exported_at
    '',                      // last_imported_at
    '',                      // next_due_at
    'pending',               // status
    s.note                   // note
  ]);

  sheet.getRange(2, 1, rows.length, MASTER_HEADERS.length).setValues(rows);
  SpreadsheetApp.getUi().alert(`${rows.length}件のSubmarketマスタを登録しました。`);
}

// prefecture + city + ward_jp の完全一致でmaster_idを返す
// 一致しない場合はUnmatched_Area_Logに記録してnullを返す
function findSubmarketByKey(prefecture, city, ward_jp, source, rawAddress) {
  const sheet = getSheet_(SHEET.MASTER);
  const rows = readAllRows_(sheet);

  const matched = rows.find(r =>
    String(r[MASTER_COL.PREFECTURE]) === String(prefecture) &&
    String(r[MASTER_COL.CITY])       === String(city) &&
    String(r[MASTER_COL.WARD_JP])    === String(ward_jp) &&
    r[MASTER_COL.IS_ACTIVE] === true
  );

  if (matched) return matched[MASTER_COL.ID];

  logUnmatchedArea_(source || 'unknown', prefecture, city, ward_jp, rawAddress || '', 'no_match_in_master');
  return null;
}

// ImportログからMasterの日付・ステータスを更新
function updateMasterAfterImport(masterId, importedAt) {
  const sheet = getSheet_(SHEET.MASTER);
  const rows = readAllRows_(sheet);

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][MASTER_COL.ID] == masterId) {
      const rowNum = i + 2;
      const cycleDays = parseInt(rows[i][MASTER_COL.CYCLE_DAYS], 10) || 30;
      const nextDue = addDays_(dateToStr_(importedAt), cycleDays);

      sheet.getRange(rowNum, MASTER_COL.LAST_IMPORTED + 1).setValue(dateToStr_(importedAt));
      sheet.getRange(rowNum, MASTER_COL.NEXT_DUE + 1).setValue(nextDue);
      sheet.getRange(rowNum, MASTER_COL.STATUS + 1).setValue('imported');
      return;
    }
  }
}

// is_activeなSubmarket全件を返す（キュー構築用）
function getAllActiveSubmarkets() {
  const sheet = getSheet_(SHEET.MASTER);
  return readAllRows_(sheet).filter(r => r[MASTER_COL.IS_ACTIVE] === true);
}

// ── 内部関数 ─────────────────────────────────────────────

function setupAllSheets_() {
  setSheetHeader_(getSheet_(SHEET.MASTER),    MASTER_HEADERS);
  setSheetHeader_(getSheet_(SHEET.QUEUE),     QUEUE_HEADERS);
  setSheetHeader_(getSheet_(SHEET.DB),        DB_HEADERS);
  setSheetHeader_(getSheet_(SHEET.LOG),       LOG_HEADERS);
  setSheetHeader_(getSheet_(SHEET.UNMATCHED), UNMATCHED_HEADERS);
  initSettingsSheet_();
  SpreadsheetApp.flush();
}

function logUnmatchedArea_(source, prefecture, city, ward_jp, rawAddress, reason) {
  const sheet = getSheet_(SHEET.UNMATCHED);
  setSheetHeader_(sheet, UNMATCHED_HEADERS);
  sheet.appendRow([
    nowStr_(),     // logged_at
    source,        // source
    prefecture,    // prefecture
    city,          // city
    ward_jp,       // ward_jp
    rawAddress,    // raw_address
    reason,        // reason
    'unresolved',  // status
    ''             // note
  ]);
}
