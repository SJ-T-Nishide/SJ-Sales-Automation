/**
 * atHome物件抽出 - content.js v1.1
 * Runs on: https://www.athome.co.jp/*
 *
 * URLパターンで抽出ロジックを自動切り替え:
 *   /chintai/ → 建物×部屋ループ (div.p-property--building)
 *   /rent_store/ 等 → 物件カードループ (li.card-box)
 */

'use strict';

const STORAGE_KEY = 'athome_records';
const TAB_NAME    = 'atHome';
const SOURCE_NAME = 'atHome';

// TSVヘッダー（55列）
const TSV_HEADERS = [
  'タブ名', '取得日時', '連番', '物件番号', '取得元',
  '物件種目', '所在地', '建物名', '賃料(万円)', '管理費(円)',
  '面積(㎡)', '㎡単価(万円)', '坪単価(万円)', '間取', '所在階',
  '築年月', '交通', '電話番号', '用途地域', '敷金',
  '保証金', '礼金', 'source_url', '備考', 'duplicate_key',
  'preliminary_score', 'first_judgement', 'manual_judgement', 'detail_status',
  '水道光熱費', 'Wi-Fi', '消耗品費', 'リネン備品費', '保険料',
  'その他費用', '月次費用合計', '保守_CF/月', '標準_CF/月', '攻め_CF/月',
  '保守_年間CF', '標準_年間CF', '攻め_年間CF', '初期投資額',
  '保守_年間利回り%', '標準_年間利回り%', '攻め_年間利回り%', '投資回収月数_標準',
  '標準判定', '判定根拠', '実行日時', 'メモ', '取得元シート名',
  '賃料', '管理費', '面積',
];

// ======================================================
// ユーティリティ
// ======================================================
function getText(el) {
  return el ? el.textContent.trim() : '';
}

function now() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' +
    z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds())
  );
}

/** 全角数字→半角数字 */
function toHalfNum(str) {
  return String(str).replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

/** "30.94m²" や "42.39m²..." から数値文字列を抽出 */
function parseArea(raw) {
  if (!raw) return '';
  const m = raw.match(/[\d.]+/);
  return m ? m[0] : '';
}

/** "6,000円" or "35,255円" → "6000" */
function parseKanrihi(raw) {
  if (!raw) return '';
  const m = raw.replace(/[,，]/g, '').match(/\d+/);
  return m ? m[0] : '';
}

/** "万円" 除去して数値文字列を返す */
function parseRent(raw) {
  return raw ? raw.replace(/万円$/, '').trim() : '';
}

/**
 * 部屋番号から所在階を推定（chintai用）
 * "２０１" → "2階"
 */
function floorFromRoomNo(roomNo) {
  if (!roomNo) return '';
  const half = toHalfNum(roomNo).replace(/\s/g, '');
  const b = half.match(/^[Bb](\d+)/);
  if (b) return 'B' + b[1] + '階';
  const m = half.match(/^(\d+)/);
  if (!m) return '';
  const digits = m[1];
  if (digits.length >= 3) return String(parseInt(digits.slice(0, digits.length - 2), 10)) + '階';
  return String(parseInt(digits, 10)) + '階';
}

/** 重複排除キーを作成 */
function makeDupKey(propNo, sourceUrl) {
  if (propNo) return 'id:' + propNo;
  if (sourceUrl) {
    try {
      const u = new URL(sourceUrl);
      return 'url:' + u.origin + u.pathname;
    } catch (e) { return 'url:' + sourceUrl; }
  }
  return '';
}

/** 空レコードを作成（TSV_HEADERS全列を空欄で初期化） */
function blankRecord() {
  const r = {};
  TSV_HEADERS.forEach(h => { r[h] = ''; });
  return r;
}

// ======================================================
// ① chintai ページ用抽出
//    URL: /chintai/
//    構造: div.p-property--building → div.p-property__room--detailbox
// ======================================================

function extractBuilding(bldEl) {
  const nameRaw = getText(bldEl.querySelector('h2.p-property__title--building'));
  const buildingName = nameRaw.replace(/\s+\d+階建.*$/, '').trim();

  let address = '', traffic = '', typeRaw = '';
  bldEl.querySelectorAll('dl').forEach(dl => {
    const icon = dl.querySelector('i');
    if (!icon) return;
    const cls = icon.className || '';
    const dd = dl.querySelector('dd');
    if (!dd) return;
    if (cls.includes('u-icon--map-mini'))   address = getText(dd);
    else if (cls.includes('u-icon--train-mini')) traffic = getText(dd);
    else if (cls.includes('u-icon--home-mini'))  typeRaw = getText(dd);
  });

  const propType  = typeRaw ? typeRaw.split(/[\s　]/)[0] : '';
  const builtMatch = typeRaw.match(/(\d{4}年\d+月)/);
  const builtDate  = builtMatch ? builtMatch[1] : '';

  return { buildingName, address, traffic, propType, builtDate };
}

function extractChintaiRoom(roomEl, bldInfo) {
  const ts = now();

  const roomNoRaw = getText(roomEl.querySelector('li.p-property__room-number'));
  const roomNo    = toHalfNum(roomNoRaw);
  const floor     = floorFromRoomNo(roomNo);

  const rentRaw   = getText(roomEl.querySelector('b.p-property__information-rent'));
  const rent      = rentRaw;

  const kanrihiRaw = getText(roomEl.querySelector('p.p-property__information-price > span'));
  const kanrihi    = parseKanrihi(kanrihiRaw);

  let shikikin = '', reikin = '';
  roomEl.querySelectorAll('li.p-property__room-keymoney').forEach(li => {
    const p    = li.querySelector('p');
    const span = li.querySelector('span.shikirei_text_free');
    if (p    && !shikikin) shikikin = getText(p);
    if (span && !reikin)   reikin   = getText(span);
  });

  const madori  = getText(roomEl.querySelector('div.p-property__floor'));
  const areaRaw = getText(roomEl.querySelector('li.p-property__room-floorplan > span'));
  const area    = parseArea(areaRaw);

  let sourceUrl = '', propNo = '';
  const linkEl = roomEl.querySelector('a[href*="/chintai/"]');
  if (linkEl) {
    const href = linkEl.getAttribute('href') || '';
    sourceUrl = href.startsWith('http') ? href : 'https://www.athome.co.jp' + href;
    const m = sourceUrl.match(/\/chintai\/(\d+)\//);
    propNo = m ? m[1] : '';
  }

  const rec = blankRecord();
  rec['タブ名']      = TAB_NAME;
  rec['取得日時']    = ts;
  rec['物件番号']    = propNo;
  rec['取得元']      = SOURCE_NAME;
  rec['物件種目']    = bldInfo.propType;
  rec['所在地']      = bldInfo.address;
  rec['建物名']      = bldInfo.buildingName;
  rec['賃料(万円)']  = rent;
  rec['管理費(円)']  = kanrihi;
  rec['面積(㎡)']    = area;
  rec['間取']        = madori;
  rec['所在階']      = floor;
  rec['築年月']      = bldInfo.builtDate;
  rec['交通']        = bldInfo.traffic;
  rec['敷金']        = shikikin;
  rec['礼金']        = reikin;
  rec['source_url']  = sourceUrl;
  rec._dupKey = makeDupKey(propNo, sourceUrl);
  return rec;
}

function extractPageChintai() {
  const buildings = document.querySelectorAll('div.p-property--building');
  if (buildings.length === 0) {
    console.warn('[atHome抽出] ⚠ div.p-property--building が見つかりません');
    return [];
  }

  const records = [];
  buildings.forEach((bldEl, bi) => {
    let bldInfo;
    try { bldInfo = extractBuilding(bldEl); }
    catch (e) { console.error('[atHome抽出] 建物情報エラー['+bi+']:', e); return; }

    bldEl.querySelectorAll('div.p-property__room--detailbox').forEach((roomEl, ri) => {
      try {
        const rec = extractChintaiRoom(roomEl, bldInfo);
        if (rec['賃料(万円)'] || rec['所在地'] || rec['source_url']) records.push(rec);
      } catch (e) {
        console.error('[atHome抽出] 部屋エラー 建物['+bi+'] 部屋['+ri+']:', e);
      }
    });
  });

  console.log('[atHome抽出] 抽出(chintai):', records.length + '件 from', location.href);
  return records;
}

// ======================================================
// ② rent_store / その他 ページ用抽出
//    URL: /rent_store/, /office/ 等
//    構造: li.card-box（1件1カード）
//
//    li.card-box
//      div.area-title__top         → タイトル "建物名 X階の物件種目"
//      table.area-inner__right
//        tr.tr-top
//          td[0] span[0]           → 交通 "西中島南方/地下鉄御堂筋線 徒歩5分"
//          td[0] span[1]           → 所在地 "大阪市淀川区西中島３丁目"
//          td[1] span.red          → 賃料 "7.7561万円"
//          td[1] textNode after br → 管理費 "35,255円"
//          td[2] text(br区切り)    → 敷金 / 礼金 / 保証金
//          td[3] text              → 面積 "42.39m²..."
//          td[4] text              → 築年月 "1970年1月（築56年5ヶ月）"
//      a.area-inner__detail        → 詳細URL "/rent_store/1131319215/"
// ======================================================

function extractRentStoreCard(card) {
  const ts = now();

  // ---- タイトルから建物名・所在階・物件種目を分解 ----
  const titleEl   = card.querySelector('div.area-title__top');
  const titleText = titleEl ? titleEl.textContent.trim().replace(/\s+/g, ' ') : '';
  let buildingName = '', floor = '', propType = '';
  // パターン: "xxx N階のyyy"
  const titleMatch = titleText.match(/^(.+?)\s+(\d+階)の(.+)$/);
  if (titleMatch) {
    buildingName = titleMatch[1];
    floor        = titleMatch[2];
    propType     = titleMatch[3];
  } else {
    propType = titleText;
  }

  // ---- テーブルの td を取得 ----
  const tr0 = card.querySelector('tr.tr-top');
  const tds = tr0 ? Array.from(tr0.querySelectorAll('td')) : [];

  // td[0]: 交通 + 所在地
  let traffic = '', address = '';
  if (tds[0]) {
    const spans = Array.from(tds[0].querySelectorAll('span'));
    traffic = spans[0] ? spans[0].textContent.trim() : '';
    address = spans[1] ? spans[1].textContent.trim() : '';
  }

  // td[1]: 賃料(万円) + 管理費(円)
  let rent = '', kanrihi = '';
  if (tds[1]) {
    const rentSpan = tds[1].querySelector('span.red');
    rent = rentSpan ? parseRent(rentSpan.textContent.trim()) : '';
    // 管理費はspan.red の後のテキストノード
    const kanrihiText = Array.from(tds[1].childNodes)
      .filter(n => n.nodeType === 3 && n.textContent.trim())
      .map(n => n.textContent.trim())
      .join('');
    kanrihi = parseKanrihi(kanrihiText);
  }

  // td[2]: 敷金 / 礼金 (brで区切られたテキスト)
  let shikikin = '', reikin = '';
  if (tds[2]) {
    const parts = tds[2].innerHTML
      .replace(/<br[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    shikikin = parts[0] || '';
    reikin   = parts[1] || '';
  }

  // td[3]: 面積
  const area = tds[3] ? parseArea(tds[3].textContent.trim()) : '';

  // td[4]: 築年月
  let builtDate = '';
  if (tds[4]) {
    const bm = tds[4].textContent.match(/(\d{4}年\d+月)/);
    builtDate = bm ? bm[1] : '';
  }

  // ---- 詳細URL・物件番号 ----
  const detailA = card.querySelector('a.area-inner__detail');
  const href    = detailA ? detailA.getAttribute('href') : '';
  const sourceUrl = href
    ? (href.startsWith('http') ? href : 'https://www.athome.co.jp' + href)
    : '';
  const propNoMatch = sourceUrl.match(/\/(?:rent_store|office|chintai|mansion)\/(\d+)\//);
  const propNo = propNoMatch ? propNoMatch[1] : '';

  const rec = blankRecord();
  rec['タブ名']      = TAB_NAME;
  rec['取得日時']    = ts;
  rec['物件番号']    = propNo;
  rec['取得元']      = SOURCE_NAME;
  rec['物件種目']    = propType;
  rec['所在地']      = address;
  rec['建物名']      = buildingName;
  rec['賃料(万円)']  = rent;
  rec['管理費(円)']  = kanrihi;
  rec['面積(㎡)']    = area;
  rec['所在階']      = floor;
  rec['築年月']      = builtDate;
  rec['交通']        = traffic;
  rec['敷金']        = shikikin;
  rec['礼金']        = reikin;
  rec['source_url']  = sourceUrl;
  rec._dupKey = makeDupKey(propNo, sourceUrl);
  return rec;
}

function extractPageRentStore() {
  const cards = document.querySelectorAll('li.card-box');
  if (cards.length === 0) {
    console.warn('[atHome抽出] ⚠ li.card-box が見つかりません');
    debugDump();
    return [];
  }

  const records = [];
  cards.forEach((card, idx) => {
    try {
      const rec = extractRentStoreCard(card);
      if (rec['賃料(万円)'] || rec['所在地'] || rec['source_url']) records.push(rec);
    } catch (e) {
      console.error('[atHome抽出] カード抽出エラー['+idx+']:', e);
    }
  });

  console.log('[atHome抽出] 抽出(rent_store):', records.length + '件 from', location.href);
  return records;
}

// ======================================================
// ページ全体から物件を抽出（URLで自動切り替え）
// ======================================================
function extractPage() {
  const path = location.pathname;
  if (path.includes('/chintai/')) {
    return extractPageChintai();
  } else {
    // rent_store / office / mansion 等
    return extractPageRentStore();
  }
}

// ======================================================
// chrome.storage.local に保存（重複排除つき）
// ======================================================
async function saveRecords(records) {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const existing    = data[STORAGE_KEY] || [];
      const existingKeys = new Set(existing.map(r => r._dupKey || ''));

      let added = 0, skipped = 0;
      const newRecords = [];
      records.forEach(r => {
        const key = r._dupKey || '';
        if (key && existingKeys.has(key)) {
          skipped++;
        } else {
          newRecords.push(r);
          if (key) existingKeys.add(key);
          added++;
        }
      });

      const merged = [...existing, ...newRecords];
      chrome.storage.local.set({ [STORAGE_KEY]: merged }, () => {
        resolve({ total: merged.length, extracted: records.length, added, skipped });
      });
    });
  });
}

// ======================================================
// デバッグ情報ダンプ
// ======================================================
function debugDump() {
  console.group('[atHome抽出] ===== DEBUG DUMP =====');
  console.log('URL:', location.href);
  console.log('Title:', document.title);

  // chintai
  const buildings = document.querySelectorAll('div.p-property--building');
  console.log('div.p-property--building:', buildings.length);

  // rent_store
  const cards = document.querySelectorAll('li.card-box');
  console.log('li.card-box:', cards.length);
  if (cards.length > 0) {
    const c = cards[0];
    console.log('  タイトル:', getText(c.querySelector('div.area-title__top')));
    const tr0 = c.querySelector('tr.tr-top');
    const tds = tr0 ? Array.from(tr0.querySelectorAll('td')) : [];
    tds.forEach((td, i) => console.log('  td['+i+']:', td.textContent.trim().replace(/\s+/g,' ').substring(0,60)));
    const detailA = c.querySelector('a.area-inner__detail');
    console.log('  detail href:', detailA ? detailA.getAttribute('href') : 'none');
  }

  // div class頻度
  console.group('【div クラス頻度（5件以上）】');
  const divCounts = {};
  document.querySelectorAll('div[class]').forEach(d => {
    const cls = d.className.split(' ')[0];
    if (cls) divCounts[cls] = (divCounts[cls] || 0) + 1;
  });
  Object.entries(divCounts)
    .filter(([, v]) => v >= 5)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .forEach(([cls, cnt]) => console.log(cnt + '件 | .' + cls));
  console.groupEnd();

  console.groupEnd();
}

// ======================================================
// メッセージハンドラ（popup.js から受信）
// ======================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'extract') {
    const records = extractPage();
    saveRecords(records).then(result => {
      const SAMPLE_FIELDS = [
        '物件番号', '建物名', '所在地', '賃料(万円)', '面積(㎡)',
        '物件種目', '所在階', '築年月', '交通', 'source_url',
      ];
      const sample = records.slice(0, 3).map(r => {
        const obj = {};
        SAMPLE_FIELDS.forEach(k => { obj[k] = r[k] ?? ''; });
        return obj;
      });
      sendResponse({ ok: true, ...result, sample });
    });
    return true;

  } else if (msg.action === 'debug') {
    debugDump();
    sendResponse({ ok: true });
  }
});
