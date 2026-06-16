// ============================================================
// Claude API プロキシ
// APIキーは Script Properties > CLAUDE_API_KEY に保存
// ============================================================

function generateCandidates(body) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) return { success: false, error: 'CLAUDE_API_KEY not set in Script Properties' };

  var mode = body.mode || 'reply'; // 'reply', 'apo', 'first'
  var conversationSummary = body.conversationSummary || '';
  var pattern = body.pattern || {};
  var calendarSlots = body.calendarSlots || [];
  var opponentProfile = body.opponentProfile || '';

  // auto モード: 自動送信用（1候補のみ生成）
  if (mode === 'auto') {
    var stagePrompt = body.stagePrompt || '自然なメッセージを送ってください';
    var hasSplit = stagePrompt.indexOf('[SPLIT]') !== -1;
    var autoSystem = 'あなたは東カレデートで相手（女性）にアプローチする男性ユーザーです。\n' +
      (pattern.persona ? 'ペルソナ: ' + pattern.persona + '\n' : '') +
      '話し方: ' + (pattern.style || 'タメ口') + '\n\n' +
      '会話履歴の「自分」はあなた自身の発言です。「相手」がアプローチ先の女性です。\n' +
      'あなたから女性へのメッセージ本文のみ出力。前置き・説明・括弧書き一切不要。\n' +
      (hasSplit ? '指示に [SPLIT] が含まれる場合、その文字列をそのまま出力に含めること。削除・省略禁止。' : '');
    var autoCtx = '';
    if (opponentProfile)      autoCtx += '【相手のプロフィール】\n' + opponentProfile + '\n\n';
    if (conversationSummary)  autoCtx += '【会話履歴】\n' + conversationSummary + '\n\n';
    var autoUser = autoCtx + '【指示】\n' + stagePrompt;
    var single = callClaudeOnce(apiKey, autoSystem, autoUser, hasSplit ? 600 : 300);
    return { success: true, candidates: [single] };
  }

  var systemPrompt = mode === 'first'
    ? buildFirstMessageSystemPrompt(pattern)
    : buildSystemPrompt(pattern);
  var userPrompt  = mode === 'apo'
    ? buildApoPrompt(conversationSummary, calendarSlots, pattern)
    : mode === 'first'
      ? buildFirstMessagePrompt(opponentProfile, body.firstMsgPrompt)
      : buildReplyPrompt(conversationSummary);

  var candidates = [];
  for (var i = 0; i < 3; i++) {
    var result = callClaudeOnce(apiKey, systemPrompt, userPrompt + '\n\n（バリエーション ' + (i+1) + '/3。前の候補とは違うアプローチで）');
    candidates.push(result);
  }

  return { success: true, candidates: candidates };
}

function callClaudeOnce(apiKey, systemPrompt, userPrompt, maxTokens) {
  var payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  var data = JSON.parse(response.getContentText());
  if (data.error) throw new Error(data.error.message);
  if (!data.content || data.content.length === 0) throw new Error('APIレスポンスにcontentがありません');
  return data.content[0].text.trim();
}

function buildFirstMessageSystemPrompt(pattern) {
  return 'あなたは東カレデートでメッセージを送っています。\n' +
    'ペルソナ: ' + (pattern.persona || '未設定') + '\n' +
    '話し方: ' + (pattern.style || 'タメ口') + '\n\n' +
    'メッセージ本文のみ出力。前置き・説明・括弧書き一切不要。';
}

function buildSystemPrompt(pattern) {
  return 'あなたは日本のマッチングアプリでメッセージを送っています。\n' +
    'ペルソナ: ' + (pattern.persona || '未設定') + '\n' +
    '話し方: ' + (pattern.style || 'タメ口、短文') + '\n\n' +
    'ルール:\n' +
    '- 返信は1〜3文以内\n' +
    '- 質問は1つまで\n' +
    '- 返信文のみ出力（前置き・説明不要）';
}

function buildReplyPrompt(conversationSummary) {
  return '以下の会話の最後のメッセージに自然に返信してください:\n\n' + conversationSummary;
}

function buildApoPrompt(conversationSummary, calendarSlots, pattern) {
  var slotsText = calendarSlots.length > 0
    ? '提案できる空き日程:\n' + calendarSlots.map(function(s){ return '• ' + s; }).join('\n')
    : '（空き日程未取得）';

  return '以下の会話から、自然な流れでデートのお誘いをしてください。\n\n' +
    '会話:\n' + conversationSummary + '\n\n' +
    slotsText + '\n\n' +
    '希望エリア: ' + (pattern.apoArea || '未設定') + '\n' +
    '希望場所: ' + (pattern.apoVenue || '未設定') + '\n\n' +
    '空き日程を含めた自然なお誘い文を作成してください。押しつけがましくなく、相手の都合も聞く形で。';
}

var DEFAULT_FIRST_MSG_INSTRUCTION = 'あなたは[自分の名前]です。\n' +
  '以下のプロフィールの相手への初回メッセージを書いてください。\n\n' +
  '構成:\n' +
  '1. 名前を名乗って自己紹介する\n' +
  '2. 見た目がすごくタイプでいいねした、と自然に伝える\n' +
  '3. プロフィールから1〜2つ具体的な内容を選び「〜な人すごく好きです」と好意を伝える\n' +
  '4. 自然に質問を1つ添える（無理にしなくてよい）\n' +
  '5. 「仲良くなってご飯にでもいきましょう」で締める\n\n' +
  '禁止: 「はじめまして」などの定型句 / プロフィールにない情報を追加 / 前置き・説明の出力\n' +
  '文量: 3〜5文程度';

function buildFirstMessagePrompt(opponentProfile, customPrompt) {
  var profileSection = opponentProfile
    ? '【相手のプロフィール】\n' + opponentProfile + '\n\n'
    : '';
  var instruction = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : DEFAULT_FIRST_MSG_INSTRUCTION;
  return profileSection + instruction;
}

// 相手の名前を会話履歴から抽出
function extractOpponentName(body) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) return { success: false, error: 'CLAUDE_API_KEY not set' };

  var systemPrompt =
    '会話履歴を読み、「相手」が自分の名前を名乗っているか確認してください。\n' +
    '名乗っている場合は名前のみを返してください（例: ひかり）。\n' +
    '名乗っていない場合は空文字のみを返してください。\n' +
    '説明・前置き・記号一切不要。名前または空文字のみ。';

  var name = callClaudeOnce(apiKey, systemPrompt, body.conversationSummary || '', 20);
  return { success: true, name: name.trim() };
}

// アポ返答判定
function judgeApoResponse(body) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) return { success: false, error: 'CLAUDE_API_KEY not set' };

  var systemPrompt =
    'あなたはマッチングアプリのデートのお誘いへの「相手（女性）」の返答を判定する専門家です。\n' +
    '重要：「自分」のメッセージはデートに誘った側の発言です。判定対象は「相手」の返答のみです。\n' +
    '会話の末尾が「自分」の発言で終わっている場合（相手がまだ返答していない）は必ず「unclear」を返してください。\n' +
    '判定基準：\n' +
    '- accepted_meal: 相手がご飯・食事・ランチ・ディナーに行くことを明確に承諾\n' +
    '- accepted_cafe: 相手がカフェ・お茶・コーヒーに行くことを明確に承諾\n' +
    '- accepted_phone: 相手が電話・通話・LINE電話を明確に承諾\n' +
    '- rejected: 相手が「難しい」「ちょっと…」「忙しい」「まだ早い」「遠慮します」など明確に断った\n' +
    '- unclear: 相手が曖昧・話題転換・「考えます」・スタンプのみ・まだ返答していない\n\n' +
    '必ず以下のJSON形式のみで回答。説明・前置き不要：\n' +
    '{"result":"accepted_meal","reason":"理由30文字以内"}\n' +
    '{"result":"accepted_cafe","reason":"理由30文字以内"}\n' +
    '{"result":"accepted_phone","reason":"理由30文字以内"}\n' +
    '{"result":"rejected","reason":"理由30文字以内"}\n' +
    '{"result":"unclear","reason":"理由30文字以内"}';

  var userPrompt = '以下の会話を分析し、デートのお誘いへの返答を判定してください：\n\n' +
    (body.conversationSummary || '');

  var raw = callClaudeOnce(apiKey, systemPrompt, userPrompt);

  try {
    var match = raw.match(/\{[^}]+\}/);
    if (!match) throw new Error('JSON not found');
    var parsed = JSON.parse(match[0]);
    if (!['accepted_meal', 'accepted_cafe', 'accepted_phone', 'rejected', 'unclear'].includes(parsed.result)) throw new Error('Invalid result');
    return { success: true, result: parsed.result, reason: parsed.reason || '' };
  } catch (e) {
    return { success: true, result: 'unclear', reason: '判定失敗' };
  }
}

// 分析用Claude呼び出し（analysis.jsから使用）
function runAnalysis(body) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) return { success: false, error: 'CLAUDE_API_KEY not set' };

  var profileLog = getProfileLog().data || [];
  var prompt = buildAnalysisPrompt(body.data || [], profileLog, body.period);
  var result = callClaudeOnce(apiKey, 'あなたはマーケティングアナリストです。データを分析して具体的な改善提案をしてください。', prompt);
  saveAnalysis({ analysis: result, period: body.period || '全期間' });
  return { success: true, analysis: result };
}

function buildAnalysisPrompt(data, profileLog, period) {
  // 分析期間中のプロフィール変遷を付加
  var profileSection = '';
  if (profileLog && profileLog.length > 0) {
    profileSection = '\n\n## プロフィール変遷\n' +
      profileLog.map(function(p) {
        var photos = [p['写真1'],p['写真2'],p['写真3'],p['写真4'],p['写真5']]
          .filter(Boolean).join(' / ');
        return '【' + p['変更日'] + '〜】\n' +
          '  写真: ' + (photos || '未記録') + '（メイン: ' + p['メイン写真番号'] + '枚目）\n' +
          '  プロフィール文: ' + (p['プロフィール文'] || '未記録') +
          (p['備考'] ? '\n  備考: ' + p['備考'] : '');
      }).join('\n\n');
  }

  return '以下はマッチングアプリの自動化ツールで収集したコンバージョンデータです（パターン別集計）:\n\n' +
    JSON.stringify(data, null, 2) +
    profileSection + '\n\n' +
    '## 1. パフォーマンス評価\n- 最もマッチ率・アポ率が高いパターンとその特徴\n\n' +
    '## 2. プロフィール写真・文の効果分析\n- 変更前後でマッチ率に変化があったか\n- 効果的だった写真構成・文章の特徴\n\n' +
    '## 3. ペルソナ・文体の傾向分析\n- 効果的な書き方・トーンの傾向\n\n' +
    '## 4. 具体的な改善案\n- プロフィール写真の並び順・枚数の提案\n- プロフィール文の書き換え例\n- メッセージスタイルの調整ポイント\n\n' +
    '## 5. 次に試すべき新パターン\n- 未試のアプローチとペルソナ例文\n\n' +
    '日本語で箇条書きで具体的に。';
}
