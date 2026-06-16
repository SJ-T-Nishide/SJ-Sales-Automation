// ============================================================
// 東カレデート自動化 - GAS Web App ルーター
// デプロイ: ウェブアプリ / 実行: 自分 / アクセス: 全員
// ============================================================

function doGet(e) {
  if (!validateToken(e)) return errorResponse('Unauthorized');
  var route = e.parameter.route || '';

  if (route === 'calendar')     return jsonResponse(getFreeSlots());
  if (route === 'analysis')     return jsonResponse(getAnalysisHistory());
  if (route === 'logs')         return jsonResponse(getLogs());
  if (route === 'daily-report') return jsonResponse(sendDailyReport());
  if (route === 'profile-log')  return jsonResponse(getProfileLog());

  return errorResponse('Unknown route');
}

function doPost(e) {
  if (!validateToken(e)) return errorResponse('Unauthorized');

  var route = e.parameter.route || '';

  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch(err) { return errorResponse('Invalid JSON'); }

  if (route === 'log')         return jsonResponse(writeLog(body));
  if (route === 'generate')    return jsonResponse(generateCandidates(body));
  if (route === 'judge')       return jsonResponse(judgeApoResponse(body));
  if (route === 'extractName') return jsonResponse(extractOpponentName(body));
  if (route === 'analysis')    return jsonResponse(saveAnalysis(body));
  if (route === 'profile-log') return jsonResponse(addProfileVersion(body));
  if (route === 'knowledge')   return jsonResponse(saveKnowledge(body));

  return errorResponse('Unknown route');
}

// ---- ユーティリティ ----

function validateToken(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('GAS_TOKEN');
  return secret && (e.parameter.token === secret);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jstNow() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
}
