// ============================================================
// Telegram Bot 通知 + コールバック処理
// ============================================================

// ---- セットアップ用（初回のみ実行） ----

function getChatId() {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) { Logger.log('TELEGRAM_BOT_TOKEN が未設定です'); return; }
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates');
  var data = JSON.parse(res.getContentText());
  if (data.result && data.result.length > 0) {
    Logger.log('TELEGRAM_CHAT_ID: ' + data.result[0].message.chat.id);
  } else {
    Logger.log('メッセージが見つかりません。先にBotにメッセージを送ってください。');
    Logger.log(res.getContentText());
  }
}

function registerWebhook() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_BOT_TOKEN');
  var gasToken = props.getProperty('GAS_TOKEN');
  if (!token) { Logger.log('TELEGRAM_BOT_TOKEN が未設定です'); return; }
  var webhookUrl = 'https://script.google.com/macros/s/AKfycbz3DBVtcWI3MmpiElTmZdsIjPKcjrCMVr09JEvaOZjE5Og9HQlEqNhO5dmFJYMB33Sy/exec?route=telegram-webhook&token=' + gasToken;
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify({ url: webhookUrl }),
  });
  Logger.log(res.getContentText());
}

// ---- ここまでセットアップ用 ----

function getTelegramProps() {
  var props = PropertiesService.getScriptProperties();
  return {
    token:  props.getProperty('TELEGRAM_BOT_TOKEN'),
    chatId: props.getProperty('TELEGRAM_CHAT_ID'),
  };
}

function telegramPost(method, payload) {
  var p = getTelegramProps();
  if (!p.token) return null;
  var url = 'https://api.telegram.org/bot' + p.token + '/' + method;
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  var res = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(res.getContentText());
  return data.ok ? data.result : null;
}

// ---- HMAC-SHA256 署名（改ざん防止） ----
// msg = "approve:aq_xxx:1" or "reject:aq_xxx"
// 先頭16文字を使用

function signCallbackData(msg) {
  var p = getTelegramProps();
  if (!p.token) return '';
  var sig = Utilities.computeHmacSha256Signature(msg, p.token);
  // バイト列を16進数文字列に変換
  var hex = sig.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
  return hex.substring(0, 16);
}

function verifyCallbackData(msg, sig) {
  return signCallbackData(msg) === sig;
}

// ---- 承認リクエスト送信 ----

function sendTelegramApprovalRequest(itemId, body) {
  var p = getTelegramProps();
  if (!p.chatId) return null;

  var typeLabel = body.type === 'apo' ? '📅 アポ打診承認' : '📬 返信候補承認';
  var slotsSection = '';
  if (body.calendarSlots && body.calendarSlots.length > 0) {
    slotsSection = '\n\n📆 空き日程候補:\n' +
      body.calendarSlots.map(function(s){ return '• ' + s; }).join('\n');
  }

  var text = typeLabel + '\n' +
    '相手: ' + (body.opponentSummary || '不明') + '\n' +
    'パターン: ' + (body.patternName || body.patternId || '不明') +
    slotsSection + '\n\n' +
    '─────────────────\n' +
    '💬 候補1:\n' + (body.candidate1 || '（なし）') + '\n\n' +
    '💬 候補2:\n' + (body.candidate2 || '（なし）') + '\n\n' +
    '💬 候補3:\n' + (body.candidate3 || '（なし）');

  // 署名付きcallback_data
  var baseApprove1 = 'approve:' + itemId + ':1';
  var baseApprove2 = 'approve:' + itemId + ':2';
  var baseApprove3 = 'approve:' + itemId + ':3';
  var baseEdit1    = 'edit:'    + itemId + ':1';
  var baseEdit2    = 'edit:'    + itemId + ':2';
  var baseEdit3    = 'edit:'    + itemId + ':3';
  var baseReject   = 'reject:'  + itemId;

  var inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✓ 候補1', callback_data: baseApprove1 + ':' + signCallbackData(baseApprove1) },
        { text: '✓ 候補2', callback_data: baseApprove2 + ':' + signCallbackData(baseApprove2) },
        { text: '✓ 候補3', callback_data: baseApprove3 + ':' + signCallbackData(baseApprove3) },
      ],
      [
        { text: '✏️ 候補1を編集', callback_data: baseEdit1 + ':' + signCallbackData(baseEdit1) },
        { text: '✏️ 候補2を編集', callback_data: baseEdit2 + ':' + signCallbackData(baseEdit2) },
        { text: '✏️ 候補3を編集', callback_data: baseEdit3 + ':' + signCallbackData(baseEdit3) },
      ],
      [{ text: '✗ すべて却下', callback_data: baseReject + ':' + signCallbackData(baseReject) }],
    ],
  };

  var result = telegramPost('sendMessage', {
    chat_id: p.chatId,
    text: text,
    reply_markup: inlineKeyboard,
    parse_mode: 'HTML',
  });

  return result ? result.message_id : null;
}

// ---- コールバック処理（ボタンタップ） ----

function handleTelegramWebhook(body) {
  // updateApprovalItem が自前でロックを取るため、ここでは不要（再入デッドロック防止）
  var cbq = body.callback_query;
  try {
    // テキストメッセージ → コマンド or 編集モード返信
    if (!cbq && body.message && body.message.text) {
      var msgText = body.message.text.trim();
      if (msgText === '/like_start' || msgText === '/start_like') {
        addPendingAction('startLike');
        var p0 = getTelegramProps();
        telegramPost('sendMessage', { chat_id: p0.chatId, text: '▶️ いいねを開始します（PCの拡張が処理します）' });
        return { ok: true };
      }
      if (msgText === '/like_stop' || msgText === '/stop_like') {
        addPendingAction('stopLike');
        var p0b = getTelegramProps();
        telegramPost('sendMessage', { chat_id: p0b.chatId, text: '⏹ いいねを停止します' });
        return { ok: true };
      }
      return handleEditReply(body.message);
    }

    if (!cbq) return { ok: true };

    var data   = cbq.data || '';
    var msgId  = cbq.message ? cbq.message.message_id : null;
    var chatId = cbq.message ? cbq.message.chat.id    : null;
    var cbqId  = cbq.id;

    // 形式: "approve:aq_xxx:1:sig" or "reject:aq_xxx:sig" or "edit:aq_xxx:1:sig"
    var parts  = data.split(':');
    var action = parts[0];

    if (action === 'select_first') {
      // parts = ['select_first', id, 'sig']  ※idはchatPathの末尾数字のみ
      var sfId   = parts[1] || '';
      var sfSig  = parts[2] || '';
      var sfBase = 'select_first:' + sfId;

      if (!verifyCallbackData(sfBase, sfSig)) {
        answerCallbackQuery(cbqId, '署名エラー');
        return { ok: true };
      }

      var sfPath = '/friend/chat/' + sfId;
      var cache  = CacheService.getScriptCache();
      var sfName = cache.get('match_name_' + sfId) || '';

      addPendingFirst({ chatPath: sfPath, name: sfName });
      answerCallbackQuery(cbqId, '✓ キューに追加しました');
      return { ok: true };

    } else if (action === 'edit') {
      // parts = ['edit', 'aq_xxx', '1', 'sig16chars']
      var editItemId  = parts[1];
      var editCandNo  = parseInt(parts[2], 10);
      var editSig     = parts[3] || '';
      var editBase    = 'edit:' + editItemId + ':' + editCandNo;

      if (!verifyCallbackData(editBase, editSig)) {
        answerCallbackQuery(cbqId, '署名エラー: 不正なリクエストです');
        return { ok: true };
      }

      var editItem = getApprovalItemById(editItemId);
      if (!editItem) {
        answerCallbackQuery(cbqId, 'エラー: アイテムが見つかりません');
        return { ok: true };
      }
      if (editItem['status'] !== 'pending') {
        answerCallbackQuery(cbqId, 'すでに処理済みです');
        return { ok: true };
      }

      setEditingState(editItemId, cbq.from.id, editCandNo);
      var origText = editItem['candidate_' + editCandNo] || '';
      answerCallbackQuery(cbqId, '');
      var p = getTelegramProps();
      telegramPost('sendMessage', {
        chat_id: p.chatId,
        text: '✏️ 候補' + editCandNo + 'を編集中\n\n元のテキスト:\n「' + origText + '」\n\n送信したいテキストをそのまま返信してください（5分以内）',
      });
      return { ok: true };

    } else if (action === 'approve') {
      // parts = ['approve', 'aq_xxx', '1', 'sig16chars']
      var itemId       = parts[1];
      var candidateIdx = parseInt(parts[2], 10);
      var sig          = parts[3] || '';
      var msgBase      = 'approve:' + itemId + ':' + candidateIdx;

      if (!verifyCallbackData(msgBase, sig)) {
        answerCallbackQuery(cbqId, '署名エラー: 不正なリクエストです');
        return { ok: true };
      }

      var queueItem = getApprovalItemById(itemId);
      if (!queueItem) {
        answerCallbackQuery(cbqId, 'エラー: アイテムが見つかりません');
        return { ok: true };
      }
      var chosen = queueItem['candidate_' + candidateIdx] || '';
      var result = updateApprovalItem({
        id: itemId,
        status: 'approved',
        chosenCandidate: chosen,
        chosenCandidateNo: candidateIdx,
      });

      if (result.error === 'already_processed') {
        answerCallbackQuery(cbqId, 'すでに処理済みです');
        return { ok: true };
      }

      if (msgId && chatId) {
        editTelegramMessage(chatId, msgId,
          '✓ 候補' + candidateIdx + 'で承認しました\n\n「' + chosen + '」');
      }
      answerCallbackQuery(cbqId, '候補' + candidateIdx + 'を承認しました');

      // アポ承認の場合はカレンダーに自動登録
      if (queueItem['type'] === 'apo' && chosen && result.success) {
        try {
          var calResult = createCalendarEvent(chosen);
          if (calResult.success) {
            var p2 = getTelegramProps();
            telegramPost('sendMessage', {
              chat_id: p2.chatId,
              text: '📅 Googleカレンダーに「食事予定」を登録しました',
            });
          }
        } catch (calErr) {
          Logger.log('カレンダー登録エラー: ' + calErr.message);
        }
      }

    } else if (action === 'reject') {
      // parts = ['reject', 'aq_xxx', 'sig16chars']
      var rejectItemId = parts[1];
      var rejectSig    = parts[2] || '';
      var rejectBase   = 'reject:' + rejectItemId;

      if (!verifyCallbackData(rejectBase, rejectSig)) {
        answerCallbackQuery(cbqId, '署名エラー: 不正なリクエストです');
        return { ok: true };
      }

      var rejectResult = updateApprovalItem({ id: rejectItemId, status: 'rejected' });

      if (rejectResult.error === 'already_processed') {
        answerCallbackQuery(cbqId, 'すでに処理済みです');
        return { ok: true };
      }

      if (msgId && chatId) {
        editTelegramMessage(chatId, msgId, '✗ 却下しました');
      }
      answerCallbackQuery(cbqId, '却下しました');
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function handleEditReply(msg) {
  var userId = msg.from ? msg.from.id : null;
  if (!userId) return { ok: true };

  var item = getEditingItem(userId);
  if (!item) return { ok: true }; // 編集中アイテムなし → 無視

  var finalText    = msg.text.trim();
  var itemId       = item['id'];
  var candidateNo  = item._candidateNo;
  var originalText = item['candidate_' + candidateNo] || '';

  // approval_queue を approved に更新 + editing クリア
  updateApprovalItem({
    id: itemId,
    status: 'approved',
    chosenCandidate: finalText,
    chosenCandidateNo: candidateNo,
  });
  clearEditingState(itemId);

  // Knowledge に保存
  saveKnowledge({
    patternId:           item['pattern_id'] || '',
    opponentName:        item['opponent_summary'] || '',
    originalCandidateNo: candidateNo,
    originalText:        originalText,
    finalText:           finalText,
    edited:              (finalText !== originalText),
  });

  var p = getTelegramProps();
  telegramPost('sendMessage', {
    chat_id: p.chatId,
    text: '✓ 編集内容で承認しました\n\n「' + finalText + '」',
  });

  return { ok: true };
}

function getApprovalItemById(id) {
  var sheet = SS.getSheetByName('approval_queue');
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      var obj = {};
      headers.forEach(function(h, idx){ obj[h] = data[i][idx]; });
      return obj;
    }
  }
  return null;
}

function editTelegramMessage(chatId, messageId, newText) {
  telegramPost('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: newText,
  });
}

function answerCallbackQuery(callbackQueryId, text) {
  telegramPost('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text,
    show_alert: false,
  });
}

// ---- デイリーレポート ----

function sendDailyReport() {
  var p = getTelegramProps();
  if (!p.chatId) return { success: false, error: 'TELEGRAM_CHAT_ID not set' };

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('daily_log');

  var totals = { like: 0, match: 0, replyGen: 0, replyApv: 0, apoGen: 0, apoApv: 0 };

  if (sheet) {
    var data = sheet.getDataRange().getValues();
    data.slice(1).forEach(function(r) {
      if (r[0] !== today) return;
      totals.like     += r[2]  || 0;
      totals.match    += r[3]  || 0;
      totals.replyGen += r[4]  || 0;
      totals.replyApv += r[5]  || 0;
      totals.apoGen   += r[7]  || 0;
      totals.apoApv   += r[8]  || 0;
    });
  }

  var matchRate = totals.like  > 0 ? Math.round(totals.match    / totals.like  * 100) : '-';
  var apoRate   = totals.match > 0 ? Math.round(totals.apoApv   / totals.match * 100) : '-';

  var text = '📊 ' + today + ' デイリーレポート\n' +
    '─────────────────\n' +
    '❤️  いいね:     ' + totals.like    + ' 件\n' +
    '🤝 マッチ:     ' + totals.match   + ' 件  (マッチ率: ' + matchRate + '%)\n' +
    '💬 返信生成:   ' + totals.replyGen + ' 件\n' +
    '✅ 返信承認:   ' + totals.replyApv + ' 件\n' +
    '📅 アポ生成:   ' + totals.apoGen   + ' 件\n' +
    '✅ アポ承認:   ' + totals.apoApv   + ' 件\n' +
    '─────────────────\n' +
    '🎯 最終アポ率: ' + apoRate + '%';

  telegramPost('sendMessage', { chat_id: p.chatId, text: text });
  return { success: true };
}

// GASエディタから手動実行してトリガーを登録する（毎日22時）
function setupDailyReportTrigger() {
  // 既存の同名トリガーを削除してから登録
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReport')
    .timeBased().atHour(22).everyDays(1).create();
  Logger.log('デイリーレポートトリガーを設定しました（毎日22時）');
}

// ---- テスト用（Apps Scriptエディタから直接実行） ----

function testSendTelegram() {
  var result = sendTelegramApprovalRequest('aq_test_001', {
    type: 'reply',
    opponentSummary: '29歳・IT系・都内在住 / 14往復目',
    patternName: 'テストパターン',
    candidate1: 'そうなんだ、どんな仕事してるの？',
    candidate2: 'ITか、最近面白いことある？',
    candidate3: 'へぇ、フリーランス？',
  });
  Logger.log('Telegram message_id: ' + result);
}

function testHmacSign() {
  var msg = 'approve:aq_test_001:1';
  var sig = signCallbackData(msg);
  Logger.log('署名: ' + sig);
  Logger.log('検証: ' + verifyCallbackData(msg, sig));
}

// ---- マッチリスト送信（Phase 4） ----

function sendMatchListToTelegram(matches) {
  var p = getTelegramProps();
  if (!p.chatId || !matches || matches.length === 0) return { success: false };

  // Telegramのcallback_data上限は64バイト。
  // IDのみをcallback_dataに入れ、名前はCacheServiceに保存（10分TTL）。
  var cache = CacheService.getScriptCache();
  matches.forEach(function(m) {
    var id = (m.chatPath || '').replace(/.*\//, '');
    if (id) cache.put('match_name_' + id, m.name || '', 600);
  });

  var PAGE_SIZE = 8;
  var pages = Math.ceil(matches.length / PAGE_SIZE);

  for (var page = 0; page < pages; page++) {
    var slice = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    var text = '🤝 新着マッチ ' + matches.length + '件' +
      (pages > 1 ? ' (' + (page + 1) + '/' + pages + 'ページ)' : '') + '\n初回送信する相手を選択:';

    var keyboard = slice.map(function(m) {
      var id = (m.chatPath || '').replace(/.*\//, '');
      var base = 'select_first:' + id;
      // 合計: 13 + ~8 + 1 + 16 = ~38バイト < 64バイト上限
      return [{ text: m.name || m.chatPath, callback_data: base + ':' + signCallbackData(base) }];
    });
    keyboard.push([{ text: '✗ キャンセル', callback_data: 'cancel_match:' + signCallbackData('cancel_match') }]);

    telegramPost('sendMessage', {
      chat_id: p.chatId,
      text: text,
      reply_markup: { inline_keyboard: keyboard },
    });
  }
  return { success: true };
}
