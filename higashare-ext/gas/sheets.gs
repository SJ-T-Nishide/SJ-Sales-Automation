// ============================================================
// シートCRUD
// ============================================================

var SS = SpreadsheetApp.getActiveSpreadsheet();

// ---- シート取得 or 作成 ----

function getOrCreateSheet(name, headers, headerColor) {
  var sheet = SS.getSheetByName(name);
  if (!sheet) {
    sheet = SS.insertSheet(name);
    sheet.appendRow(headers);
    var hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setFontWeight('bold')
          .setBackground(headerColor || '#2c3e50')
          .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ---- event_log ----

// ロックを取得済みの呼び出し元から使う内部関数（再入デッドロック防止）
function _writeLogInner(body) {
  var sheet = getOrCreateSheet('event_log',
    ['日時','イベント種別','件数','パターンID','メモ'], '#34495e');
  sheet.appendRow([
    jstNow(),
    body.eventType || '',
    body.count != null ? body.count : 1,
    body.patternId || '',
    body.memo || '',
  ]);
  writeDailyLog(body.eventType, body.patternId, body.count || 1);
}

function writeLog(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: 'lock_timeout' };
  try {
    _writeLogInner(body);
    return { success: true };
  } finally { lock.releaseLock(); }
}

function writeDailyLog(eventType, patternId, count) {
  var sheet = getOrCreateSheet('daily_log',
    ['日付','パターンID',
     'auto_like','match','reply_generated','reply_approved','reply_rejected',
     'apo_generated','apo_approved','apo_rejected','apo_confirmed',
     'calendar_created','real_apo','cancelled'], '#27ae60');

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  var data = sheet.getDataRange().getValues();
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === today && data[i][1] === patternId) { rowIdx = i + 1; break; }
  }

  var COLS = {
    auto_like:3, match:4, reply_generated:5, reply_approved:6, reply_rejected:7,
    apo_generated:8, apo_approved:9, apo_rejected:10, apo_confirmed:11,
    calendar_created:12, real_apo:13, cancelled:14,
  };
  var col = COLS[eventType];
  if (!col) return;

  if (rowIdx === -1) {
    var newRow = [today, patternId, 0,0,0,0,0,0,0,0,0,0,0,0];
    newRow[col - 1] = count;
    sheet.appendRow(newRow);
  } else {
    var cell = sheet.getRange(rowIdx, col);
    cell.setValue((cell.getValue() || 0) + count);
  }
}

// ---- approval_queue ----

var AQ_HEADERS = [
  'id','created_at','updated_at','type','status',
  'conversation_id','pattern_id','opponent_summary',
  'candidate_1','candidate_2','candidate_3','chosen_candidate',
  'chosen_candidate_no','calendar_slots','telegram_message_id',
  'executed_at','error_message','execution_result',
  'target_path_hash','last_polled_at','retry_count',
  'editing_user_id','editing_candidate_no','editing_started_at'
];

function addApprovalItem(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: 'lock_timeout' };
  try {
    var sheet = getOrCreateSheet('approval_queue', AQ_HEADERS, '#8e44ad');
    var id = 'aq_' + new Date().getTime();
    var now = jstNow();
    sheet.appendRow([
      id, now, now,
      body.type || 'reply',
      'pending',
      body.conversationId || '',
      body.patternId || '',
      body.opponentSummary || '',
      body.candidate1 || '',
      body.candidate2 || '',
      body.candidate3 || '',
      '',  // chosen_candidate (col 12)
      '',  // chosen_candidate_no (col 13)
      body.calendarSlots ? JSON.stringify(body.calendarSlots) : '', // col 14
      '',  // telegram_message_id (col 15)
      '',  // executed_at (col 16)
      '',  // error_message (col 17)
      '',  // execution_result (col 18)
      body.targetPathHash || '', // col 19
      '',  // last_polled_at (col 20)
      0,   // retry_count (col 21)
      '',  // editing_user_id (col 22)
      '',  // editing_candidate_no (col 23)
      '',  // editing_started_at (col 24)
    ]);

    // Telegram通知
    var msgId = sendTelegramApprovalRequest(id, body);
    if (msgId) {
      var lastRow = sheet.getLastRow();
      var tmCol = AQ_HEADERS.indexOf('telegram_message_id') + 1;
      sheet.getRange(lastRow, tmCol).setValue(msgId);
    }

    _writeLogInner({ eventType: body.type === 'apo' ? 'apo_generated' : 'reply_generated', patternId: body.patternId });
    return { success: true, id: id };
  } finally { lock.releaseLock(); }
}

function updateApprovalItem(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: 'lock_timeout' };
  try {
    var sheet = SS.getSheetByName('approval_queue');
    if (!sheet) return { success: false, error: 'sheet not found' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === body.id) {
        var row = i + 1;
        // 二重処理防止
        var currentStatus = data[i][4];
        if (currentStatus !== 'pending' && body.status !== 'executed') {
          return { success: false, error: 'already_processed', status: currentStatus };
        }
        var col = function(name) { return AQ_HEADERS.indexOf(name) + 1; };
        sheet.getRange(row, col('updated_at')).setValue(jstNow());
        sheet.getRange(row, col('status')).setValue(body.status);
        if (body.chosenCandidate)
          sheet.getRange(row, col('chosen_candidate')).setValue(body.chosenCandidate);
        if (body.chosenCandidateNo)
          sheet.getRange(row, col('chosen_candidate_no')).setValue(body.chosenCandidateNo);
        if (body.status === 'executed') {
          sheet.getRange(row, col('executed_at')).setValue(jstNow());
          sheet.getRange(row, col('execution_result')).setValue(body.executionResult || 'success');
        }
        if (body.errorMessage)
          sheet.getRange(row, col('error_message')).setValue(body.errorMessage);
        sheet.getRange(row, col('last_polled_at')).setValue(jstNow());

        // イベントログ
        var patternId = data[i][6];
        var type = data[i][3];
        var evtMap = {
          approved: type === 'apo' ? 'apo_approved' : 'reply_approved',
          rejected: type === 'apo' ? 'apo_rejected' : 'reply_rejected',
        };
        if (evtMap[body.status]) _writeLogInner({ eventType: evtMap[body.status], patternId: patternId });

        return { success: true };
      }
    }
    return { success: false, error: 'not found' };
  } finally { lock.releaseLock(); }
}

function getApprovalItems(status) {
  var sheet = SS.getSheetByName('approval_queue');
  if (!sheet) return { data: [] };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = data.slice(1)
    .filter(function(r) { return !status || r[4] === status; })
    .map(function(r) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = r[i]; });
      return obj;
    });
  return { data: rows };
}

// ---- 編集状態管理（approval_queue の editing_* 列） ----

function setEditingState(itemId, userId, candidateNo) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: 'lock_timeout' };
  try {
    var sheet = SS.getSheetByName('approval_queue');
    if (!sheet) return { success: false, error: 'sheet not found' };
    var data = sheet.getDataRange().getValues();
    var col = function(name) { return AQ_HEADERS.indexOf(name) + 1; };
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === itemId) {
        var row = i + 1;
        sheet.getRange(row, col('editing_user_id')).setValue(String(userId));
        sheet.getRange(row, col('editing_candidate_no')).setValue(candidateNo);
        sheet.getRange(row, col('editing_started_at')).setValue(jstNow());
        return { success: true };
      }
    }
    return { success: false, error: 'not found' };
  } finally { lock.releaseLock(); }
}

function getEditingItem(userId) {
  var sheet = SS.getSheetByName('approval_queue');
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var uidIdx = AQ_HEADERS.indexOf('editing_user_id');
  var noIdx  = AQ_HEADERS.indexOf('editing_candidate_no');
  var tsIdx  = AQ_HEADERS.indexOf('editing_started_at');
  var TIMEOUT_MS = 5 * 60 * 1000; // 5分

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][uidIdx]) !== String(userId)) continue;
    var startedAt = data[i][tsIdx];
    if (!startedAt) continue;
    var startedDate = new Date(startedAt.toString().replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3'));
    if (Date.now() - startedDate.getTime() > TIMEOUT_MS) continue;
    var obj = {};
    headers.forEach(function(h, idx){ obj[h] = data[i][idx]; });
    obj._rowIndex = i + 1;
    obj._candidateNo = parseInt(data[i][noIdx], 10) || 1;
    return obj;
  }
  return null;
}

function clearEditingState(itemId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var sheet = SS.getSheetByName('approval_queue');
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var col = function(name) { return AQ_HEADERS.indexOf(name) + 1; };
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === itemId) {
        var row = i + 1;
        sheet.getRange(row, col('editing_user_id')).setValue('');
        sheet.getRange(row, col('editing_candidate_no')).setValue('');
        sheet.getRange(row, col('editing_started_at')).setValue('');
        return;
      }
    }
  } finally { lock.releaseLock(); }
}

// ---- knowledge シート（送信履歴ナレッジ） ----

var KN_HEADERS = [
  'timestamp','pattern_id','opponent_name',
  'original_candidate_no','original_text','final_text','edited'
];

function saveKnowledge(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: 'lock_timeout' };
  try {
    var sheet = getOrCreateSheet('knowledge', KN_HEADERS, '#2980b9');
    sheet.appendRow([
      jstNow(),
      body.patternId       || '',
      body.opponentName    || '',
      body.originalCandidateNo || '',
      body.originalText    || '',
      body.finalText       || '',
      body.edited ? true : false,
    ]);
    return { success: true };
  } finally { lock.releaseLock(); }
}

// ---- analysis_history ----

function saveAnalysis(body) {
  var sheet = getOrCreateSheet('analysis_history',
    ['分析日時','対象期間','分析内容'], '#c0392b');
  sheet.appendRow([jstNow(), body.period || '全期間', body.analysis || '']);
  return { success: true };
}

function getAnalysisHistory() {
  var sheet = SS.getSheetByName('analysis_history');
  if (!sheet) return { data: [] };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  return { data: data.slice(1).map(function(r) {
    var obj = {}; headers.forEach(function(h,i){ obj[h]=r[i]; }); return obj;
  })};
}

// ---- logs ----

function getLogs() {
  var sheet = SS.getSheetByName('daily_log');
  if (!sheet) return { data: [] };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  return { data: data.slice(1).map(function(r) {
    var obj = {}; headers.forEach(function(h,i){ obj[h]=r[i]; }); return obj;
  })};
}

// ---- error_log ----

function writeErrorLog(source, functionName, errorCode, errorMessage, contextHash) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    var sheet = getOrCreateSheet('error_log',
      ['timestamp','source','function_name','error_code','error_message','context_hash','resolved'],
      '#e74c3c');
    sheet.appendRow([jstNow(), source || '', functionName || '', errorCode || '', errorMessage || '', contextHash || '', false]);
  } finally { lock.releaseLock(); }
}

// ---- profile_log ----

var PL_HEADERS = [
  'profile_id','変更日','写真1','写真2','写真3','写真4','写真5',
  'メイン写真番号','プロフィール文','備考'
];

function addProfileVersion(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: 'lock_timeout' };
  try {
    var sheet = getOrCreateSheet('profile_log', PL_HEADERS, '#1a5276');
    var id = 'prof_' + new Date().getTime();
    sheet.appendRow([
      id,
      body.changedAt || jstNow(),
      body.photo1 || '', body.photo2 || '', body.photo3 || '',
      body.photo4 || '', body.photo5 || '',
      body.mainPhotoNo || 1,
      body.bio || '',
      body.memo || '',
    ]);
    return { success: true, id: id };
  } finally { lock.releaseLock(); }
}

function getProfileLog() {
  var sheet = SS.getSheetByName('profile_log');
  if (!sheet) return { data: [] };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  return { data: data.slice(1).map(function(r) {
    var obj = {}; headers.forEach(function(h,i){ obj[h]=r[i]; }); return obj;
  })};
}

// 指定日時点でアクティブなプロフィールを返す（変更日昇順で直近のもの）
function getActiveProfile(dateStr) {
  var result = getProfileLog();
  var rows = result.data.filter(function(r) { return r['変更日'] <= (dateStr || '9999'); });
  if (rows.length === 0) return null;
  return rows[rows.length - 1];
}

// ---- pending_actions（Telegramからのいいね開始/停止コマンド） ----

var PA_HEADERS = ['id','created_at','action','consumed'];

function addPendingAction(action) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: 'lock_timeout' };
  try {
    var sheet = getOrCreateSheet('pending_actions', PA_HEADERS, '#e67e22');
    var id = 'pa_' + new Date().getTime();
    sheet.appendRow([id, jstNow(), action, false]);
    return { success: true, id: id };
  } finally { lock.releaseLock(); }
}

function getPendingActions() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { data: [] };
  try {
    var sheet = SS.getSheetByName('pending_actions');
    if (!sheet) return { data: [] };
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var consumedIdx = headers.indexOf('consumed');
    var actionIdx = headers.indexOf('action');
    var idIdx = headers.indexOf('id');
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][consumedIdx]) {
        results.push({ id: data[i][idIdx], action: data[i][actionIdx] });
        sheet.getRange(i + 1, consumedIdx + 1).setValue(true);
      }
    }
    return { data: results };
  } finally { lock.releaseLock(); }
}

// ---- pending_first（Telegramから選ばれたマッチ選別キュー） ----

var PF_HEADERS = ['id','created_at','chat_path','name','consumed'];

function addPendingFirst(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: 'lock_timeout' };
  try {
    var sheet = getOrCreateSheet('pending_first', PF_HEADERS, '#1abc9c');
    var id = 'pf_' + new Date().getTime();
    sheet.appendRow([id, jstNow(), body.chatPath || '', body.name || '', false]);
    return { success: true, id: id };
  } finally { lock.releaseLock(); }
}

function getPendingFirst() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { data: [] };
  try {
    var sheet = SS.getSheetByName('pending_first');
    if (!sheet) return { data: [] };
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var consumedIdx = headers.indexOf('consumed');
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][consumedIdx]) {
        var obj = {};
        headers.forEach(function(h, idx){ obj[h] = data[i][idx]; });
        results.push(obj);
        sheet.getRange(i + 1, consumedIdx + 1).setValue(true);
      }
    }
    return { data: results };
  } finally { lock.releaseLock(); }
}

// ---- 初期シート作成（手動実行用） ----

function initAllSheets() {
  getOrCreateSheet('pattern_master',
    ['パターンID','パターン名','ペルソナ','スタイル','エリア','曜日','時間帯','場所','アポ閾値往復数'],
    '#2c3e50');
  getOrCreateSheet('settings',
    ['キー','値','備考'], '#7f8c8d');
  getOrCreateSheet('calendar_slots_log',
    ['日時','取得件数','最初の候補','最後の候補'], '#16a085');
  getOrCreateSheet('event_log',   ['日時','イベント種別','件数','パターンID','メモ'], '#34495e');
  getOrCreateSheet('daily_log',
    ['日付','パターンID','auto_like','match','reply_generated','reply_approved','reply_rejected',
     'apo_generated','apo_approved','apo_rejected','apo_confirmed',
     'calendar_created','real_apo','cancelled'], '#27ae60');
  getOrCreateSheet('profile_log', PL_HEADERS, '#1a5276');
  getOrCreateSheet('analysis_history', ['分析日時','対象期間','分析内容'], '#c0392b');
  getOrCreateSheet('approval_queue', AQ_HEADERS, '#8e44ad');
  getOrCreateSheet('error_log',
    ['timestamp','source','function_name','error_code','error_message','context_hash','resolved'],
    '#e74c3c');
  getOrCreateSheet('knowledge', KN_HEADERS, '#2980b9');
  getOrCreateSheet('pending_actions', PA_HEADERS, '#e67e22');
  getOrCreateSheet('pending_first', PF_HEADERS, '#1abc9c');
  Logger.log('全シート初期化完了（12シート）');
}
