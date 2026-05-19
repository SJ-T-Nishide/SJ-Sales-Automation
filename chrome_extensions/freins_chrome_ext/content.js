/**
 * ふれんず物件抽出 - content.js v3.0
 * Runs on: https://www.f-takken.com/freins/*
 *
 * 動作:
 *   - popup から "extract" メッセージを受け取ったときだけ抽出
 *   - ページ読み込み時の自動抽出・自動ページ送りは行わない
 *   - chrome.storage.local に蓄積（ページをまたいで保持）
 *
 * 重複排除の優先順位:
 *   1. source_property_id（物件番号）が一致
 *   2. 正規化した source_url が一致
 *   3. 所在地 + 賃料数字 + 面積数字 が一致
 */

'use strict';

// ======================================================
// TSV列定義（スプレッドシートの受信タブ列順に合わせる）
// ======================================================
// 管理情報 (Group A)
// 物件基本情報 (Group B) - ふれんずで取れない項目は空欄出力
const TSV_HEADERS = [
  'source',              // = ふれんず
  'source_property_id',  // 物件番号
  'source_url',          // 詳細URL
  'collected_at',        // 抽出日時
  '所在地',
  '賃料',
  '専有面積',
  '物件種別',
  '築年数',
  '最寄駅',
  '徒歩(分)',
  '管理費',              // 空欄
  '敷金',                // 空欄
  '礼金',                // 空欄
  '間取り',              // 空欄
  '建物種別',            // 空欄
  '階数',                // 空欄
  '物件名',              // 空欄
  '備考',                // 空欄
  'duplicate_key',       // 空欄（GASが生成）
  'detail_status',       // 空欄
  'minpaku_score',       // 空欄（GASが計算）
  'first_judgement',     // 空欄（GASが計算）
];

// ======================================================
// 物件カードセレクタ候補（DOM確認後に先頭に正解を追加）
// ======================================================
const CARD_SELECTORS = [
  'ul.listWrap > li',
  'ul.itemList > li',
  '.item-list > li',
  '.property-list > li',
  '.search-result > li',
  '.result-list > li',
  '.bukken-list > li',
  'ul.list > li',
  'table.searchList > tbody > tr',
  'table.list > tbody > tr',
  'table.dataList > tbody > tr',
  '.property-item',
  '.item-card',
  '.bukken-item',
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

function toAbsUrl(href) {
  if (!href) return '';
  try { return new URL(href, location.href).href; } catch (e) { return href; }
}

/** 正規化住所 + 賃料数字 + 面積数字 のフォールバックキー */
function makeAddrKey(address, rent, area) {
  const addr = String(address)
    .replace(/[\s　]/g, '')
    .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/丁目/g, '-')
    .replace(/番地/g, '-')
    .replace(/番/g, '-')
    .replace(/号/g, '')
    .substring(0, 20);
  const rentNum = String(rent).replace(/[^0-9]/g, '');
  const areaNum = String(area).replace(/[^0-9.]/g, '');
  return [addr, rentNum, areaNum].join('_');
}

/** 詳細URLを正規化（クエリパラメータを除いたパス部分） */
function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch (e) { return url; }
}

/** 詳細URLから物件番号を抽出 */
function extractPropNoFromUrl(url) {
  if (!url) return '';
  const m = url.match(/\/(\d+)\/?(?:[?#]|$)/);
  return m ? m[1] : '';
}

/** URLから種別を推定 */
function detectTypeFromUrl() {
  const u = location.href;
  if (/\/business\//.test(u)) return '店舗・事務所';
  if (/act(%5B%5D|%5b%5d|\[\])=list34/.test(u)) return '工場・倉庫・その他';
  if (/\/other\//.test(u)) return 'その他';
  return '';
}

// ======================================================
// 物件カードのコンテナを自動検出
// ======================================================
function findCardContainer() {
  for (const sel of CARD_SELECTORS) {
    try {
      const items = document.querySelectorAll(sel);
      if (items.length >= 1) {
        const s = items[0];
        if (s.querySelector('a') || /[\d]/.test(getText(s))) {
          console.log('[ふれんず抽出] カード検出:', sel, items.length + '件');
          return { selector: sel, items };
        }
      }
    } catch (e) { /* ignore */ }
  }

  // フォールバック: li数最多のulを探す
  let best = null, bestCount = 0;
  document.querySelectorAll('ul').forEach(ul => {
    const lis = ul.querySelectorAll(':scope > li');
    if (lis.length > bestCount && lis.length >= 2) {
      const s = lis[0];
      if (s.querySelector('a') || /[\d万円㎡]/.test(getText(s))) {
        bestCount = lis.length;
        best = { selector: 'ul>li(auto)', items: lis };
      }
    }
  });

  return best || null;
}

// ======================================================
// 1件の物件カードから情報を抽出
// ======================================================
function extractCard(el) {
  // --- 詳細URL ---
  const links = Array.from(el.querySelectorAll('a[href]'));
  const detailLink =
    links.find(a => /\/(detail|property|bukken|item)\//.test(a.getAttribute('href') || '')) ||
    links[0];
  const sourceUrl = detailLink ? toAbsUrl(detailLink.getAttribute('href')) : '';

  // --- ラベル→値マッピング (dt/dd, th/td) ---
  const lmap = {};

  el.querySelectorAll('dt').forEach(dt => {
    const dd = dt.nextElementSibling;
    if (dd) {
      const key = getText(dt).replace(/[\s　：:・]/g, '');
      if (key) lmap[key] = getText(dd);
    }
  });

  el.querySelectorAll('tr').forEach(tr => {
    const th = tr.querySelector('th');
    const td = tr.querySelector('td');
    if (th && td) {
      const key = getText(th).replace(/[\s　：:・]/g, '');
      if (key) lmap[key] = getText(td);
    }
  });

  el.querySelectorAll('[class*="label"],[class*="head"],[class*="caption"]').forEach(lbl => {
    const val = lbl.nextElementSibling;
    if (val) {
      const key = getText(lbl).replace(/[\s　：:・]/g, '');
      if (key) lmap[key] = getText(val);
    }
  });

  // --- source_property_id (物件番号) ---
  const sourcePropId =
    el.dataset.id ||
    el.dataset.propertyId ||
    lmap['物件番号'] || lmap['物件No'] || lmap['物件no'] || lmap['番号'] ||
    extractPropNoFromUrl(sourceUrl);

  // --- 所在地 ---
  const addrEl = el.querySelector(
    '[class*="address"],[class*="addr"],[class*="location"],[class*="jusho"]'
  );
  const address =
    getText(addrEl) ||
    lmap['所在地'] || lmap['住所'] || lmap['場所'] || lmap['地番'] || '';

  // --- 賃料 ---
  // ラベルマッチを優先し、なければ class 名で探す（fee は管理費を誤取得するため除外）
  const rent =
    lmap['賃料'] || lmap['月額賃料'] || lmap['月額'] || lmap['価格'] ||
    (() => {
      const rentEl = el.querySelector('[class*="price"],[class*="rent"],[class*="chinryo"]');
      return getText(rentEl);
    })();

  // --- 専有面積 ---
  const areaEl = el.querySelector('[class*="area"],[class*="menseki"],[class*="size"]');
  const area =
    getText(areaEl) ||
    lmap['専有面積'] || lmap['面積'] || lmap['建物面積'] ||
    lmap['延床面積'] || lmap['床面積'] || '';

  // --- 物件種別 ---
  const typeEl = el.querySelector(
    '[class*="type"],[class*="shubetsu"],[class*="category"],[class*="kind"]'
  );
  const type =
    getText(typeEl) ||
    lmap['物件種別'] || lmap['種別'] || lmap['カテゴリ'] ||
    detectTypeFromUrl();

  // --- 築年数 ---
  const age =
    lmap['築年数'] || lmap['築年月'] || lmap['築年'] ||
    lmap['竣工年'] || lmap['建築年'] || lmap['築'] || '';

  // --- 最寄駅 / 徒歩 ---
  const accessEl = el.querySelector(
    '[class*="station"],[class*="access"],[class*="eki"],[class*="traffic"]'
  );
  let stationRaw =
    getText(accessEl) ||
    lmap['最寄駅'] || lmap['最寄り駅'] || lmap['交通'] || lmap['アクセス'] || '';

  let station = stationRaw;
  let walk = '';
  const walkM = stationRaw.match(/徒歩\s*(\d+)\s*分/);
  if (walkM) {
    walk = walkM[1];
    station = stationRaw.replace(/徒歩\s*\d+\s*分/, '').trim();
  } else {
    const walkRaw = lmap['徒歩'] || lmap['徒歩分'] || '';
    walk = walkRaw.replace(/[^0-9]/g, '');
  }

  // ======================================================
  // 重複排除キー（3段階優先）
  // ======================================================
  let _dupKey = '';
  if (sourcePropId) {
    // 優先1: source_property_id
    _dupKey = 'id:' + String(sourcePropId);
  } else if (sourceUrl) {
    // 優先2: 正規化 source_url
    _dupKey = 'url:' + normalizeUrl(sourceUrl);
  } else {
    // 優先3: 所在地 + 賃料数字 + 面積数字（2項目以上取れている場合のみ使用）
    const addrOk  = address.trim() !== '';
    const rentOk  = String(rent).replace(/[^0-9]/g, '') !== '';
    const areaOk  = String(area).replace(/[^0-9.]/g, '') !== '';
    const filledCount = [addrOk, rentOk, areaOk].filter(Boolean).length;
    if (filledCount >= 2) {
      _dupKey = 'addr:' + makeAddrKey(address, rent, area);
    }
    // 1項目以下 → _dupKey = '' のまま（重複判定対象外）
  }

  return {
    'source':             'ふれんず',
    'source_property_id': String(sourcePropId),
    'source_url':         sourceUrl,
    'collected_at':       now(),
    '所在地':             address,
    '賃料':               rent,
    '専有面積':           area,
    '物件種別':           type,
    '築年数':             age,
    '最寄駅':             station,
    '徒歩(分)':           walk,
    '管理費':             '',
    '敷金':               '',
    '礼金':               '',
    '間取り':             '',
    '建物種別':           '',
    '階数':               '',
    '物件名':             '',
    '備考':               '',
    'duplicate_key':      '',
    'detail_status':      '',
    'minpaku_score':      '',
    'first_judgement':    '',
    // 内部管理（TSV非出力）
    _dupKey,
  };
}

// ======================================================
// ページ全体から物件を抽出
// ======================================================
function extractPage() {
  const container = findCardContainer();
  if (!container) {
    console.warn('[ふれんず抽出] ⚠ 物件カードが見つかりませんでした。');
    debugDump();
    return [];
  }

  const records = [];
  container.items.forEach((el) => {
    try {
      const rec = extractCard(el);
      if (rec['所在地'] || rec['source_property_id'] || rec['賃料'] || rec['source_url']) {
        records.push(rec);
      }
    } catch (e) {
      console.error('[ふれんず抽出] カード抽出エラー:', e);
    }
  });

  console.log('[ふれんず抽出] 抽出:', records.length + '件 from', location.href);
  return records;
}

// ======================================================
// chrome.storage.local に保存（重複排除つき）
// ======================================================
async function saveRecords(records) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['freins_records'], (data) => {
      const existing = data.freins_records || [];
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
      chrome.storage.local.set({ freins_records: merged }, () => {
        resolve({
          total:    merged.length,
          extracted: records.length,
          added,
          skipped,
        });
      });
    });
  });
}

// ======================================================
// デバッグ情報ダンプ（抽出0件時に詳細情報を出力）
// ======================================================
function debugDump() {
  console.group('[ふれんず抽出] ===== DEBUG DUMP =====');
  console.log('URL:', location.href);
  console.log('Title:', document.title);

  // li 要素を持つ ul を件数順にソートして表示
  console.group('【ul 要素一覧】class名 / li数 / 先頭liのclass');
  const ulList = [];
  document.querySelectorAll('ul').forEach((ul) => {
    const lis = ul.querySelectorAll(':scope > li');
    if (lis.length > 0) {
      ulList.push({ el: ul, count: lis.length });
    }
  });
  ulList.sort((a, b) => b.count - a.count);
  ulList.slice(0, 10).forEach(({ el, count }) => {
    const lis = el.querySelectorAll(':scope > li');
    console.log(
      `li数=${count} | ul.class="${el.className}" ul.id="${el.id}"`,
      `| 先頭li.class="${lis[0] ? lis[0].className : ''}"`,
    );
  });
  console.groupEnd();

  // div 要素（繰り返し構造を探す）
  console.group('【div 繰り返し構造候補】class名 / 件数');
  const divCounts = {};
  document.querySelectorAll('div[class]').forEach(d => {
    const cls = d.className.split(' ')[0];
    if (!cls) return;
    divCounts[cls] = (divCounts[cls] || 0) + 1;
  });
  Object.entries(divCounts)
    .filter(([, v]) => v >= 3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .forEach(([cls, cnt]) => console.log(`${cnt}件 | .${cls}`));
  console.groupEnd();

  // 先頭カード候補の outerHTML
  console.group('【先頭カード候補 outerHTML】');
  const ulWithMostLi = ulList[0];
  if (ulWithMostLi) {
    const firstLi = ulWithMostLi.el.querySelector(':scope > li');
    if (firstLi) {
      console.log('▼ 最多li数ul の先頭 li.outerHTML (先頭1000文字):');
      console.log(firstLi.outerHTML.slice(0, 1000));
    }
  }
  console.groupEnd();

  // 詳細リンク候補
  console.group('【詳細リンク候補（先頭10件）】');
  Array.from(document.querySelectorAll('a[href]'))
    .filter(a => /\/(detail|property|bukken|item)\//.test(a.getAttribute('href') || ''))
    .slice(0, 10)
    .forEach(a => console.log(a.getAttribute('href'), '|', getText(a).slice(0, 40)));
  console.groupEnd();

  console.group('【対策】CARD_SELECTORS の先頭に正しいセレクタを追加してください');
  console.log('例: ul 先頭li.classが "propItem" なら → "ul > li.propItem" を追加');
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
      // 先頭3件のプレビュー（確認用・本番では削除可）
      const SAMPLE_FIELDS = [
        'source_property_id', '所在地', '賃料', '専有面積',
        '物件種別', '最寄駅', '徒歩(分)', 'source_url',
      ];
      const sample = records.slice(0, 3).map(r => {
        const obj = {};
        SAMPLE_FIELDS.forEach(k => { obj[k] = r[k] ?? ''; });
        return obj;
      });
      sendResponse({ ok: true, ...result, sample });
    });
    return true; // 非同期レスポンス

  } else if (msg.action === 'debug') {
    debugDump();
    sendResponse({ ok: true });
  }
});
