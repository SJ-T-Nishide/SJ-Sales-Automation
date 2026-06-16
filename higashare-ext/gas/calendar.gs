// ============================================================
// Googleカレンダー 空き枠取得
// ============================================================

var WEEKDAY_START_HOUR = 19;
var WEEKDAY_END_HOUR   = 22;
var WEEKEND_START_HOUR = 12;
var WEEKEND_END_HOUR   = 22;
var SLOT_DURATION_MIN  = 90;  // 90分枠（設定可：90 or 120）
var BUFFER_BEFORE_MIN  = 60;  // 既存予定の前60分はブロック
var BUFFER_AFTER_MIN   = 30;  // 既存予定の後30分はブロック
var LOOK_AHEAD_DAYS    = 14;
var MAX_SLOTS          = 5;

function getFreeSlots() {
  var calendar = CalendarApp.getDefaultCalendar();
  var now  = new Date();
  var end  = new Date(now.getTime() + LOOK_AHEAD_DAYS * 24 * 60 * 60 * 1000);

  var existingEvents = calendar.getEvents(now, end);

  // 終日予定がある日付セット（'yyyy/MM/dd' 形式）
  var allDayDates = buildAllDayDateSet(existingEvents);

  var slots = [];
  var cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1); // 明日から検索

  while (cursor <= end && slots.length < MAX_SLOTS) {
    var dateKey = Utilities.formatDate(cursor, 'Asia/Tokyo', 'yyyy/MM/dd');

    // 終日予定がある日は丸ごとスキップ
    if (allDayDates[dateKey]) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    var dow = cursor.getDay(); // 0=日, 6=土
    var isWeekend = (dow === 0 || dow === 6);
    var startHour = isWeekend ? WEEKEND_START_HOUR : WEEKDAY_START_HOUR;
    var endHour   = isWeekend ? WEEKEND_END_HOUR   : WEEKDAY_END_HOUR;

    for (var m = startHour * 60; m + SLOT_DURATION_MIN <= endHour * 60; m += SLOT_DURATION_MIN) {
      var slotStart = new Date(cursor);
      slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0);
      var slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MIN * 60 * 1000);

      if (slotStart < now) continue;
      if (!hasConflictWithBuffer(existingEvents, slotStart, slotEnd)) {
        slots.push(formatSlot(slotStart, slotEnd));
        if (slots.length >= MAX_SLOTS) break;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  logCalendarSlots(slots);
  return { success: true, slots: slots };
}

function buildAllDayDateSet(events) {
  var set = {};
  for (var i = 0; i < events.length; i++) {
    if (events[i].isAllDayEvent()) {
      var dateKey = Utilities.formatDate(events[i].getStartTime(), 'Asia/Tokyo', 'yyyy/MM/dd');
      set[dateKey] = true;
    }
  }
  return set;
}

// バッファ込みの重複判定
// 枠の前後に既存予定があると以下をブロック:
//   既存予定 [evStart, evEnd] に対して
//   スロット候補 [slotStart, slotEnd] が [evStart - BUFFER_BEFORE, evEnd + BUFFER_AFTER] と被る
function hasConflictWithBuffer(events, slotStart, slotEnd) {
  var bufBefore = BUFFER_BEFORE_MIN * 60 * 1000;
  var bufAfter  = BUFFER_AFTER_MIN  * 60 * 1000;
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.isAllDayEvent()) continue;
    var evStart = new Date(ev.getStartTime().getTime() - bufBefore);
    var evEnd   = new Date(ev.getEndTime().getTime()   + bufAfter);
    if (evStart < slotEnd && evEnd > slotStart) return true;
  }
  return false;
}

function formatSlot(start, end) {
  var DAYS = ['日','月','火','水','木','金','土'];
  var dow = DAYS[start.getDay()];
  var dateStr  = Utilities.formatDate(start, 'Asia/Tokyo', 'M/d');
  var startStr = Utilities.formatDate(start, 'Asia/Tokyo', 'HH:mm');
  var endStr   = Utilities.formatDate(end,   'Asia/Tokyo', 'HH:mm');
  return dateStr + '(' + dow + ') ' + startStr + '〜' + endStr;
}

// ---- カレンダー予定登録（アポ承認後） ----
// slotText 形式: "5/24(土) 19:00〜20:30"
function createCalendarEvent(slotText) {
  var match = slotText.match(/(\d+)\/(\d+)[^)]*\)\s*(\d+):(\d+)〜(\d+):(\d+)/);
  if (!match) return { success: false, error: 'date_parse_failed' };

  var now   = new Date();
  var month = parseInt(match[1], 10) - 1; // 0-indexed
  var day   = parseInt(match[2], 10);
  var startH = parseInt(match[3], 10);
  var startM = parseInt(match[4], 10);
  var endH   = parseInt(match[5], 10);
  var endM   = parseInt(match[6], 10);

  // 年またぎ対応（過去日付なら翌年）
  var year = now.getFullYear();
  if (month < now.getMonth() || (month === now.getMonth() && day < now.getDate())) year++;

  var start = new Date(year, month, day, startH, startM, 0);
  var end   = new Date(year, month, day, endH,   endM,   0);

  var calendar = CalendarApp.getDefaultCalendar();
  var event    = calendar.createEvent('食事予定', start, end);

  logCalendarCreation(slotText);
  return { success: true, eventId: event.getId() };
}

function logCalendarCreation(slotText) {
  var sheet = getOrCreateSheet('calendar_slots_log',
    ['日時','取得件数','最初の候補','最後の候補'], '#16a085');
  sheet.appendRow([jstNow(), '登録', slotText, '']);
}

function logCalendarSlots(slots) {
  var sheet = getOrCreateSheet('calendar_slots_log',
    ['日時','取得件数','最初の候補','最後の候補'], '#16a085');
  sheet.appendRow([
    jstNow(),
    slots.length,
    slots[0] || '',
    slots[slots.length - 1] || '',
  ]);
}
