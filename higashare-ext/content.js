
// ============================================================
// Content Script
// - 自動いいね（上限付き・重複防止・安全停止）
// - 返信候補UI注入（自動送信なし）
// - アポ打診文生成（カレンダー連携）
// - 承認済みアイテムの受信
// - フローティング停止ボタン
// ============================================================

// ---- セレクター ----
const SEL = {
  likeBtn:      'a[onclick*="post_like"]',
  likedMark:    'span.radius100',
  profileCard:  'div.userWrap, a.radius0',
  messageItem:  'li[id^="message_"]',
  myMessage:    'li[id^="message_"][style*="text-align:right"]',
  inputBox:     'textarea#message_mb4_content',
  sendBtn:      'input[type="submit"][name="commit"]',
  convArea:     '[class*="conversation"], [class*="talk"], [class*="room"]',
  opponentAge:  '[class*="age"], [class*="profile-age"]',
  opponentJob:  '[class*="job"], [class*="occupation"]',
  opponentArea: '[class*="area"], [class*="location"]',
  loginPage:    'input[type="email"], input[name="email"], [class*="login"]',
  convListItem: 'a.radius0',
  scoutBtn:     'a[href*="/friend/direct_message/"]',
};

const UI_ID = {
  floatBtn:   'hg-float-stop',
  replyPanel: 'hg-reply-panel',
};

const ALLOWED_HOST = 'tokyo-calendar-date.jp';

let likeTimer        = null;
let likeCount        = 0;
let isRunning        = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

let footprintTimer      = null;
let isFootprintRunning  = false;

let scoutTimer          = null;
let isScoutRunning      = false;
let scoutCountThisRun   = 0;
let matchInjectTimer    = null;
let isSendNowPressed    = false; // 今すぐ送信ボタン押下中フラグ（ページ遷移でリセット）

// ---- ストレージ ----

const syncGet  = (k) => new Promise((r) => chrome.storage.sync.get(k, r));
const localGet = (k) => new Promise((r) => chrome.storage.local.get(k, r));
const localSet = (o) => new Promise((r) => chrome.storage.local.set(o, r));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ページのmainWorldにscriptを注入（content scriptからは直接window.alert等を上書き不可）
function injectPageScript(code) {
  const s = document.createElement('script');
  s.textContent = code;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
}

// テンプレート区切り行（----など）を除去して整形する
function sanitizeTemplate(tmpl) {
  return (tmpl || '').split('\n').filter((l) => !/^-{4,}$/.test(l.trim())).join('\n').trim();
}

// プロフィールモーダル内でランダムスクロール（bot検知対策）
async function simulateProfileScroll() {
  const scrollable = document.querySelector('.profile_modal_body, .modal_body, .modal-body') || document.body;
  const steps = 2 + Math.floor(Math.random() * 4); // 2〜5回
  for (let i = 0; i < steps; i++) {
    const down = Math.random() < 0.7;
    const dist = 50 + Math.floor(Math.random() * 131); // 50〜180px
    scrollable.scrollBy({ top: down ? dist : -dist, behavior: 'smooth' });
    await sleep(350 + Math.floor(Math.random() * 651)); // 350〜1000ms
  }
}

// ---区切りで複数バリエーションからランダム選択
function pickVariant(tmpl) {
  const variants = (tmpl || '').split(/\n---\n/).map((s) => s.trim()).filter(Boolean);
  if (variants.length === 0) return '';
  return variants[Math.floor(Math.random() * variants.length)];
}

// [名前]プレースホルダーを置換。名前なし時は[名前]ちゃん、を含む行ごと削除
function applyNameTemplate(tmpl, name) {
  if (!tmpl) return '';
  if (!name) {
    return tmpl.split('\n').filter((l) => !l.includes('[名前]ちゃん、')).join('\n').trim();
  }
  return tmpl.replace(/\[名前\]/g, name);
}

// 会話履歴から相手の名前をClaudeで抽出
async function extractOpponentName(conversationSummary) {
  try {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 8000));
    const req = chrome.runtime.sendMessage({ action: 'extractName', payload: { conversationSummary } });
    const res = await Promise.race([req, timeout]);
    if (!res) console.warn('[東カレ] extractOpponentName: タイムアウト、名前なしで続行');
    return res?.name || '';
  } catch (_) {
    return '';
  }
}

// apoMsg1Template + apoMsg2Template を名前置換して2通送信
async function sendApoMessages(pattern, history) {
  const msg1Raw = sanitizeTemplate(pattern.apoMsg1Template || '');
  const msg2Raw = sanitizeTemplate(pattern.apoMsg2Template || '');
  console.log('[東カレ] sendApoMessages msg1Raw:', msg1Raw.slice(0, 30), '| msg2Raw:', msg2Raw.slice(0, 30));
  if (!msg1Raw && !msg2Raw) return false;

  const name = await extractOpponentName(history);
  const msg1 = applyNameTemplate(msg1Raw, name);
  const msg2 = applyNameTemplate(msg2Raw, name);
  console.log('[東カレ] sendApoMessages name:', name, '| msg1:', msg1.slice(0, 30), '| msg2:', msg2.slice(0, 30));

  let ok = true;
  if (msg1) {
    ok = await sendMessageText(msg1);
    console.log('[東カレ] sendApoMessages msg1 sent:', ok);
    if (!ok) return false; // リトライ禁止（二重送信防止）
    if (msg2) await sleep(2500 + Math.floor(Math.random() * 1000));
  } else {
    console.warn('[東カレ] sendApoMessages: msg1 is empty, skipping');
  }
  if (ok && msg2) ok = await sendMessageText(msg2);
  return ok;
}

// inboundApoTemplate を名前置換して送信（1通）
async function sendInboundApoMessage(pattern, history) {
  const raw = sanitizeTemplate(pattern.inboundApoTemplate || '');
  if (!raw) return false;
  const name = await extractOpponentName(history);
  const msg = applyNameTemplate(raw, name);
  return sendMessageText(msg);
}

// ---- 会話ステート管理 ----
// stage: 0=未送信 1=msg1送信済 2=msg2送信済 3=アポ打診済 4=LINE送信済

async function csGet() {
  const { conversationStates = {} } = await localGet('conversationStates');
  return conversationStates;
}

async function csUpdate(chatPath, patch) {
  const states = await csGet();
  states[chatPath] = { ...(states[chatPath] || { stage: 0, replyCount: 0 }), ...patch };
  await localSet({ conversationStates: states });
}


async function generateFromPrompt(stagePrompt, conversationSummary, opponentProfile) {
  const SW_ERRORS = ['No SW', 'Could not establish connection', 'Extension context invalidated', 'GAS URLまたはToken', 'message channel closed'];
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            action: 'generateCandidates',
            mode: 'auto',
            stagePrompt,
            conversationSummary: conversationSummary || '',
            opponentProfile: opponentProfile || '',
          },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ __error: chrome.runtime.lastError.message });
              return;
            }
            resolve(res);
          }
        );
      } catch (err) {
        resolve({ __error: err.message });
      }
    });

    if (result?.__error) {
      const isSWError = SW_ERRORS.some((s) => result.__error.includes(s));
      if (isSWError && attempt < 2) {
        console.warn(`[東カレ] SW再起動待ち リトライ${attempt + 1}/2...`);
        await sleep(3000);
        continue;
      }
      console.warn('[東カレ] Claude生成エラー:', result.__error);
      return null;
    }
    if (result?.error) {
      console.warn('[東カレ] Claude生成エラー (GAS):', result.error);
      return null;
    }
    return result?.candidates?.[0] || null;
  }
  return null;
}

async function judgeApoReply(conversationSummary) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { action: 'judgeApo', payload: { conversationSummary } },
        (result) => {
          if (chrome.runtime.lastError) {
            console.warn('[東カレ] アポ判定エラー (lastError):', chrome.runtime.lastError.message);
            resolve('error');
            return;
          }
          if (result?.error) {
            console.warn('[東カレ] アポ判定エラー (result):', result.error);
            resolve('error');
            return;
          }
          resolve(result?.result || 'unclear');
        }
      );
    } catch (err) {
      console.warn('[東カレ] アポ判定エラー (catch):', err);
      resolve('error');
    }
  });
}

function countOpponentMessages() {
  return [...document.querySelectorAll(SEL.messageItem)]
    .filter((el) => {
      // text-align:left のみ = 相手メッセージ（right=自分, center=システム通知）
      if (el.style.textAlign !== 'left') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return false;
      return true;
    }).length;
}

async function sendMessageText(text) {
  const input = document.querySelector(SEL.inputBox);
  if (!input) { console.warn('[東カレ] textarea not found:', SEL.inputBox); return false; }
  if (!text)  { console.warn('[東カレ] text is empty'); return false; }

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  nativeSetter.call(input, text);
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.focus();
  await sleep(400);

  // 値がズレた場合: nativeSetterのみで再試行（execCommandは値を壊す可能性があるため使わない）
  if (input.value !== text) {
    console.warn('[東カレ] value mismatch, re-applying nativeSetter');
    nativeSetter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(400);
    if (input.value !== text) {
      console.warn('[東カレ] value still mismatched, aborting to avoid garbage send');
      return false;
    }
  }

  console.log('[東カレ] sendMessageText value OK:', input.value.slice(0, 30));

  const btn = document.querySelector(SEL.sendBtn);
  if (!btn) { console.warn('[東カレ] sendBtn not found:', SEL.sendBtn); return false; }

  // 送信ボタンが有効になるまで最大3秒待つ
  let btnWait = 0;
  while (btn.disabled && btnWait < 3000) { await sleep(200); btnWait += 200; }
  if (btn.disabled) { console.warn('[東カレ] sendBtn still disabled'); return false; }

  // 送信前の自分メッセージ数を記録して送信成否を検証する
  const beforeMine = document.querySelectorAll(SEL.myMessage).length;
  btn.click();
  console.log('[東カレ] sendBtn clicked, text:', text.slice(0, 30));

  // 送信が反映されたかを最大4秒ポーリング（自分メッセージ増加 or textarea クリアで確認）
  let sent = false;
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    const afterMine = document.querySelectorAll(SEL.myMessage).length;
    if (afterMine > beforeMine || (document.querySelector(SEL.inputBox)?.value ?? text) === '') {
      sent = true; break;
    }
  }
  if (!sent) console.warn('[東カレ] send not confirmed (DOM未反映、myMessageセレクタ要確認)');
  // セレクタ不一致の場合に全停止しないよう、未確認でも200ms後に続行
  await sleep(200);
  return true; // 確認できなくてもtrueで続行（セレクタ問題で誤判定しないため）
}

// ---- SHA-256 ハッシュ（重複いいね防止） ----

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- フローティング停止ボタン ----

function injectFloatingStopButton() {
  if (document.getElementById(UI_ID.floatBtn)) return;
  const btn = document.createElement('button');
  btn.id = UI_ID.floatBtn;
  btn.textContent = '⏹ 停止';
  btn.style.cssText = [
    'position:fixed', 'bottom:20px', 'right:20px', 'z-index:999999',
    'background:#c0392b', 'color:#fff', 'border:none', 'border-radius:20px',
    'padding:8px 16px', 'font-size:13px', 'font-weight:bold',
    'cursor:pointer', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
    'display:none',
  ].join(';');
  btn.addEventListener('click', () => stopAll());
  document.body.appendChild(btn);
}

function showStopButton(show) {
  const btn = document.getElementById(UI_ID.floatBtn);
  if (btn) btn.style.display = show ? 'block' : 'none';
}

function stopAll(reason) {
  clearTimeout(likeTimer);
  likeTimer = null;
  isRunning = false;
  consecutiveErrors = 0;
  if (isFootprintRunning) {
    clearTimeout(footprintTimer);
    footprintTimer = null;
    isFootprintRunning = false;
    localSet({ footprintRunning: false }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'footprintStopped' }).catch(() => {});
  }
  if (isScoutRunning) {
    clearTimeout(scoutTimer);
    scoutTimer = null;
    isScoutRunning = false;
    localSet({ scoutRunning: false }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'scoutStopped' }).catch(() => {});
  }
  showStopButton(false);
  localSet({ autoLikeRunning: false }).catch(() => {});
  chrome.runtime.sendMessage({ action: 'logEvent', payload: { eventType: 'auto_like_stopped' } }).catch(() => {});
  chrome.runtime.sendMessage({ action: 'likeStopped' }).catch(() => {});
  if (reason) console.log(`[東カレ自動化] 停止: ${reason}`);
  else         console.log('[東カレ自動化] 停止しました');
}

// ============================================================
// 4段階自動メッセージエンジン
// ============================================================

async function sendApoAccepted(chatPath, judgment, pattern, opponentCount) {
  const slotType = judgment === 'accepted_meal' ? 'meal'
    : judgment === 'accepted_cafe' ? 'cafe' : 'phone';
  const { freeDays = {} } = await localGet('freeDays');
  const slots = getTypedSlots(freeDays, slotType);
  const parts = buildApoAcceptedReply(judgment, slots, pattern);
  if (parts.length === 0) {
    setStatus('テンプレート未設定', '#e74c3c');
    return;
  }
  let allSent = true;
  for (const part of parts) {
    const ok = await sendMessageText(part);
    if (!ok) { allSent = false; break; }
    if (parts.length > 1) await sleep(2000 + Math.floor(Math.random() * 1000));
  }
  if (allSent) {
    await csUpdate(chatPath, { stage: 4, replyCount: opponentCount, apoJudgment: null });
    setStatus('アポ承認返信 + LINE送信 ✓', '#27ae60');
  }
}

async function executeStageForCurrentChat() {
  if (!isConversationPage()) return;
  const chatPath = location.pathname.replace(/\/$/, '');

  const states = await csGet();
  const state = states[chatPath];
  if (!state || state.stage === 0 || state.stage >= 4) return;
  if (state.active === false) return;

  const [{ patterns = [] }, { activePatternId }, { checkQueue = [] }] = await Promise.all([
    localGet('patterns'), localGet('activePatternId'), localGet('checkQueue'),
  ]);
  const pattern = patterns.find((p) => p.id === (state.patternId || activePatternId)) || {};
  // 一斉送信バッチ中（checkQueueに含まれる）または今すぐ送信ボタン押下時のみ承認メッセージを送信
  const sendApoNow = checkQueue.includes(chatPath) || isSendNowPressed;

  // stage=3: 承認済み・送信待ちは opponentCount 比較より先にチェック
  if (state.stage === 3 && state.apoJudgment) {
    if (sendApoNow) {
      // 判定時に保存した replyCount を使う（再カウントするとタイミングがずれる）
      await sendApoAccepted(chatPath, state.apoJudgment, pattern, state.replyCount || 0);
    } else {
      setStatus('✅ アポ承認済み・送信待ち', '#27ae60');
    }
    return;
  }

  const opponentCount = countOpponentMessages();
  // 絶対安全ガード: 相手から一度も返信がない場合は追加メッセージ・アポ打診を絶対に送らない
  if (opponentCount === 0) {
    console.warn('[東カレ] 追い打ち防止: opponentCount=0 のため送信スキップ (stage=' + state.stage + ', replyCount=' + (state.replyCount || 0) + ')');
    setStatus('返信待ち（相手未返信）', '#888');
    return;
  }
  if (opponentCount <= (state.replyCount || 0)) {
    setStatus('新しい返信待ち（相手の返信後に自動送信）', '#888');
    return;
  }

  // apoTriggerCount の最低値は1（0以下は3にフォールバック）
  const effectiveApoTrigger = Math.max(1, pattern.apoTriggerCount || 3);

  // インバウンド（相手が先にメッセージ送信）: 一斉送信バッチ時に inboundApoTemplate でアポ打診
  if (state.stage === 1 && state.isInbound && sendApoNow) {
    const history = getConversationHistory().slice(-20).join('\n');
    setStatus('アポ打診中（インバウンド）...', '#888');
    const ok = await sendInboundApoMessage(pattern, history);
    if (ok) {
      await csUpdate(chatPath, { stage: 3, replyCount: opponentCount, isInbound: false });
      setStatus('インバウンド → アポ打診 ✓', '#27ae60');
    } else {
      setStatus('③ アポ打診（インバウンド用）テンプレート未設定', '#e74c3c');
    }
    return;
  }

  // スカウト返信フラグがある場合は直接apoMsg1送信（こちらから先に送った場合のパターンに合流）
  if (state.scoutReply) {
    const history = getConversationHistory().slice(-20).join('\n');
    setStatus('アポ打診中（スカウト返信）...', '#888');
    console.log('[東カレ] スカウト返信アポ送信: opponentCount=' + opponentCount + ', replyCount=' + (state.replyCount || 0));
    const ok = await sendApoMessages(pattern, history);
    if (ok) {
      await csUpdate(chatPath, { stage: 3, replyCount: opponentCount, scoutReply: false });
      setStatus('スカウト返信 → アポ打診 ✓', '#27ae60');
    }
    return;
  }

  let stagePrompt = null;
  let nextStage = state.stage;

  if (state.stage === 1) {
    stagePrompt = sanitizeTemplate(pattern.msg2Template);
    nextStage = 2;
    // msg2Template未設定時、アポ打診条件を満たしていれば直接2通送信してstage3へ
    if (!stagePrompt && opponentCount >= effectiveApoTrigger) {
      console.log('[東カレ] stage 1→3 アポ直送: opponentCount=' + opponentCount + ', trigger=' + effectiveApoTrigger);
      setStatus('アポ送信中...', '#888');
      const history = getConversationHistory().slice(-20).join('\n');
      const ok = await sendApoMessages(pattern, history);
      if (ok) {
        await csUpdate(chatPath, { stage: 3, replyCount: opponentCount });
        setStatus('ステージ1→3 アポ自動送信 ✓', '#27ae60');
        console.log('[東カレ自動化] stage 1→3（アポ直送）');
      }
      return;
    }
  } else if (state.stage === 2) {
    if (opponentCount >= effectiveApoTrigger) {
      console.log('[東カレ] stage 2→3 アポ直送: opponentCount=' + opponentCount + ', trigger=' + effectiveApoTrigger);
      setStatus('アポ送信中...', '#888');
      const history = getConversationHistory().slice(-20).join('\n');
      const ok = await sendApoMessages(pattern, history);
      if (ok) {
        await csUpdate(chatPath, { stage: 3, replyCount: opponentCount });
        setStatus('ステージ2→3 アポ自動送信 ✓', '#27ae60');
        console.log('[東カレ自動化] stage 2→3（アポ直送）');
      }
      return;
    }
  } else if (state.stage === 3) {
    const history = getConversationHistory().slice(-20).join('\n');
    setStatus('アポ返答を判定中...', '#888');
    const judgment = await judgeApoReply(history);
    console.log('[東カレ自動化] アポ判定結果:', judgment);

    if (judgment === 'error') {
      setStatus('⚠️ 判定API失敗 → 次回再試行', '#e67e22');
      return;
    }
    if (judgment === 'rejected') {
      await csUpdate(chatPath, { active: false, apoStatus: 'rejected', replyCount: opponentCount });
      setStatus('🚫 アポ拒否と判定 → 停止', '#e74c3c');
      showNotif('🚫 アポを断られました\nマッチ一覧で確認してください', '#e74c3c');
      return;
    }
    if (judgment === 'unclear') {
      // active は維持して次回バッチで再試行。フラグだけ立てて通知。
      await csUpdate(chatPath, { apoStatus: 'unclear', replyCount: opponentCount });
      setStatus('❓ 判別不能 → 次回再試行', '#e67e22');
      showNotif('❓ アポ返答が判別不能です\nマッチ一覧で確認してください', '#e67e22');
      return;
    }

    if (['accepted_meal', 'accepted_cafe', 'accepted_phone'].includes(judgment)) {
      // 判定結果を保存（送信は一斉送信バッチ中または今すぐ送信時のみ）
      await csUpdate(chatPath, { apoStatus: 'accepted', apoJudgment: judgment, replyCount: opponentCount });
      if (sendApoNow) {
        await sendApoAccepted(chatPath, judgment, pattern, opponentCount);
      } else {
        setStatus('✅ アポ承認検知 → 送信待ち', '#27ae60');
        showNotif('✅ アポ承認を検知しました！\n一斉送信または今すぐ送信で完了します', '#27ae60');
      }
      return;
    }
    // フォールバック: 旧 accepted
    if (judgment === 'accepted') {
      await csUpdate(chatPath, { apoStatus: 'accepted' });
      stagePrompt = pattern.apoMealPart1 || '';
      nextStage = 4;
    }
  }

  if (stagePrompt) {
    setStatus('Claude生成中...', '#888');
    const history = getConversationHistory().slice(-20).join('\n');
    const generated = await generateFromPrompt(stagePrompt, history, '');
    if (!generated) {
      setStatus('Claude生成失敗', '#e74c3c');
      showNotif('❌ Claude生成失敗\nGAS URL/Tokenを確認してください', '#e74c3c');
      return;
    }
    const parts = generated.split('[SPLIT]').map((s) => s.trim()).filter(Boolean);
    let allSent = true;
    for (const part of parts) {
      const ok = await sendMessageText(part);
      if (!ok) { allSent = false; break; }
      if (parts.length > 1) await sleep(2000 + Math.floor(Math.random() * 1000));
    }
    if (allSent) {
      await csUpdate(chatPath, { stage: nextStage, replyCount: opponentCount });
      setStatus(`ステージ${state.stage}→${nextStage} 自動送信 ✓`, '#27ae60');
      console.log(`[東カレ自動化] stage ${state.stage}→${nextStage}`);
    }
  } else {
    // stagePromptが空（テンプレート未設定）の場合はステージを進めず、replyCountのみ更新して返信待ち
    await csUpdate(chatPath, { replyCount: opponentCount });
    console.log(`[東カレ自動化] stage ${state.stage} テンプレート未設定のため待機（replyCount=${opponentCount}）`);
  }
}

// スカウト返信検出 → 追跡中に設定（チャットページ上で相手userIdを取得して照合）
async function detectAndSetScoutReply(chatPath) {
  const { scoutSentUserIds = [] } = await localGet('scoutSentUserIds');
  if (scoutSentUserIds.length === 0) return false;

  await sleep(300); // DOM完全ロード待ち
  const avatarBtn = document.querySelector('a.radius100[onclick*="profile_open"]');
  const m = avatarBtn?.getAttribute('onclick')?.match(/profile_open\((\d+)\)/);
  if (!m || !scoutSentUserIds.includes(m[1])) return false;

  const oppCount = countOpponentMessages();
  if (oppCount === 0) return false;

  const { activePatternId } = await localGet('activePatternId');
  await csUpdate(chatPath, {
    stage: 1, replyCount: 0,
    patternId: activePatternId, active: true, scoutReply: true,
  });
  console.log('[東カレ自動化] スカウト返信検出 → 追跡中設定:', chatPath, 'userId:', m[1]);
  showNotif('💬 スカウト返信あり\n追跡中に設定しました', '#3498db', 4000);
  return true;
}

async function advanceCheckQueue() {
  const { checkQueue = [] } = await localGet('checkQueue');
  if (checkQueue.length === 0) return; // 停止ボタンでクリア済み
  const currentPath = location.pathname.replace(/\/$/, '');
  const remaining = checkQueue.filter((p) => p !== currentPath);
  await localSet({ checkQueue: remaining });
  if (remaining.length > 0) {
    setTimeout(() => { location.href = remaining[0]; }, 1500);
  } else {
    // checkQueue完了後、batchQueueがあれば初回送信を開始
    const { batchQueue = [] } = await localGet('batchQueue');
    if (batchQueue.length > 0) {
      console.log(`[東カレ自動化] 返信チェック完了 → 初回送信${batchQueue.length}件へ`);
      setTimeout(() => { location.href = batchQueue[0].path; }, 1500);
    } else {
      console.log('[東カレ自動化] 全処理完了（返信確認 + 初回送信）');
      showNotif('✅ 一斉送信完了', '#27ae60', 3000);
    }
  }
}


// ---- 安全停止: URL検証 ----

function isAllowedUrl() {
  return location.hostname === ALLOWED_HOST || location.hostname.endsWith('.' + ALLOWED_HOST);
}

// ---- 安全停止: ログイン切れ検出 ----

function isLoginPage() {
  return location.pathname.includes('/login') || location.pathname.includes('/signin');
}

// ============================================================
// 自動足跡モード
// ============================================================

async function openNextUnvisitedProfile() {
  const { footprintHashes = [] } = await localGet('footprintHashes');
  const cards = [...document.querySelectorAll('a.radius0[onclick*="profile_open"]')];

  let targetId = null;
  for (const card of cards) {
    const m = card.getAttribute('onclick').match(/profile_open\((\d+)\)/);
    if (!m) continue;
    const h = await sha256('fp_' + m[1]);
    if (!footprintHashes.includes(h)) { targetId = m[1]; break; }
  }

  if (!targetId) {
    stopAutoFootprint('一覧に未閲覧のカードがありません');
    return;
  }

  const h = await sha256('fp_' + targetId);
  const updated = [...footprintHashes, h].slice(-500);
  await localSet({ footprintHashes: updated });

  window.dispatchEvent(new CustomEvent('hg-profile-open', { detail: { userId: parseInt(targetId, 10) } }));
}

async function runFootprintCycle() {
  if (!isFootprintRunning) return;
  if (!isAllowedUrl() || isLoginPage()) { stopAutoFootprint('URL変更またはログイン切れ'); return; }

  await openNextUnvisitedProfile();

  const profileText = document.body.innerText.length;
  const viewTime = 3000 + Math.min(profileText / 5, 4000) + Math.floor(Math.random() * 1000);
  await sleep(viewTime);

  window.dispatchEvent(new CustomEvent('hg-profile-close'));

  footprintTimer = setTimeout(runFootprintCycle, 3000 + Math.floor(Math.random() * 5000));
}

async function startAutoFootprint() {
  if (isFootprintRunning || !isAllowedUrl()) return;
  if (!isListPage()) {
    await localSet({ footprintRunning: true });
    location.href = 'https://tokyo-calendar-date.jp/search/list';
    return;
  }
  isFootprintRunning = true;
  showStopButton(true);
  await localSet({ footprintRunning: true });
  console.log('[東カレ自動化] 足跡モード開始');
  await runFootprintCycle();
}

function stopAutoFootprint(reason) {
  clearTimeout(footprintTimer);
  footprintTimer = null;
  isFootprintRunning = false;
  localSet({ footprintRunning: false }).catch(() => {});
  chrome.runtime.sendMessage({ action: 'footprintStopped' }).catch(() => {});
  if (!isRunning && !isScoutRunning) showStopButton(false);
  if (reason) console.log('[東カレ自動化] 足跡モード停止: ' + reason);
  else        console.log('[東カレ自動化] 足跡モード停止');
}

// ============================================================
// 非マッチ一斉送信（スカウト）
// ============================================================

async function startAutoScout() {
  if (isScoutRunning || !isAllowedUrl()) return;
  if (!isListPage()) {
    await localSet({ scoutRunning: true });
    location.href = 'https://tokyo-calendar-date.jp/search/list';
    return;
  }
  const { patterns = [] } = await localGet('patterns');
  const { activePatternId } = await localGet('activePatternId');
  const pattern = patterns.find((p) => p.id === activePatternId) || {};
  if (!pattern.scoutMsgTemplate) {
    console.log('[東カレ自動化] スカウトテンプレート未設定');
    return;
  }
  isScoutRunning = true;
  scoutCountThisRun = 0;
  showStopButton(true);
  await localSet({ scoutRunning: true });
  // 非マッチ送信中はサイトのalert()を自動OKにする
  window.dispatchEvent(new CustomEvent('hg-alert-toggle', { detail: { suppress: true } }));
  console.log('[東カレ自動化] 非マッチ送信開始');
  await runScoutCycle();
}

function stopAutoScout(reason) {
  clearTimeout(scoutTimer);
  scoutTimer = null;
  isScoutRunning = false;
  localSet({ scoutRunning: false }).catch(() => {});
  chrome.runtime.sendMessage({ action: 'scoutStopped' }).catch(() => {});
  if (!isRunning && !isFootprintRunning) showStopButton(false);
  // alert()を元に戻す
  window.dispatchEvent(new CustomEvent('hg-alert-toggle', { detail: { suppress: false } }));
  if (reason) console.log('[東カレ自動化] 非マッチ送信停止: ' + reason);
  else        console.log('[東カレ自動化] 非マッチ送信停止');
}

async function runScoutCycle() {
  if (!isScoutRunning) return;
  if (!isAllowedUrl() || isLoginPage()) { stopAutoScout('URL変更またはログイン切れ'); return; }

  const { patterns = [] } = await localGet('patterns');
  const { activePatternId } = await localGet('activePatternId');
  const pattern = patterns.find((p) => p.id === activePatternId) || {};

  const maxPerRun = pattern.maxScoutPerRun || 10;
  const maxDaily  = pattern.maxScoutDaily  || 20;

  const today = new Date().toLocaleDateString('ja-JP');
  const { scoutCount = 0, scoutDate = '' } = await localGet(['scoutCount', 'scoutDate']);
  const todayCount = scoutDate === today ? scoutCount : 0;

  if (scoutCountThisRun >= maxPerRun) { stopAutoScout('1回実行上限に達しました'); return; }
  if (todayCount >= maxDaily)         { stopAutoScout('1日上限に達しました'); return; }

  const { messageHashes = [] } = await localGet('messageHashes');
  await doOneScout(pattern, today, messageHashes, todayCount);

  const delay = 3000 + Math.floor(Math.random() * 4000);
  scoutTimer = setTimeout(runScoutCycle, delay);
}

async function doOneScout(pattern, today, messageHashes, todayCount) {
  const cards = [...document.querySelectorAll('a.radius0[onclick*="profile_open"]')];
  let targetId = null;
  for (const card of cards) {
    const m = card.getAttribute('onclick').match(/profile_open\((\d+)\)/);
    if (!m) continue;
    const h = await sha256('scout_' + m[1]);
    if (!messageHashes.includes(h)) { targetId = m[1]; break; }
  }

  if (!targetId) {
    stopAutoScout('一覧に送信可能なカードがありません');
    return;
  }

  // ハッシュを先に計算（全失敗パスで使う）
  const h = await sha256('scout_' + targetId);

  const skipAndCount = async (reason) => {
    console.warn('[東カレ] doOneScout スキップ:', reason, targetId);
    window.dispatchEvent(new CustomEvent('hg-profile-close'));
    await sleep(500);
    await localSet({ messageHashes: [...messageHashes, h].slice(-500) });
    scoutCountThisRun++; // 失敗でもカウントして上限に達するようにする
  };

  window.dispatchEvent(new CustomEvent('hg-profile-open', { detail: { userId: parseInt(targetId, 10) } }));
  await sleep(1500);

  const msgBtn = document.querySelector(SEL.scoutBtn);
  if (!msgBtn) {
    await skipAndCount('scoutBtn not found');
    return;
  }

  msgBtn.click();
  await sleep(1500); // モーダル描画を待つ

  const tmpl = pickVariant(pattern.scoutMsgTemplate || '');
  if (!tmpl) {
    await skipAndCount('scoutMsgTemplate未設定');
    return;
  }

  // textarea#message_mb4_content はチャットと共通ID
  const input = document.querySelector(SEL.inputBox);
  if (!input) {
    await skipAndCount('scout input not found');
    return;
  }

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  nativeSetter.call(input, tmpl);
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.focus();
  await sleep(400);

  const sendBtn = document.querySelector(SEL.sendBtn);
  if (!sendBtn) {
    await skipAndCount('scout sendBtn not found');
    return;
  }

  sendBtn.click();
  console.log('[東カレ自動化] 非マッチ送信:', targetId);
  await sleep(800);

  await localSet({ messageHashes: [...messageHashes, h].slice(-500) });
  await localSet({ scoutCount: todayCount + 1, scoutDate: today });
  scoutCountThisRun++;
  // 返信追跡のために送信先userId を保存
  const { scoutSentUserIds: existingIds = [] } = await localGet('scoutSentUserIds');
  await localSet({ scoutSentUserIds: [...new Set([...existingIds, String(targetId)])].slice(-200) });

  await sleep(800);
  window.dispatchEvent(new CustomEvent('hg-profile-close'));
  await sleep(500);
}

// ============================================================
// 自動いいね
// ============================================================

async function startAutoLike() {
  // 開始条件チェック
  if (isRunning) return;

  if (!isAllowedUrl()) {
    console.log('[東カレ自動化] 許可されていないURLです');
    return;
  }

  if (isLoginPage()) {
    console.log('[東カレ自動化] ログインページのため開始できません');
    return;
  }

  const { patterns = [] } = await localGet('patterns');
  const { activePatternId } = await localGet('activePatternId');
  const pattern = patterns.find((p) => p.id === activePatternId) || {};

  const maxPerRun  = pattern.maxLikesPerRun;
  const maxDaily   = pattern.maxLikesDaily;

  // 上限が両方設定されているか確認
  if (!maxPerRun || !maxDaily) {
    console.log('[東カレ自動化] いいね上限が未設定のため開始できません');
    return;
  }

  const { dailyLikeCount = 0, dailyLikeDate = '' } = await localGet(['dailyLikeCount','dailyLikeDate']);
  const today = new Date().toLocaleDateString('ja-JP');
  const todayCount = dailyLikeDate === today ? dailyLikeCount : 0;

  if (todayCount >= maxDaily) {
    console.log('[東カレ自動化] 本日の上限に達しています');
    return;
  }

  // 開始ログ
  chrome.runtime.sendMessage({
    action: 'logEvent',
    payload: {
      eventType: 'auto_like_started',
      memo: `maxPerRun:${maxPerRun} maxDaily:${maxDaily} patternId:${pattern.id || ''}`,
    },
  }).catch(() => {});

  isRunning = true;
  likeCount = 0;
  consecutiveErrors = 0;
  showStopButton(true);
  localSet({ autoLikeRunning: true }).catch(() => {});
  console.log('[東カレ自動化] 自動いいね開始');

  async function runLikeCycle() {
    if (!isRunning) return;

    // 実行中の安全チェック
    if (!isAllowedUrl()) { stopAll('URLが変わりました'); return; }
    if (isLoginPage())   { stopAll('ログインが必要です'); return; }
    if (likeCount >= maxPerRun) { stopAll('1回実行上限に達しました'); return; }

    const freshToday = new Date().toLocaleDateString('ja-JP');
    const fresh = await localGet(['dailyLikeCount','dailyLikeDate']);
    const currentCount = fresh.dailyLikeDate === freshToday ? fresh.dailyLikeCount : 0;
    if (currentCount >= maxDaily) { stopAll('1日上限に達しました'); return; }

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      stopAll('連続エラーが3回発生しました');
      return;
    }

    await doOneLike(freshToday);

    // 次回まで待機: 70%→8〜20s、25%→20〜40s、5%→90〜180s
    const r = Math.random();
    const delay = r < 0.70 ? 8000  + Math.floor(Math.random() * 12001)
               : r < 0.95 ? 20000 + Math.floor(Math.random() * 20001)
               :             90000 + Math.floor(Math.random() * 90001);
    likeTimer = setTimeout(runLikeCycle, delay);
  }

  likeTimer = setTimeout(runLikeCycle, 500);
}

function isModalOpen() {
  return !!document.querySelector('a.hmenu_close[onclick*="profile_close"]');
}

async function openNextProfile() {
  const { likedHashes = [] } = await localGet('likedHashes');
  const cards = [...document.querySelectorAll('a.radius0[onclick*="profile_open"]')];

  let targetId = null;
  for (const card of cards) {
    const m = card.getAttribute('onclick').match(/profile_open\((\d+)\)/);
    if (!m) continue;
    const h = await sha256('uid_' + m[1]);
    if (!likedHashes.includes(h)) { targetId = m[1]; break; }
  }

  if (!targetId) {
    stopAll('一覧に未いいねのカードがありません');
    return;
  }

  console.log(`[東カレ自動化] プロフィール展開: ${targetId}`);
  consecutiveErrors = 0;
  window.dispatchEvent(new CustomEvent('hg-profile-open', { detail: { userId: parseInt(targetId, 10) } }));
}

async function isProfileFiltered(pattern) {
  const modalText = document.body.innerText;

  if (pattern.excludeAge) {
    const ageMatch = modalText.match(/(\d+)歳/);
    if (ageMatch) {
      const age = parseInt(ageMatch[1], 10);
      for (const range of pattern.excludeAge.split(',').map((s) => s.trim())) {
        const parts = range.split('-').map(Number);
        const min = parts[0], max = parts[1];
        if (!isNaN(min) && !isNaN(max) && age >= min && age <= max) return true;
        if (!isNaN(min) &&  isNaN(max) && age >= min) return true;
      }
    }
  }

  if (pattern.excludeJobs && pattern.excludeJobs.length > 0) {
    for (const job of pattern.excludeJobs) {
      if (modalText.includes(job)) return true;
    }
  }

  return false;
}

async function doOneLike(today) {
  const btn = document.querySelector(SEL.likeBtn);
  const alreadyLiked = document.querySelector(SEL.likedMark);

  // いいね済みモーダル → 次のプロフィールを直接開く
  if (alreadyLiked && !btn) {
    console.log('[東カレ自動化] いいね済みスキップ → 次へ');
    consecutiveErrors = 0;
    await openNextProfile();
    return;
  }

  // いいねボタンあり → いいね実行
  if (btn) {
    const match = btn.getAttribute('onclick')?.match(/post_like\((\d+)\)/) ||
                  document.querySelector('[onclick*="post_like"]')?.getAttribute('onclick')?.match(/post_like\((\d+)\)/);
    const uid = match ? match[1] : String(Date.now());
    const hash = await sha256('uid_' + uid);

    const { likedHashes = [] } = await localGet('likedHashes');
    if (likedHashes.includes(hash)) {
      console.log('[東カレ自動化] いいね済みスキップ（ハッシュ）→ 次へ');
      consecutiveErrors = 0;
      await openNextProfile();
      return;
    }

    // フィルター判定＋stats用にパターンを1回取得
    const [{ patterns: fps = [] }, { activePatternId: fapid }] = await Promise.all([
      localGet('patterns'),
      localGet('activePatternId'),
    ]);
    const fpat = fps.find((p) => p.id === fapid) || {};
    if (await isProfileFiltered(fpat)) {
      console.log('[東カレ自動化] フィルターでスキップ');
      consecutiveErrors = 0;
      await openNextProfile();
      return;
    }

    try {
      // まれにプロフィールを読む（12%）
      if (Math.random() < 0.12) {
        const readMs = 10000 + Math.floor(Math.random() * 5001); // 10〜15s
        console.log(`[東カレ自動化] プロフィール熟読 ${Math.round(readMs/1000)}s`);
        await sleep(readMs);
      }

      // 4〜8件に1度スクロール（bot対策）
      const scrollThreshold = 4 + Math.floor(Math.random() * 5); // 4〜8
      if ((likeCount % scrollThreshold) === 0) {
        await simulateProfileScroll();
      }

      btn.click();
      likeCount++;
      consecutiveErrors = 0;

      const updated = [hash, ...likedHashes].slice(0, 500);
      await localSet({ likedHashes: updated });

      const { dailyLikeCount = 0, dailyLikeDate = '' } = await localGet(['dailyLikeCount', 'dailyLikeDate']);
      const base = dailyLikeDate === today ? dailyLikeCount : 0;
      await localSet({ dailyLikeCount: base + 1, dailyLikeDate: today });

      // stats をストレージに直接保存（ポップアップが閉じていても永続化）
      if (fpat.id) {
        fpat.stats = fpat.stats || { likesSent: 0, matchesReceived: 0, appointmentsSet: 0 };
        fpat.stats.likesSent++;
        await localSet({ patterns: fps });
      }

      chrome.runtime.sendMessage({ action: 'logEvent', payload: { eventType: 'auto_like', count: 1 } }).catch(() => {});
      chrome.runtime.sendMessage({ action: 'statsUpdate' }).catch(() => {});
      console.log(`[東カレ自動化] いいね ${likeCount}件目`);

      await sleep(800);
      await openNextProfile();
    } catch (err) {
      consecutiveErrors++;
      console.warn(`[東カレ自動化] いいねエラー (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err);
      await openNextProfile();
    }
    return;
  }

  // モーダルなし → 次のカードを開く
  await openNextProfile();
}

// ============================================================
// 即時送信ボタン（会話ページに注入）
// ============================================================

async function injectSendNowButton() {
  if (!isConversationPage()) return;
  const chatPath = location.pathname.replace(/\/$/, '');
  const states = await csGet();
  const state = states[chatPath];
  const canSend = state && state.stage >= 1 && state.stage <= 3 && state.active !== false;

  let btn = document.getElementById('hg-send-now');
  if (btn) {
    btn.style.opacity = canSend ? '1' : '0.4';
    return;
  }

  btn = document.createElement('button');
  btn.id = 'hg-send-now';
  btn.textContent = '▶ 今すぐ送信';
  btn.style.cssText = [
    'position:fixed', 'bottom:70px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:99997', 'background:#e74c3c', 'color:#fff',
    'border:none', 'border-radius:20px', 'padding:8px 20px',
    'font-size:13px', 'font-weight:bold', 'cursor:pointer',
    'box-shadow:0 2px 8px rgba(0,0,0,.3)',
    canSend ? '' : 'opacity:0.4;',
  ].join(';');
  document.body.appendChild(btn);
}

function btnStyle(bg) {
  return `flex:1;padding:7px 4px;background:${bg};color:#fff;border:none;border-radius:7px;` +
    `font-size:12px;font-weight:600;cursor:pointer;`;
}

function isConversationPage() {
  return location.pathname.startsWith('/friend/chat/');
}

function isListPage() {
  return location.pathname === '/search/list' || location.pathname.startsWith('/search/list');
}

function isFriendIndexPage() {
  return location.pathname === '/friend/index';
}

function setStatus(msg, color = '#888') {
  const el = document.getElementById('hg-status');
  if (el) { el.textContent = msg; el.style.color = color; }
}

function getConversationHistory() {
  const items = document.querySelectorAll(SEL.messageItem);
  const history = [];
  for (const item of items) {
    const align = item.style.textAlign;
    if (align === 'center') continue; // システム通知をスキップ
    const isMine = align === 'right';
    // タイムスタンプdivを除く本文のみ取得（word-breakが設定されている吹き出しdiv）
    const textEl = item.querySelector('[style*="word-break"]');
    const text = textEl?.textContent?.trim() || item.textContent?.trim();
    if (!text || text.length < 2) continue;
    history.push(`${isMine ? '自分' : '相手'}: ${text}`);
  }
  if (history.length === 0) {
    console.warn('[東カレ] getConversationHistory: メッセージ0件。SEL.messageItemを確認してください');
  }
  return history;
}

function getOpponentSummary() {
  const profileEl = document.querySelector('#userProfile');
  if (profileEl && profileEl.innerText.trim().length > 10) {
    const raw = profileEl.innerText.trim();
    const cut = raw.indexOf('受け取ったバラ');
    const main = cut > 0 ? raw.slice(0, cut) : raw.slice(0, 200);
    // CSSや記号のみの行を除外（名前・年齢・職業のみ残す）
    const cssPattern = /[{};:@#.>~+\[\]]/;
    const lines = main.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.length < 60 && !cssPattern.test(l));
    // 先頭の名前らしき行（漢字/ひらがな/カタカナ）を優先
    const namePattern = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー\s]+\d*歳?$/u;
    const nameLine = lines.find((l) => namePattern.test(l)) || lines[0] || '';
    return lines.slice(0, 4).join('・') || nameLine;
  }
  const msgCount = document.querySelectorAll(SEL.messageItem).length;
  return msgCount ? `${msgCount}往復目` : '';
}

// ============================================================
// 初回メッセージ生成（マッチ直後・会話履歴ゼロ時）
// ============================================================

async function getProfileFromModal() {
  const avatarLink = document.querySelector('a.radius100[onclick*="profile_open"]');
  if (!avatarLink) return '';
  const m = avatarLink.getAttribute('onclick').match(/profile_open\((\d+)\)/);
  if (!m) return '';

  window.dispatchEvent(new CustomEvent('hg-profile-open', { detail: { userId: parseInt(m[1], 10) } }));

  let profileText = '';
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const el = document.querySelector('#userProfile');
    if (el && el.innerText.trim().length > 10) {
      const raw = el.innerText.trim();
      const noisePattern = /^\d+$|^.{0,5}以内$|^.{0,5}前$/;

      // Part1: 自己紹介文（受け取ったバラより前）
      const baraIdx = raw.indexOf('受け取ったバラ');
      const introRaw = baraIdx > 0 ? raw.slice(0, baraIdx) : raw.slice(0, 600);
      const introLines = introRaw.split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !noisePattern.test(l))
        .join('\n');

      // Part2: 基本情報（年齢・職業・年収・居住地など）
      const basicIdx = raw.indexOf('基本情報');
      let basicLines = '';
      if (basicIdx > 0) {
        const basicRaw = raw.slice(basicIdx + '基本情報'.length);
        const endIdx = basicRaw.indexOf('恋愛・結婚');
        const basicSection = endIdx > 0 ? basicRaw.slice(0, endIdx) : basicRaw.slice(0, 300);
        basicLines = basicSection.split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !/^\d+$/.test(l) && !/^学歴・仕事・外見$/.test(l))
          .join(' / ');
      }

      profileText = introLines + (basicLines ? '\n\n【基本情報】' + basicLines : '');
      break;
    }
  }

  window.dispatchEvent(new CustomEvent('hg-profile-close'));
  await sleep(200);
  return profileText;
}

async function submitToTelegram(candidates, type, conversationSummary, calendarSlots, opponentName) {
  const opponentSummary = opponentName || getOpponentSummary();
  const convId = await sha256(location.pathname);
  await chrome.runtime.sendMessage({
    action: 'submitApproval',
    payload: {
      type,
      conversationId: convId,
      targetPathHash: convId,
      opponentSummary,
      candidate1: candidates[0] || '',
      candidate2: candidates[1] || '',
      candidate3: candidates[2] || '',
      calendarSlots: calendarSlots || [],
    },
  });
  chrome.runtime.sendMessage({
    action: 'logEvent',
    payload: { eventType: type === 'apo' ? 'apo_generated' : 'reply_generated' },
  }).catch(() => {});
}

// ============================================================
// マッチ選別 → 一括初回送信
// ============================================================

async function injectMatchSelector() {
  if (!isFriendIndexPage()) return;
  await sleep(400);

  const [states, { selectedForBatch = [] }] = await Promise.all([
    csGet(),
    localGet('selectedForBatch'),
  ]);

  // パネルがなければ作成
  let panel = document.getElementById('hg-match-panel');
  let countEl, genBtn, sendBtn, stopBtn;

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'hg-match-panel';
    panel.style.cssText = [
      'position:fixed', 'top:56px', 'left:0', 'right:0', 'z-index:999999',
      'background:#1a1a2e', 'color:#fff', 'padding:8px 12px',
      'display:flex', 'align-items:center', 'gap:8px',
      'box-shadow:0 2px 8px rgba(0,0,0,.4)',
    ].join(';');

    countEl = document.createElement('span');
    countEl.id = 'hg-match-count';
    countEl.style.cssText = 'font-size:12px;flex:1;';

    genBtn = document.createElement('button');
    genBtn.id = 'hg-match-gen';
    genBtn.textContent = '📝 生成';
    genBtn.style.cssText = [
      'background:#2980b9', 'color:#fff', 'border:none',
      'border-radius:6px', 'padding:6px 10px', 'font-size:12px', 'cursor:pointer',
    ].join(';');

    sendBtn = document.createElement('button');
    sendBtn.id = 'hg-match-send';
    sendBtn.textContent = '⚡ 一斉送信を起動';
    sendBtn.style.cssText = [
      'background:#e74c3c', 'color:#fff', 'border:none',
      'border-radius:6px', 'padding:6px 10px', 'font-size:12px', 'cursor:pointer',
    ].join(';');

    stopBtn = document.createElement('button');
    stopBtn.id = 'hg-match-stop';
    stopBtn.textContent = '⏹ 停止';
    stopBtn.style.cssText = [
      'background:#7f8c8d', 'color:#fff', 'border:none',
      'border-radius:6px', 'padding:6px 10px', 'font-size:12px', 'cursor:pointer',
    ].join(';');

    panel.appendChild(countEl);
    panel.appendChild(genBtn);
    panel.appendChild(sendBtn);
    panel.appendChild(stopBtn);
    document.body.appendChild(panel);

    genBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const { selectedForBatch: sel = [] } = await localGet('selectedForBatch');
      if (sel.length === 0) {
        showNotif('候補生成: チェックボックスで対象を選択してください', '#e67e22', 3000);
        return;
      }

      const job = sel.map((path) => {
        let name = path.split('/').pop();
        document.querySelectorAll('.hg-match-cb').forEach((cb) => {
          if (cb.dataset.chatPath === path) name = cb.dataset.name || name;
        });
        return { path, name, conversationType: 'first', profile: '', lastMessage: '' };
      });

      const { activePatternId = '' } = await localGet('activePatternId');

      let calendarSlots = [];
      try {
        const calRes = await chrome.runtime.sendMessage({ action: 'fetchCalendarSlots' });
        if (Array.isArray(calRes)) calendarSlots = calRes;
        else if (calRes?.slots) calendarSlots = calRes.slots;
      } catch (_) {}

      await localSet({ candidatesJob: { job, calendarSlots, patternId: activePatternId } });
      chrome.runtime.sendMessage({ action: 'openCandidates' });
    });

    sendBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await handleScheduledBatchSend();
    });

    stopBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await Promise.all([
        localSet({ checkQueue: [], batchQueue: [], selectedForBatch: [] }),
      ]);
      // チェックボックスを全解除
      document.querySelectorAll('.hg-match-cb:checked').forEach((cb) => { cb.checked = false; });
      countEl.textContent = `マッチ ${document.querySelectorAll('.hg-match-cb').length}件`;
      showNotif('⏹ 一斉送信を停止しました', '#7f8c8d', 3000);
    });
  } else {
    countEl = document.getElementById('hg-match-count');
    genBtn   = document.getElementById('hg-match-gen');
    sendBtn  = document.getElementById('hg-match-send');
    stopBtn  = document.getElementById('hg-match-stop');
  }

  // 全liを走査（新しく追加されたliも含む）
  const allMatchLis = [...document.querySelectorAll('li')].filter((li) =>
    li.querySelector('a[href*="/friend/chat/"]')
  );

  allMatchLis.forEach((li) => {
    // 既にバッジ/チェックボックスが付いていればスキップ
    if (li.querySelector('.hg-match-cb, .hg-track-badge, .hg-done-badge')) return;

    const a = li.querySelector('a[href*="/friend/chat/"]');
    const raw = li.textContent.trim().replace(/\s+/g, ' ');
    const nameMatch = raw.match(/([^\d]{1,10}\d+歳)/);
    const name = nameMatch ? nameMatch[1].trim() : raw.slice(0, 10);
    const chatPath = new URL(a.href).pathname.replace(/\/$/, '');
    const state = states[chatPath] || { stage: 0 };
    const stage = state.stage || 0;
    const isActive = state.active !== false;

    li.style.display = 'flex';
    li.style.alignItems = 'center';

    if (stage === 0) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'hg-match-cb';
      cb.dataset.chatPath = chatPath;
      cb.dataset.name = name;
      cb.checked = selectedForBatch.includes(chatPath);
      cb.style.cssText = 'width:18px;height:18px;cursor:pointer;margin:0 8px 0 4px;vertical-align:middle;accent-color:#e74c3c;flex-shrink:0;';
      li.insertBefore(cb, li.firstChild);
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', async () => {
        const { selectedForBatch: cur = [] } = await localGet('selectedForBatch');
        const updated = cb.checked
          ? [...new Set([...cur, chatPath])]
          : cur.filter((p) => p !== chatPath);
        await localSet({ selectedForBatch: updated });
        const n = document.querySelectorAll('.hg-match-cb:checked').length;
        countEl.textContent = n > 0 ? `${n}件選択中` : `マッチ ${allMatchLis.length}件`;
      });
    } else if (stage >= 1 && stage <= 3) {
      const apoStatus = state.apoStatus || null;
      let badgeText, badgeColor;
      if (!isActive && apoStatus === 'rejected') {
        badgeText = '🚫拒否';  badgeColor = '#e74c3c';
      } else if (!isActive && apoStatus === 'unclear') {
        badgeText = '❓判別不能'; badgeColor = '#e67e22';
      } else if (isActive) {
        badgeText = '🟢追跡中'; badgeColor = '#27ae60';
      } else {
        badgeText = '⏸一時停止'; badgeColor = '#e67e22';
      }
      const tag = document.createElement('span');
      tag.className = 'hg-track-badge';
      tag.dataset.active = isActive ? '1' : '0';
      tag.textContent = badgeText;
      tag.style.cssText = [
        'font-size:10px', 'cursor:pointer', 'margin:0 8px 0 4px',
        `color:${badgeColor}`, 'flex-shrink:0', 'user-select:none',
      ].join(';');
      tag.title = (!isActive && apoStatus === 'rejected') ? 'タップで追跡再開' : (isActive ? 'タップで一時停止' : 'タップで追跡再開');
      const doToggle = async () => {
        const nowActive = tag.dataset.active === '1';
        const newActive = !nowActive;
        await csUpdate(chatPath, { active: newActive, apoStatus: newActive ? null : (apoStatus || null) });
        tag.dataset.active = newActive ? '1' : '0';
        tag.textContent = newActive ? '🟢追跡中' : '⏸一時停止';
        tag.style.color = newActive ? '#27ae60' : '#e67e22';
        tag.title = newActive ? 'タップで一時停止' : 'タップで追跡再開';
      };
      // touchstart で li の Stimulus/タッチナビゲーションを先に潰す
      tag.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        e.preventDefault();
      }, { passive: false });
      // touchend でトグル実行（touchstart の preventDefault で click は発火しない）
      tag.addEventListener('touchend', (e) => {
        e.stopPropagation();
        e.preventDefault();
        doToggle().catch(() => {});
      }, { passive: false });
      // デスクトップ用 click ハンドラ
      tag.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        doToggle().catch(() => {});
      });
      li.insertBefore(tag, li.firstChild);
    } else {
      const tag = document.createElement('span');
      tag.className = 'hg-done-badge';
      tag.textContent = '✅完了';
      tag.style.cssText = 'font-size:10px;color:#888;margin:0 8px 0 4px;flex-shrink:0;';
      li.insertBefore(tag, li.firstChild);
    }
  });

  // カウント・送信ボタン更新
  const checkedCount = document.querySelectorAll('.hg-match-cb:checked').length;
  countEl.textContent = checkedCount > 0 ? `${checkedCount}件選択中` : `マッチ ${allMatchLis.length}件`;
  const hasCbs = !!document.querySelector('.hg-match-cb');
  if (genBtn)  genBtn.style.display  = hasCbs ? '' : 'none';
  if (sendBtn) sendBtn.style.display = hasCbs ? '' : 'none';
}

// ============================================================
// アポ承認後 固定テンプレート返信
// ============================================================

function getTypedSlots(freeDays, type) {
  const slots = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sortedKeys = Object.keys(freeDays).sort();

  for (const key of sortedKeys) {
    const d = new Date(key);
    if (d < today) continue;
    const types = freeDays[key] || [];
    const m = d.getMonth() + 1;
    const day = d.getDate();

    if (type === 'meal') {
      if (types.includes('lunch'))  slots.push(`${m}/${day}昼`);
      if (types.includes('dinner')) slots.push(`${m}/${day}夜`);
    } else if (type === 'cafe') {
      if (types.includes('cafe'))   slots.push(`${m}/${day}`);
    } else if (type === 'phone') {
      if (types.includes('phone'))  slots.push(`${m}/${day}`);
    }
    if (slots.length >= 4) break;
  }
  return slots.slice(0, 4);
}

function buildApoAcceptedReply(apoType, slots, pattern) {
  const lineUrl    = pattern.lineTemplate || '';
  const dateBlock  = slots.length > 0 ? '\n\n' + slots.join('\n') : '';
  // Part1用: trailing newlines なし（dateBlockの\n\nで間が空く）
  const slotHeader1 = slots.length > 0 ? 'このあたり空いてます！' : '';
  // Part2用: trailing newlines あり（直後にLINE誘導テキストが続く）
  const slotHeader2 = slots.length > 0 ? 'このあたり空いてます！\n\n' : '';

  function buildPart1(p1base) {
    if (p1base.includes('{slot_header}')) {
      return p1base.replace('{slot_header}', slotHeader1).trimEnd() + dateBlock;
    }
    return p1base + dateBlock;
  }

  function buildPart2(p2base) {
    if (p2base.includes('{slot_header}')) {
      const p2 = p2base.replace('{slot_header}', slotHeader2);
      return lineUrl ? p2 + '\n' + lineUrl : p2;
    }
    // 後方互換: slots空の場合、先頭の「空いてます」系行を自動除去
    let p2 = p2base;
    if (slots.length === 0) {
      const lines = p2.split('\n');
      if (lines[0] && lines[0].includes('空いて')) {
        let i = 1;
        while (i < lines.length && lines[i].trim() === '') i++;
        p2 = lines.slice(i).join('\n');
      }
    }
    return lineUrl ? p2 + '\n' + lineUrl : p2;
  }

  if (apoType === 'accepted_meal') {
    const p1base = pattern.apoMealPart1 || 'うれしいです！是非行きましょう。\n楽しみ！';
    const p2base = pattern.apoMealPart2 ||
      'よかったらＬＩＮＥで店決めたり予定たてませんか？\nこれ、ＬＩＮＥの友達追加のやつです。\nラインだと絶対気付けるんですが、このままが良ければ大丈夫ですよ！';
    return [buildPart1(p1base), buildPart2(p2base)];
  }
  if (apoType === 'accepted_cafe') {
    const p1base = pattern.apoCafePart1 || 'うれしいです！是非行きましょう。\n楽しみ！';
    const p2base = pattern.apoCafePart2 ||
      'よかったらＬＩＮＥで店決めたり予定たてませんか？\nラインだと絶対気付けるんですが、このままが良ければ大丈夫ですよ。';
    return [buildPart1(p1base), buildPart2(p2base)];
  }
  if (apoType === 'accepted_phone') {
    const p1base = pattern.apoPhonePart1 || '電話ありです！是非しましょう。';
    const p2base = pattern.apoPhonePart2 ||
      'LINE電話でもいいですか？\nこれLINEの友達追加のやつです。\n\nこのままが良ければそれでもOKです！';
    return [buildPart1(p1base), buildPart2(p2base)];
  }
  return [];
}

// ============================================================
// スケジュール自動バッチ送信
// ============================================================

async function handleScheduledBatchSend() {
  // 前回バッチの残存キューをクリア＋自動プロセスのフラグも消してページ遷移後の誤再起動を防ぐ
  await Promise.all([
    localSet({ checkQueue: [], batchQueue: [] }),
    localSet({ scoutRunning: false, autoLikeRunning: false, footprintRunning: false }),
  ]);
  isScoutRunning = false;
  isRunning = false;
  isFootprintRunning = false;
  const states = await csGet();

  // 返信待ち追跡中会話をcheckQueueに積む（先に処理）
  const replyPaths = Object.entries(states)
    .filter(([, s]) => s.stage >= 1 && s.stage <= 3 && s.active !== false)
    .map(([path]) => path);

  // チェックされた初回送信対象をbatchQueueに積む（後で処理）
  const { selectedForBatch = [] } = await localGet('selectedForBatch');
  const firstQueue = selectedForBatch
    .filter((path) => (states[path]?.stage ?? 0) === 0)
    .map((path) => ({ path, name: path.split('/').pop() }));

  if (replyPaths.length === 0 && firstQueue.length === 0) {
    console.log('[東カレ自動化] 一斉処理: 対象なし');
    showNotif('対象なし\n追跡中の会話がないか\nチェックボックスで対象を選択してください', '#e67e22', 5000);
    return;
  }

  console.log(`[東カレ自動化] 一斉処理開始: 返信確認${replyPaths.length}件 + 初回送信${firstQueue.length}件`);
  showNotif(`⏰ 処理開始 (返信${replyPaths.length}件 + 初回${firstQueue.length}件)`, '#27ae60', 3000);
  await Promise.all([
    localSet({ checkQueue: replyPaths }),
    localSet({ batchQueue: firstQueue }),
  ]);

  const targetPath = replyPaths.length > 0 ? replyPaths[0] : firstQueue[0].path;
  // 友達一覧に該当リンクがあればクリック（Turbo SPA対応）、なければ直接遷移
  const targetLink = document.querySelector(`a[href="${targetPath}"], a[href="https://tokyo-calendar-date.jp${targetPath}"]`);
  if (targetLink) {
    targetLink.click();
  } else {
    location.href = 'https://tokyo-calendar-date.jp' + targetPath;
  }
}


async function batchAdvance() {
  const { batchQueue = [] } = await localGet('batchQueue');
  if (batchQueue.length === 0) return;
  const currentPath = location.pathname.replace(/\/$/, '');
  const remaining = batchQueue.filter((item) => item.path !== currentPath);
  await localSet({ batchQueue: remaining });
  if (remaining.length > 0) {
    setStatus(`次の相手へ移動中... (残り${remaining.length}件)`, '#888');
    setTimeout(() => { location.href = remaining[0].path; }, 2000);
  } else {
    await localSet({ selectedForBatch: [] });
    setStatus('一括送信完了 ✓', '#27ae60');
  }
}

async function sendFirstMessage() {
  setStatus('準備中...', '#888');
  // SW起動確認（30秒タイムアウト対策）
  try {
    await chrome.runtime.sendMessage({ action: 'keepalive' });
  } catch (_) {
    await sleep(2000);
  }
  try {
    const [{ patterns = [] }, { activePatternId }] = await Promise.all([
      localGet('patterns'), localGet('activePatternId'),
    ]);
    const pattern = patterns.find((p) => p.id === activePatternId) || {};
    const chatPath = location.pathname.replace(/\/$/, '');

    // 📝生成フロー: 事前承認済みテキストがあればClaudeを呼ばずにそのまま送信
    const { batchQueue: bq0 = [] } = await localGet('batchQueue');
    const preApproved = bq0.find((q) => q.path === chatPath);
    if (preApproved?.approvedText) {
      const sent = await sendMessageText(preApproved.approvedText);
      if (sent) {
        const opCount = countOpponentMessages();
        await csUpdate(chatPath, { stage: 1, replyCount: opCount, patternId: activePatternId, active: true, isInbound: false });
        setStatus('事前承認メッセージを送信しました ✓', '#27ae60');
      } else {
        setStatus('送信失敗（Console確認）', '#e74c3c');
      }
      await batchAdvance();
      return;
    }

    // スカウト送信済みのユーザーか確認（インバウンドと誤認防止）
    // scoutSentUserIds は profile_open(ID) のプロフィールIDで保存 → DOM から取得して照合
    const avatarBtnSF = document.querySelector('a.radius100[onclick*="profile_open"]');
    const profileIdMatchSF = avatarBtnSF?.getAttribute('onclick')?.match(/profile_open\((\d+)\)/);
    const scoutCheckId = profileIdMatchSF ? profileIdMatchSF[1] : chatPath.split('/').pop();
    const { scoutSentUserIds = [] } = await localGet('scoutSentUserIds');
    if (scoutSentUserIds.includes(scoutCheckId) && countOpponentMessages() > 0) {
      // スカウト返信 → scoutReplyフローに設定して終了（初回メッセージは送らない）
      await csUpdate(chatPath, { stage: 1, replyCount: 0, patternId: activePatternId, active: true, scoutReply: true });
      setStatus('スカウト返信を検出 → 一斉送信でアポ打診します ✓', '#27ae60');
      console.log('[東カレ] sendFirstMessage: スカウト返信検出 → scoutReplyセット', chatPath);
      await sleep(3000);
      await batchAdvance();
      return;
    }

    // 相手からすでにメッセージが届いている場合はインバウンド用プロンプトを使用
    const hasInbound = countOpponentMessages() > 0;
    const prompt = pickVariant(hasInbound
      ? (pattern.msg1InboundTemplate || pattern.msg1Template || '')
      : (pattern.msg1Template || ''));

    if (!prompt) {
      showNotif('❌ ① 初回メッセージのプロンプトが未設定です\n詳細設定 → ① 初回メッセージ欄を入力してください', '#e74c3c');
      setStatus('プロンプト未設定', '#e74c3c');
      await batchAdvance();
      return;
    }

    setStatus('Claude生成中...', '#888');
    const opponentSummary = getOpponentSummary();
    const conversationHistory = hasInbound ? getConversationHistory().slice(-10).join('\n') : '';
    const generated = await generateFromPrompt(prompt, conversationHistory, opponentSummary);

    if (!generated) {
      showNotif('❌ Claude生成失敗\nGAS URL/Tokenと接続を確認してください', '#e74c3c');
      setStatus('生成失敗', '#e74c3c');
      await batchAdvance();
      return;
    }

    const sent = await sendMessageText(generated);
    if (sent) {
      // replyCountを現在の相手メッセージ数に合わせることで、直後のexecuteStageが誤発火しないようにする
      const currentOpponentCount = countOpponentMessages();
      console.log('[東カレ] sendFirstMessage完了: hasInbound=' + hasInbound + ', replyCount設定値=' + currentOpponentCount + ', path=' + chatPath);
      // isInbound フラグを保存（一斉送信バッチがアポ打診に inboundApoTemplate を使うために参照）
      await csUpdate(chatPath, { stage: 1, replyCount: currentOpponentCount, patternId: activePatternId, active: true, isInbound: hasInbound });
      if (hasInbound) {
        // インバウンドの場合: 15秒後にアポ打診を自動送信
        const capturedPath = chatPath;
        setTimeout(async () => {
          try {
            if (!isConversationPage()) return;
            if (location.pathname.replace(/\/$/, '') !== capturedPath) return;
            const states = await csGet();
            const st = states[capturedPath];
            if (!st || st.stage !== 1 || !st.isInbound) return; // 既に処理済み
            const [{ patterns: pats2 }, { activePatternId: apid2 }] = await Promise.all([
              localGet('patterns'), localGet('activePatternId'),
            ]);
            const pat2 = pats2.find((p) => p.id === (st.patternId || apid2)) || {};
            const hist2 = getConversationHistory().slice(-20).join('\n');
            setStatus('アポ打診中（15秒タイマー）...', '#888');
            const ok2 = await sendInboundApoMessage(pat2, hist2);
            if (ok2) {
              await csUpdate(capturedPath, { stage: 3, replyCount: countOpponentMessages(), isInbound: false });
              setStatus('インバウンドアポ打診 ✓', '#27ae60');
              console.log('[東カレ] インバウンドアポ打診完了（15秒タイマー）', capturedPath);
            } else {
              setStatus('③ アポ打診（インバウンド用）テンプレート未設定', '#e74c3c');
              console.warn('[東カレ] inboundApoTemplate未設定', capturedPath);
            }
          } catch (err) {
            console.warn('[東カレ] インバウンドアポタイマーエラー:', err);
          }
        }, 15 * 1000);
        setStatus('返信送信済み ✓ 15秒後にアポ打診します ⏱', '#27ae60');
      } else {
        setStatus('初回メッセージを送信しました ✓', '#27ae60');
      }
    } else {
      showNotif('❌ 送信失敗: 入力欄または送信ボタンが見つかりません\nDevToolsのConsoleを確認してください', '#e74c3c');
      setStatus('送信失敗（Console確認）', '#e74c3c');
    }
    await sleep(3000);
    await batchAdvance();
  } catch (err) {
    showNotif('❌ エラー: ' + err.message, '#e74c3c');
    setStatus('エラー: ' + err.message, '#e74c3c');
    await sleep(3000);
    await batchAdvance();
  }
}

async function generateReply() {
  setStatus('生成中...', '#888');
  document.getElementById('hg-candidates').style.display = 'none';

  const summary = getConversationHistory().slice(-20).join('\n');
  if (!summary) { setStatus('会話が見つかりません', '#e74c3c'); return; }

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'generateCandidates',
      mode: 'reply',
      conversationSummary: summary,
    });
    if (!result) throw new Error('Service Workerから応答がありません');
    if (result.error) throw new Error(result.error);
    renderCandidates(result.candidates);
    await submitToTelegram(result.candidates, 'reply', summary);
    setStatus('Telegramに送信しました。承認をお待ちください ✓', '#27ae60');
  } catch (err) {
    setStatus('エラー: ' + err.message, '#e74c3c');
  }
}

async function generateApo() {
  setStatus('カレンダー確認中...', '#888');
  document.getElementById('hg-candidates').style.display = 'none';

  try {
    const calResult = await chrome.runtime.sendMessage({ action: 'fetchCalendarSlots' });
    const slots = calResult?.slots || [];
    setStatus('アポ文生成中...', '#888');

    const summary = getConversationHistory().slice(-20).join('\n');
    const result = await chrome.runtime.sendMessage({
      action: 'generateCandidates',
      mode: 'apo',
      conversationSummary: summary,
      calendarSlots: slots,
    });
    if (!result) throw new Error('Service Workerから応答がありません');
    if (result.error) throw new Error(result.error);
    renderCandidates(result.candidates);
    await submitToTelegram(result.candidates, 'apo', summary, slots);
    setStatus('Telegramに送信しました。承認をお待ちください ✓', '#27ae60');
  } catch (err) {
    setStatus('エラー: ' + err.message, '#e74c3c');
  }
}

function renderCandidates(candidates) {
  const area = document.getElementById('hg-candidates');
  if (!area) return;
  area.style.display = 'block';

  area.innerHTML = candidates.map((text, i) => `
    <div style="background:#f8f9fa;border-radius:8px;padding:8px 10px;margin-bottom:6px;">
      <div style="font-size:11px;color:#888;margin-bottom:3px;">候補${i + 1}</div>
      <div style="font-size:13px;line-height:1.5;">${escapeHtml(text)}</div>
      <div style="margin-top:6px;">
        <button data-idx="${i}" class="hg-copy-btn" style="${btnStyle('#555')}font-size:11px;padding:4px 8px;">コピー</button>
      </div>
    </div>
  `).join('');

  area.querySelectorAll('.hg-copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = candidates[parseInt(btn.dataset.idx, 10)];
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✓ コピー済み';
        setTimeout(() => { btn.textContent = 'コピー'; }, 2000);
      });
    });
  });
}

// ============================================================
// 会話優先度スコアリング（会話リストページ）
// ============================================================

function calcScore(item) {
  let score = 0;
  const text = item.textContent || '';

  // メッセージ量
  if (text.length > 150) score += 2;
  else if (text.length > 80) score += 1;

  // デートキーワード
  const keywords = ['食事', 'ランチ', 'ディナー', '会い', '都合', '日程', 'どこか', '行きましょう', '行きたい'];
  for (const kw of keywords) {
    if (text.includes(kw)) { score += 2; break; }
  }

  // 未読バッジ（要返信）
  const badge = item.querySelector('[class*="unread"], [class*="badge"], [class*="new"]');
  if (badge && badge.textContent.trim()) score += 3;

  return Math.min(score, 10);
}

function injectPriorityScores() {
  const items = document.querySelectorAll(SEL.convListItem);
  if (!items.length) return;
  for (const item of items) {
    if (item.querySelector('.hg-score-badge')) continue;
    const score = calcScore(item);
    if (score === 0) continue;
    const badge = document.createElement('span');
    badge.className = 'hg-score-badge';
    const color = score >= 7 ? '#c0392b' : score >= 4 ? '#e67e22' : '#27ae60';
    badge.style.cssText = [
      'position:absolute', 'top:6px', 'right:6px', 'z-index:100',
      'background:' + color, 'color:#fff',
      'border-radius:10px', 'padding:2px 7px',
      'font-size:10px', 'font-weight:bold',
    ].join(';');
    badge.textContent = '★' + score;
    const s = item.style.position;
    if (!s || s === 'static') item.style.position = 'relative';
    item.appendChild(badge);
  }
}

function showNotif(msg, color = '#27ae60', duration = 5000) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
    `background:${color}`, 'color:#fff', 'padding:12px 16px',
    'border-radius:8px', 'z-index:9999999', 'font-size:13px', 'line-height:1.5',
    'white-space:pre-wrap', 'box-shadow:0 3px 12px rgba(0,0,0,.3)',
    'max-width:360px', 'text-align:center',
  ].join(';');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================================
// 承認済みアイテムの受信（background.jsから）
// ============================================================

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'approvedItems') handleApprovedItems(message.items);
  if (message.action === 'startLike') {
    if (!isListPage()) {
      localSet({ autoLikeRunning: true }).catch(() => {});
      location.href = 'https://tokyo-calendar-date.jp/search/list';
    } else {
      startAutoLike().catch((e) => console.error('[東カレ自動化] 起動エラー:', e));
    }
  }
  if (message.action === 'stopLike')     stopAll('ポップアップから停止');
  if (message.action === 'startFootprint') startAutoFootprint().catch(() => {});
  if (message.action === 'stopFootprint')  stopAutoFootprint('ポップアップから停止');
  if (message.action === 'startScout')       startAutoScout().catch(() => {});
  if (message.action === 'stopScout')        stopAutoScout('ポップアップから停止');
  if (message.action === 'startBatchSend')   handleScheduledBatchSend().catch(() => {});
  if (message.action === 'stopBatchSend') {
    Promise.all([
      localSet({ checkQueue: [] }),
      localSet({ batchQueue: [] }),
    ]).then(() => {
      showNotif('⏹ 一斉送信を停止しました', '#e67e22', 3000);
    }).catch(() => {});
  }
  if (message.action === 'checkReplies') {
    if (isConversationPage()) {
      executeStageForCurrentChat()
        .then(() => advanceCheckQueue())
        .catch(() => {});
    } else {
      // 追跡中の会話一覧を巡回するキューを作成（古いbatchQueueもクリアして競合防止）
      (async () => {
        if (isRunning) return;
        const states = await csGet();
        const paths = Object.entries(states)
          .filter(([, s]) => s.stage >= 1 && s.stage <= 3 && s.active !== false)
          .map(([path]) => path);
        if (paths.length === 0) return;
        await Promise.all([localSet({ checkQueue: paths }), localSet({ batchQueue: [] })]);
        location.href = paths[0];
      })().catch(() => {});
    }
  }
});

function handleApprovedItems(items) {
  for (const item of items) {
    handleOneApprovedItem(item);
  }
}

async function handleOneApprovedItem(item) {
  const pasted = await pasteToInputBox(item);
  if (pasted) {
    await sleep(300);
    document.querySelector(SEL.sendBtn)?.click();
  }
  showApprovedNotification(item, pasted);

  chrome.runtime.sendMessage({
    action: 'updateApproval',
    payload: { id: item.id, status: 'executed', executionResult: 'success' },
  }).catch(() => {});

  const evtType = item.type === 'apo' ? 'apo_approved' : 'reply_approved';
  chrome.runtime.sendMessage({ action: 'logEvent', payload: { eventType: evtType } }).catch(() => {});
}

async function pasteToInputBox(item) {
  const text = item.chosen_candidate || '';
  if (!text || !isConversationPage()) return false;

  // 現在ページと承認アイテムのページが一致するか確認
  const currentHash = await sha256(location.pathname);
  if (item.target_path_hash && item.target_path_hash !== currentHash) return false;

  const input = document.querySelector(SEL.inputBox);
  if (!input) return false;

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  nativeSetter.call(input, text);
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.focus();
  await sleep(400);
  if (input.value !== text) {
    nativeSetter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
  }
  return input.value === text;
}

function showApprovedNotification(item, pasted = false) {
  const notif = document.createElement('div');
  const text = item.chosen_candidate || '';
  notif.style.cssText = [
    'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
    'background:#27ae60', 'color:#fff', 'padding:10px 14px',
    'border-radius:8px', 'z-index:9999999', 'font-size:13px',
    'box-shadow:0 3px 12px rgba(0,0,0,.2)', 'max-width:340px',
  ].join(';');
  const pasteNote = pasted
    ? '<br><small style="opacity:.85">↳ 自動送信しました</small>'
    : '';
  notif.innerHTML = `✓ 承認済み:<br><small>${escapeHtml(text.substring(0, 60))}${text.length > 60 ? '...' : ''}</small>${pasteNote}`;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 5000);
}

// ============================================================
// キャプチャフェーズ クリックガード
// 東カレはキャプチャフェーズでナビゲーションをハンドルするため、
// バブルフェーズの stopPropagation では防げない。
// window レベルのキャプチャフェーズでインターセプトし、
// 拡張UI要素クリック時は東カレのハンドラを完全にブロックする。
// ============================================================

function initExtensionClickGuard() {
  if (window.__hgClickGuard) return;
  window.__hgClickGuard = true;
  window.addEventListener('click', (e) => {
    const withinExt = e.target.closest(
      '#hg-match-panel, #hg-send-now, #hg-float-stop, #hg-reply-panel'
    );
    if (!withinExt) return;
    e.stopPropagation();
    e.stopImmediatePropagation();

    // 今すぐ送信
    if (e.target.closest('#hg-send-now')) {
      if (parseFloat(e.target.closest('#hg-send-now').style.opacity) < 1) {
        showNotif('このチャットは追跡対象外です', '#e67e22', 2000);
        return;
      }
      isSendNowPressed = true;
      executeStageForCurrentChat().finally(() => { isSendNowPressed = false; });
      return;
    }

    // 一斉送信を起動
    if (e.target.closest('#hg-match-send')) {
      handleScheduledBatchSend().catch(() => {});
      return;
    }

    // 停止
    if (e.target.closest('#hg-match-stop')) {
      Promise.all([localSet({ checkQueue: [], batchQueue: [], selectedForBatch: [] })])
        .then(() => {
          document.querySelectorAll('.hg-match-cb:checked').forEach((cb) => { cb.checked = false; });
          const ce = document.getElementById('hg-match-count');
          if (ce) ce.textContent = `マッチ ${document.querySelectorAll('.hg-match-cb').length}件`;
          showNotif('⏹ 一斉送信を停止しました', '#7f8c8d', 3000);
        }).catch(() => {});
      return;
    }

    // 追跡バッジのトグル
    const badge = e.target.closest('.hg-track-badge');
    if (badge) {
      const a = badge.closest('li')?.querySelector('a[href*="/friend/chat/"]');
      if (a) {
        const badgeChatPath = new URL(a.href).pathname.replace(/\/$/, '');
        const newActive = badge.dataset.active !== '1';
        csUpdate(badgeChatPath, { active: newActive, apoStatus: newActive ? null : undefined })
          .then(() => {
            badge.dataset.active = newActive ? '1' : '0';
            badge.textContent = newActive ? '🟢追跡中' : '⏸一時停止';
            badge.style.color = newActive ? '#27ae60' : '#e67e22';
            badge.title = newActive ? 'タップで一時停止' : 'タップで追跡再開';
          }).catch(() => {});
      }
      return;
    }

    // フローティング停止ボタン — 既存リスナーが発火しないので直接呼び出す
    if (e.target.closest('#hg-float-stop')) {
      stopAll();
      return;
    }
    // チェックボックス — change イベントはブラウザデフォルト動作で発火するので放置
  }, true); // capture phase = 東カレより先にフック
}

// ============================================================
// 初期化
// ============================================================

async function init() {
  initExtensionClickGuard();
  injectFloatingStopButton();
  if (isListPage()) setTimeout(injectPriorityScores, 1000);
  if (isFriendIndexPage()) {
    injectMatchSelector();
  }

  // バッチ処理中に想定外ページ（/search/list など）へ飛んでしまった場合、
  // キューが残っていれば正しいチャットへ自動リダイレクト
  if (!isConversationPage() && !isFriendIndexPage()) {
    const [{ batchQueue: bqInit = [] }, { checkQueue: cqInit = [] }] = await Promise.all([
      localGet('batchQueue'),
      localGet('checkQueue'),
    ]);
    if (bqInit.length > 0) {
      console.log('[東カレ] 想定外ページ: batchQueue残存 → リダイレクト', bqInit[0].path);
      location.href = 'https://tokyo-calendar-date.jp' + bqInit[0].path;
      return;
    }
    if (cqInit.length > 0) {
      console.log('[東カレ] 想定外ページ: checkQueue残存 → リダイレクト', cqInit[0]);
      location.href = 'https://tokyo-calendar-date.jp' + cqInit[0];
      return;
    }
  }

  if (isConversationPage()) {
    const chatPath = location.pathname.replace(/\/$/, '');
    const [{ batchQueue = [] }, { checkQueue = [] }, states] = await Promise.all([
      localGet('batchQueue'),
      localGet('checkQueue'),
      csGet(),
    ]);
    let state = states[chatPath];

    // 未追跡チャットへの手動アクセス時のみスカウト返信を検出
    if ((!state?.stage) && !batchQueue.some((i) => i.path === chatPath) && !checkQueue.includes(chatPath)) {
      const detected = await detectAndSetScoutReply(chatPath);
      if (detected) state = (await csGet())[chatPath];
    }

    if (batchQueue.some((item) => item.path === chatPath)) {
      setTimeout(() => sendFirstMessage(), 1800);
    } else if (checkQueue.includes(chatPath)) {
      // Hotwire/Stimulus完全初期化を待つため2500msに延長
      setTimeout(() => {
        executeStageForCurrentChat().then(() => advanceCheckQueue()).catch(() => {});
      }, 2500);
    }
    // ※ 手動アクセス時は executeStageForCurrentChat() を呼ばない
    // 送信は 一斉送信ボタン（checkQueue経由）または 今すぐ送信ボタン のみ

    injectSendNowButton().catch(() => {});
  }

  // ページ遷移後も自動いいね・足跡・スカウトを継続
  const { autoLikeRunning, footprintRunning, scoutRunning } = await localGet(['autoLikeRunning', 'footprintRunning', 'scoutRunning']);
  if (autoLikeRunning && !isRunning) {
    console.log('[東カレ自動化] 自動いいね再開');
    startAutoLike().catch(() => {});
  }
  if (footprintRunning && !isFootprintRunning) {
    console.log('[東カレ自動化] 足跡モード再開');
    startAutoFootprint().catch(() => {});
  }
  if (scoutRunning && !isScoutRunning) {
    console.log('[東カレ自動化] 非マッチ送信再開');
    startAutoScout().catch(() => {});
  }

  // SPA対応: URL変化を監視
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isLoginPage() && isRunning) stopAll('ログインページへリダイレクトされました');
      setTimeout(() => {
        if (isConversationPage()) injectSendNowButton().catch(() => {});
        if (isListPage()) injectPriorityScores();
        if (isFriendIndexPage()) injectMatchSelector();
      }, 800);
    } else if (isListPage()) {
      injectPriorityScores();
    } else if (isFriendIndexPage()) {
      clearTimeout(matchInjectTimer);
      matchInjectTimer = setTimeout(() => injectMatchSelector(), 600);
    }
  }).observe(document.body, { subtree: true, childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('[東カレ自動化] Content script 読み込み完了');