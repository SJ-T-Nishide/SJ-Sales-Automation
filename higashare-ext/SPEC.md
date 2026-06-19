# 東カレデート自動化 Chrome拡張 — 仕様書

**最終更新**: 2026-06-16  
**対象ファイル**: `higashare-ext/content.js`, `popup.js`, `popup.html`, `background.js`  
**更新方法**: このファイルを直接編集する。AIはこのファイルを読んで仕様変更を認識する。チャットで決定した事項は「## 変更履歴」セクションに追記すること。

---

## 目次

1. [アーキテクチャ概要](#1-アーキテクチャ概要)
2. [ステージシステム（会話状態機械）](#2-ステージシステム)
3. [localStorage スキーマ](#3-localstorage-スキーマ)
4. [DOM セレクター](#4-dom-セレクター)
5. [バッチ送信アーキテクチャ](#5-バッチ送信アーキテクチャ)
6. [アポ承認判定フロー（最重要）](#6-アポ承認判定フロー)
7. [インバウンドフロー（相手が先にメッセージを送った場合）](#7-インバウンドフロー)
8. [スカウト返信フロー（非マッチDM経由）](#8-スカウト返信フロー)
9. [テンプレートシステム](#9-テンプレートシステム)
10. [パターン設定スキーマ](#10-パターン設定スキーマ)
11. [自動モード一覧](#11-自動モード一覧)
12. [Chrome MV3 対応事項](#12-chrome-mv3-対応事項)
13. [送信トリガーの設計（最重要セーフティ）](#13-送信トリガーの設計)
14. [今後の実装予定](#14-今後の実装予定)
15. [変更履歴](#15-変更履歴)

---

## 1. アーキテクチャ概要

### ファイル構成

```
higashare-ext/
├── content.js      メインロジック（約1970行）。東カレの全ページに注入
├── background.js   Service Worker。Claude API呼び出し、GAS連携
├── popup.js        拡張機能ポップアップのロジック
├── popup.html      設定UI
└── manifest.json   Manifest V3
```

### 処理の流れ

```
東カレページ読み込み
  └─ content.js 注入 → init()
       ├─ 友達一覧ページ (/friend/index)
       │    └─ injectMatchSelector()
       │         ├─ stage=0: チェックボックス注入
       │         ├─ stage=1~3: 「🟢追跡中」バッジ注入（タップでON/OFF切替）
       │         ├─ stage=4: 「✅完了」バッジ注入
       │         ├─ ⚡「一斉送信を起動」ボタン → handleScheduledBatchSend()
       │         └─ ⏹「停止」ボタン → checkQueue/batchQueue/selectedForBatch クリア
       ├─ 会話ページ (/friend/chat/N)
       │    ├─ batchQueueに含まれる → 1800ms後に sendFirstMessage()
       │    ├─ checkQueueに含まれる → 2500ms後に executeStageForCurrentChat() → advanceCheckQueue()
       │    ├─ 手動アクセス（未追跡）→ detectAndSetScoutReply() のみ（送信なし）
       │    ├─ injectSendNowButton() → 「▶ 今すぐ送信」ボタン注入（bottom:70px固定）
       │    └─ injectReplyPanel() → 返信候補生成UI
       └─ 検索リストページ (/search/list)
            ├─ startAutoLike()  自動いいね
            ├─ startAutoFootprint()  自動足跡
            └─ startAutoScout()  自動スカウト
```

### background.js との通信

content.js → background.js: `chrome.runtime.sendMessage()` **コールバック形式必須**

Promise形式はMV3で "message channel closed" エラーを正常にキャッチできないため使用禁止。

主要アクション:
| アクション | 内容 |
|---|---|
| `generateCandidates` | Claude APIでメッセージ候補生成 |
| `judgeApo` | Claude APIでアポ承諾/拒否判定 |
| `extractName` | Claude APIで相手名前抽出 |
| `logEvent` | GASへのイベントログ |
| `fetchCalendarSlots` | GASから空き日程取得 |
| `startBatchSend` | background.js経由のバッチ起動 |
| `keepalive` | Service Worker 起動確認 |

---

## 2. ステージシステム

### ステージ定義

| stage | 意味 | 遷移条件 |
|---|---|---|
| 0 | 未送信（新規マッチ） | チェックボックス → 一斉送信 → sendFirstMessage() |
| 1 | 初回メッセージ送信済み | 相手返信 N 回 → stage 2 または 3 へ |
| 2 | 2通目送信済み | 相手返信が apoTriggerCount 以上 → stage 3 へ |
| 3 | アポ打診送信済み | 相手返信あり → Claude 判定 → stage 4 へ |
| 4 | LINE URL 送信済み（完了） | 追跡終了 |

### executeStageForCurrentChat() の処理フロー（全分岐）

```
executeStageForCurrentChat() 呼び出し
  ↓
【前処理】settings/patterns/checkQueue 取得
  sendApoNow = checkQueue.includes(chatPath) || isSendNowPressed
  ↓
【ガード1】state が存在しない、または active:false → return
  ↓
【pre-guard: apoJudgment 保存済み】
  stage=3 && state.apoJudgment が存在する場合（最優先）
  ├─ sendApoNow=true → sendApoAccepted() → stage 4
  └─ sendApoNow=false → 「✅ アポ承認済み・送信待ち」表示 → return
  ↓
【opponentCount 取得】countOpponentMessages()
  ↓
【ガード2: 絶対安全ガード】
  opponentCount === 0 → console.warn + 「返信待ち（相手未返信）」表示 → return
  ※ これにより返信ゼロの相手へ追加メッセージを送ることを物理的に防止
  ↓
【ガード3: 新規返信なし】
  opponentCount <= state.replyCount → 「新しい返信待ち（相手の返信後に自動送信）」表示 → return
  ↓
【effectiveApoTrigger 計算】
  effectiveApoTrigger = Math.max(1, pattern.apoTriggerCount || 3)
  ※ apoTriggerCount=0 を設定しても最低1として動作（0以下バグ防止）
  ↓
【インバウンド分岐】
  stage=1 && state.isInbound && sendApoNow → sendInboundApoMessage() → stage 3 → return
  ※ inboundApoTemplate を使用（Claude生成なし・テンプレート直送）
  ↓
【スカウト返信分岐】
  state.scoutReply === true → sendApoMessages(apoMsg1+apoMsg2) → stage 3 → return
  ※ opponentCount===0 ガードを通過済みなので ここでは opponentCount チェック不要
  ↓
【stage 1 処理】
  stagePrompt = sanitizeTemplate(pattern.msg2Template)
  nextStage = 2
  └─ msg2Template 未設定 かつ opponentCount >= effectiveApoTrigger
       → sendApoMessages() → stage 3 → return
  ↓
【stage 2 処理】
  opponentCount >= effectiveApoTrigger
  → sendApoMessages() → stage 3 → return
  ↓
【stage 3 処理】
  judgeApoReply(会話履歴直近20件) → 判定結果
  'accepted_*' → apoJudgment 保存 → sendApoNow=true なら sendApoAccepted()
  'rejected'   → active:false、apoStatus:'rejected'
  'unclear'    → active:false、apoStatus:'unclear'
  'error'      → active:true 維持（次回バッチで再試行）
  ↓
【msg2 または 返信生成・送信】（stage 1/2）
  generateFromPrompt(stagePrompt, conversationHistory, opponentSummary)
  → sendMessageText(generated)
  → csUpdate({ stage: nextStage, replyCount: opponentCount })
```

### sendFirstMessage() の処理フロー（stage 0）

```
sendFirstMessage() 呼び出し（batchQueueの会話ページで init() から 1800ms後に実行）
  ↓
keepalive 送信（Service Worker 起動確認）
  ↓
patterns / activePatternId / chatPath 取得
  ↓
【スカウト返信チェック】
  avatarBtn = a.radius100[onclick*="profile_open"]
  profileId = profile_open(ID) から抽出 → DOM取得不可時はURLの末尾IDでフォールバック
  scoutSentUserIds.includes(profileId) && opponentCount > 0
  ├─ true → csUpdate({ stage:1, scoutReply:true }) → scoutReplyフロー確定 → batchAdvance() → return
  └─ false → 通常フローへ
  ↓
【インバウンド判定】
  hasInbound = countOpponentMessages() > 0
  ├─ true  → prompt = msg1InboundTemplate（または msg1Template フォールバック）
  └─ false → prompt = msg1Template
  ↓
【プロンプト未設定チェック】
  prompt なし → エラー通知 → batchAdvance() → return
  ↓
Claude生成: generateFromPrompt(prompt, 会話履歴[last10], opponentSummary)
  ↓
sendMessageText(generated)
  ↓
csUpdate({ stage:1, replyCount:currentOpponentCount, patternId, active:true, isInbound:hasInbound })
  ↓
【インバウンド分岐】
  hasInbound = true
  ├─ 15秒後タイマーをセット
  │    条件: 同ページに留まる && stage===1 && isInbound===true
  │    実行: sendInboundApoMessage() → csUpdate({ stage:3, isInbound:false })
  └─ ステータス「返信送信済み ✓ 15秒後にアポ打診します ⏱」
  hasInbound = false → ステータス「初回メッセージを送信しました ✓」
  ↓
sleep(3000) → batchAdvance()
```

---

## 3. localStorage スキーマ

### `conversationStates`（メインデータ）

```javascript
{
  "/friend/chat/12345678": {
    stage: 3,              // 0-4
    replyCount: 5,         // 最後に処理した時点の相手メッセージ数
                           // opponentCount > replyCount が次の処理実行条件
    patternId: "abc123",   // 使用するパターンID（nullなら activePatternId を使用）
    active: true,          // false = 自動処理停止
    apoStatus: "accepted", // 'accepted' | 'rejected' | 'unclear' | undefined
    apoJudgment: "accepted_meal",
                           // 'accepted_meal' | 'accepted_cafe' | 'accepted_phone' | null
                           // stage=3で承認検知後に保存。送信完了でnullに戻す
    scoutReply: false,     // 非マッチDMへの返信フラグ（trueならアポ直送）
    isInbound: false,      // 相手が先にメッセージを送ってきたフラグ
                           // sendFirstMessage()でセット、アポ打診完了でfalseに戻す
  }
}
```

**重要**: `replyCount` は「最後に自動処理した時点の相手メッセージ数」。  
`opponentCount > replyCount` が次の処理実行の条件。

### その他のキー

| キー | 型 | 意味 |
|---|---|---|
| `patterns` | Array | パターン設定の配列（後述） |
| `activePatternId` | String | デフォルトで使用するパターンID |
| `checkQueue` | Array\<String\> | 返信確認中の会話パス（stage 1-3、一斉送信で積まれる） |
| `batchQueue` | Array\<{path,name}\> | 初回送信待ちの会話（stage 0、一斉送信で積まれる） |
| `selectedForBatch` | Array\<String\> | チェックボックスで選択済みの会話パス（永続保存） |
| `freeDays` | Object | 空き日程 `{ "2026-06-20": ["lunch","dinner"] }` |
| `messageHashes` | Array\<String\> | 送信済みメッセージのSHA256ハッシュ（重複防止） |
| `scoutSentUserIds` | Array\<String\> | 非マッチDM送信先のプロフィールID（profile_open ID） |
| `autoLikeRunning` | Boolean | 自動いいね実行中フラグ |
| `scoutRunning` | Boolean | 自動スカウト実行中フラグ |
| `footprintRunning` | Boolean | 自動足跡実行中フラグ |
| `settings` | Object | GAS URL / GAS Token |

**廃止済み**（background.js 起動時にクリア）:
- `inboundApoPending`: 旧インバウンドアポ予約。3分タイマー廃止に伴い削除

---

## 4. DOM セレクター

### 確認済み（DevToolsで検証）

```javascript
SEL.messageItem = 'li[id^="message_"]'
// チャット画面: ul#messages > li[id^="message_XXXXXXXX"]

SEL.myMessage = 'li[id^="message_"][style*="text-align:right"]'
// inline style で判別:
//   text-align:right  → 自分のメッセージ
//   text-align:left   → 相手のメッセージ
//   text-align:center → システム通知（マッチング承認など）→ スキップ

SEL.inputBox = 'textarea#message_mb4_content'
SEL.sendBtn  = 'input[type="submit"][name="commit"]'

// プロフィールIDの取得（スカウト返信判定に使用）
// チャットページのアバターボタン
avatarBtn = 'a.radius100[onclick*="profile_open"]'
// → onclick="profile_open(12345678)" から数値IDを抽出
```

### メッセージ本文の取得

```javascript
const textEl = item.querySelector('[style*="word-break"]');
const text = textEl?.textContent?.trim() || item.textContent?.trim();
```

### 相手メッセージ数のカウント（countOpponentMessages）

```javascript
function countOpponentMessages() {
  return [...document.querySelectorAll('li[id^="message_"]')]
    .filter((el) => {
      if (el.style.textAlign !== 'left') return false; // text-align:left = 相手のみ
      const rect = el.getBoundingClientRect();
      return rect.width > 0; // 非表示要素を除外
    }).length;
}
```

**注意**: `text-align:center`（システム通知）は `left` でないため自動除外される。

### 会話履歴の取得（getConversationHistory）

```javascript
function getConversationHistory() {
  const items = document.querySelectorAll(SEL.messageItem);
  const history = [];
  for (const item of items) {
    const text = item.querySelector('[style*="word-break"]')?.textContent?.trim()
               || item.textContent?.trim();
    if (!text || text.length < 2) continue;
    const rect = item.getBoundingClientRect();
    if (rect.width === 0) continue;
    const isMine = item.style.textAlign === 'right';
    history.push(`${isMine ? '自分' : '相手'}: ${text}`);
  }
  if (history.length === 0) {
    console.warn('[東カレ] getConversationHistory: 0件 → SEL.messageItem を確認');
  }
  return history;
}
```

---

## 5. バッチ送信アーキテクチャ

### 送信トリガー（3種類のみ・これ以外の自動送信は存在しない）

| トリガー | 説明 |
|---|---|
| **⚡ 一斉送信を起動**（友達一覧） | `handleScheduledBatchSend()` を呼ぶ |
| **▶ 今すぐ送信**（チャットページ） | `isSendNowPressed=true` → `executeStageForCurrentChat()` |
| **batch_HH_MM アラーム**（自動スケジュール） | 詳細設定で時刻を登録した場合のみ発火 → `startBatchSend` メッセージ → `handleScheduledBatchSend()` |

**時刻未登録 → アラーム未生成 → 自動送信なし（この設計は不変）**

### 2種類のキュー

**checkQueue（返信確認キュー）**:
- stage 1〜3 の全追跡中会話を格納
- 処理順: 格納順（古い会話から）
- 各会話を順次訪問 → `executeStageForCurrentChat()` → `advanceCheckQueue()` → 次へ

**batchQueue（初回送信キュー）**:
- stage 0 の選択済み会話（selectedForBatch）を格納
- checkQueue 完了後に処理開始
- 各会話を訪問 → `sendFirstMessage()` → `batchAdvance()` → 次へ

### 処理順序（重要）

**checkQueue（追跡中 stage1-3）→ 完了後 → batchQueue（チェック済み stage0）**

- 一斉送信は **両キューを必ずセット** する（片方が空でも問題なし）
- `advanceCheckQueue()` がcheckQueue完了後にbatchQueueへ継続する
- `batchAdvance()` がbatchQueue完了後に「一斉送信完了」を表示

### handleScheduledBatchSend() の処理

```javascript
async function handleScheduledBatchSend() {
  // 前回バッチのキュー残留クリア
  await Promise.all([
    localSet({ checkQueue: [], batchQueue: [] }),
    localSet({ scoutRunning: false, autoLikeRunning: false, footprintRunning: false }),
  ]);

  // checkQueue: 全 stage 1-3 の active な会話（必ずセット）
  const replyPaths = Object.entries(states)
    .filter(([, s]) => s.stage >= 1 && s.stage <= 3 && s.active !== false)
    .map(([path]) => path);

  // batchQueue: selectedForBatch の中で stage=0 のもの（必ずセット）
  const firstQueue = selectedForBatch
    .filter((path) => (states[path]?.stage ?? 0) === 0)
    .map((path) => ({ path, name: path.split('/').pop() }));

  // 対象なし → 通知して終了
  if (replyPaths.length === 0 && firstQueue.length === 0) { ... return; }

  // 両キューをセット（どちらが空でも可）
  await Promise.all([
    localSet({ checkQueue: replyPaths }),
    localSet({ batchQueue: firstQueue }),
  ]);

  // checkQueueが空の場合はbatchQueueから開始
  const targetPath = replyPaths.length > 0 ? replyPaths[0] : firstQueue[0].path;
  navigateTo(targetPath);
}
```

### ナビゲーションヘルパー（navigateTo）

東カレはTurbo SPAのため `location.href` 直接代入が無視される場合がある。

```javascript
function navigateTo(path) {
  const url = path.startsWith('http') ? path : 'https://tokyo-calendar-date.jp' + path;
  if (window.Turbo?.visit) {
    window.Turbo.visit(url);
  } else {
    const link = document.querySelector(`a[href="${path}"], a[href="${url}"]`);
    if (link) link.click();
    else location.assign(url);
  }
}
```

全キュー遷移（advanceCheckQueue / batchAdvance）はこのヘルパーを使用する。

### 友達一覧ボタン（injectMatchSelector）

```
友達一覧 (/friend/index) に注入するパネル:
┌─────────────────────────────────────────┐
│ N件選択中    ⚡一斉送信を起動  ⏹停止    │
└─────────────────────────────────────────┘

各 li の状態バッジ:
  stage=0: ☐ チェックボックス（selectedForBatch を更新）
  stage=1~3, active=true:  🟢追跡中（タップで⏸一時停止）
  stage=1~3, active=false, rejected: 🚫拒否（タップで再開）
  stage=1~3, active=false, unclear: ❓判別不能（タップで再開）
  stage=1~3, active=false, 他: ⏸一時停止（タップで再開）
  stage=4: ✅完了
```

**⚡ 一斉送信を起動** → `handleScheduledBatchSend()` を呼ぶ  
（旧: 「💌 選択した相手に初回送信」は selectedForBatch を bypass して batchQueue に直接書いていた。2026-06-16廃止）

**⏹ 停止** → `checkQueue`, `batchQueue`, `selectedForBatch` をクリア + チェックボックス全解除

### 今すぐ送信ボタン（injectSendNowButton）

```
チャットページ (position:fixed, bottom:70px, z-index:99997) に注入
表示条件: state && stage >= 1 && stage <= 3 && active !== false
グレーアウト（disabled）: 上記以外

クリック時:
  e.stopPropagation() + e.preventDefault()  ← 東カレ底部ナビへの伝播を防止
  isSendNowPressed = true
  executeStageForCurrentChat()
  isSendNowPressed = false
```

---

## 6. アポ承認判定フロー

### stage=3 の処理フロー

```
相手の新規返信を検知（opponentCount > replyCount）
  ↓
既に apoJudgment が保存されている場合 → pre-guard へ（上述）
  ↓
judgeApoReply(直近20件の会話履歴) → Claude API 呼び出し

判定結果:
  'accepted_meal'   → ランチ/ディナー承諾
  'accepted_cafe'   → カフェ/お茶承諾
  'accepted_phone'  → 電話承諾
  'rejected'        → 拒否 → active:false, apoStatus:'rejected'（追跡停止）
  'unclear'         → 判別不能 → active:false, apoStatus:'unclear'（追跡停止）
  'error'           → API失敗 → active:true 維持、次回バッチで再試行

accepted の場合:
  apoJudgment = 'accepted_*' を保存
  sendApoNow = true の場合 → sendApoAccepted()
  sendApoNow = false の場合 → 通知「承認を検知 → 一斉送信または今すぐ送信で完了」
```

### sendApoAccepted() の内容

```
apoJudgment から slotType を決定（meal/cafe/phone）
  ↓
freeDays から getTypedSlots() で空き日程を取得（最大4件）
  ↓
buildApoAcceptedReply() でメッセージを2通構築
  ├─ Part1: 承諾応答テキスト（apoMealPart1など）+ {slot_header} 展開
  └─ Part2: LINE誘導テキスト（apoMealPart2など）+ LINE URL 末尾挿入
  ↓
sendMessageText(Part1) → sleep(2000~3000ms) → sendMessageText(Part2)
  ↓
csUpdate({ stage:4, replyCount:state.replyCount, apoJudgment:null })
```

**重要**: `replyCount` には `state.replyCount`（判定時の値）を使用。  
再カウントすると相手の追加メッセージで値がずれるため。

### judgeApoReply() の実装

```javascript
async function judgeApoReply(conversationSummary) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'judgeApo', payload: { conversationSummary } },
      (result) => {
        if (chrome.runtime.lastError) { resolve('error'); return; }
        if (result?.error) { resolve('error'); return; }
        resolve(result?.result || 'unclear');
      }
    );
  });
}
```

---

## 7. インバウンドフロー（相手が先にメッセージを送った場合）

### 定義

マッチ後、**こちらが何も送っていない状態で相手からメッセージが届いている**ケース。

### 検出方法

`sendFirstMessage()` 内で `countOpponentMessages() > 0` を確認。  
ただし**スカウト返信チェックを先に行う**（スカウト返信の誤認防止）。

### フロー詳細

```
1. sendFirstMessage() 開始
   ↓
2. スカウト返信チェック（後述）: 該当しない場合のみ続行
   ↓
3. hasInbound = countOpponentMessages() > 0
   ↓
4. hasInbound=true:
   prompt = msg1InboundTemplate（未設定時は msg1Template にフォールバック）
   conversationHistory = 直近10件の会話履歴（相手のメッセージを渡す）
   ↓
5. generateFromPrompt(prompt, conversationHistory, opponentSummary) → Claude生成
   ↓
6. sendMessageText(generated) → 送信
   ↓
7. csUpdate({ stage:1, replyCount:currentOpponentCount, isInbound:true })
   ↓
8. 15秒タイマーをセット:
   ├─ 条件: 同じチャットページに留まる && stage===1 && isInbound===true
   ├─ 実行: sendInboundApoMessage() → inboundApoTemplate を名前置換して直送
   └─ 完了: csUpdate({ stage:3, replyCount:opponentCount, isInbound:false })
   ステータス「返信送信済み ✓ 15秒後にアポ打診します ⏱」
```

### 15秒タイマーのキャンセル条件

- チャットページを離脱した場合（content script がページとともに破棄される）
- 一斉送信バッチが先にこのチャットを処理した場合（`stage !== 1 || !isInbound` でスキップ）

**タイマーが失われた場合のフォールバック**:  
次回の一斉送信バッチで `executeStageForCurrentChat()` が `stage=1 && isInbound=true` を検知し、`sendApoNow=true` の条件が揃えばアポ打診を実行する。

### sendInboundApoMessage() の内容

```javascript
async function sendInboundApoMessage(pattern, history) {
  const raw = sanitizeTemplate(pattern.inboundApoTemplate || '');
  if (!raw) return false;                          // テンプレート未設定 → スキップ
  const name = await extractOpponentName(history); // Claude で名前抽出
  const msg = applyNameTemplate(raw, name);        // [名前] を実名に置換
  return sendMessageText(msg);                     // テンプレート直送（Claude生成なし）
}
```

---

## 8. スカウト返信フロー（非マッチDM経由）

### 定義

**非マッチ送信**（スカウト）機能でDMを送った相手が、マッチ後に返信してきたケース。  
通常のインバウンドと区別し、msg1InboundTemplate ではなく **アポ打診直送**する。

### scoutSentUserIds の仕組み

```
非マッチ送信実行時（doOneScout）:
  targetId = profile_open(ID) から取得したプロフィールID（数値）
  → String(targetId) を scoutSentUserIds に追加（最大200件、FIFO）
```

**重要**: `scoutSentUserIds` に保存するIDは **プロフィールID**（`profile_open(12345678)` の数値）。  
チャットURLの末尾ID（`/friend/chat/184583305`）とは**別の値**になる場合がある。

### 検出方法（sendFirstMessage内）

```javascript
// DOM から profile_open ID を取得（URLのIDを使わない）
const avatarBtn = document.querySelector('a.radius100[onclick*="profile_open"]');
const profileIdMatch = avatarBtn?.getAttribute('onclick')?.match(/profile_open\((\d+)\)/);
const scoutCheckId = profileIdMatch ? profileIdMatch[1] : chatPath.split('/').pop();
// ↑ DOM取得できない場合のみURLのIDにフォールバック

if (scoutSentUserIds.includes(scoutCheckId) && countOpponentMessages() > 0) {
  // スカウト返信と確定
}
```

同様の照合を `detectAndSetScoutReply()` でも実施（手動アクセス時の検出）。

### フロー詳細

```
1. sendFirstMessage() でスカウト返信を検出
   ↓
2. csUpdate({ stage:1, replyCount:0, scoutReply:true })
   ※ 初回メッセージは送らない
   ↓
3. batchAdvance() → 次の会話へ
   ↓
（次の一斉送信バッチで）
4. executeStageForCurrentChat() → state.scoutReply === true を検知
   ↓
5. opponentCount > 0（絶対安全ガードを通過済み）
   ↓
6. sendApoMessages(pattern, history)
   ├─ apoMsg1Template → 名前置換 → 送信
   ├─ sleep(2000ms)
   └─ apoMsg2Template → 名前置換 → 送信
   ↓
7. csUpdate({ stage:3, replyCount:opponentCount, scoutReply:false })
```

### detectAndSetScoutReply（手動アクセス時の検出）

チャットページに手動アクセスし、かつ未追跡（stage未設定）の場合のみ実行。  
`profile_open(ID)` 照合でスカウト送信済みと判定できれば `scoutReply:true` をセット。

---

## 9. テンプレートシステム

### テンプレートの種類と送信方式

| フィールド | 送信方式 | 名前置換 | 説明 |
|---|---|---|---|
| `msg1Template` | Claude生成プロンプト | なし | 初回送信（こちらから） |
| `msg1InboundTemplate` | Claude生成プロンプト | なし | 初回返信（相手から先） |
| `msg2Template` | Claude生成プロンプト | なし | 2通目 |
| `apoMsg1Template` | テンプレート直送 | `[名前]`置換あり | アポ打診1通目 |
| `apoMsg2Template` | テンプレート直送 | `[名前]`置換あり | アポ打診2通目 |
| `inboundApoTemplate` | テンプレート直送 | `[名前]`置換あり | インバウンドアポ打診（1通） |
| `apoMealPart1/2` | テンプレート直送 | `[名前]`置換あり | ランチ/ディナー承認返信 |
| `apoCafePart1/2` | テンプレート直送 | `[名前]`置換あり | カフェ/お茶承認返信 |
| `apoPhonePart1/2` | テンプレート直送 | `[名前]`置換あり | 電話承認返信 |
| `lineTemplate` | テンプレート直送 | なし | LINE招待URL（Part2末尾に自動挿入） |
| `scoutMsgTemplate` | テンプレート直送 | なし | 非マッチ送信テキスト |

### --- バリエーション区切り

`msg1Template`、`msg1InboundTemplate`、`scoutMsgTemplate` は `---` で複数バリエーションを区切り可能。  
`pickVariant(template)` で毎回ランダムに1つを選択。

### [名前] プレースホルダー

```javascript
function applyNameTemplate(raw, name) {
  return raw.replace(/\[名前\]/g, name || '');
}
```

名前取得: `extractOpponentName(conversationHistory)` → Claude API で会話履歴から名前を抽出。  
取得失敗時は空文字で置換（`[名前]` が残らない）。

### {slot_header} プレースホルダー

**用途**: アポ承認時のPart1またはPart2に記述。空き日程（freeDays）の有無で自動切り替え。

| 条件 | 展開結果 |
|---|---|
| 空き日程あり | `このあたり空いてます！\n\n6/20昼\n6/21夜\n...` |
| 空き日程なし | `""（空文字、前後の空行もトリム）` |

**使用例**:
```
うれしいです！是非行きましょう。楽しみ！

{slot_header}よかったらLINEで...
```

**後方互換**: `{slot_header}` を使わず先頭行に「空いてます」を含むテキストを書いた場合、  
空き日程なし時は自動的に先頭行を除去する。

---

## 10. パターン設定スキーマ

`patterns` は複数パターンを切り替え可能（ターゲット層別など）。

```javascript
{
  id: "uuid",
  name: "パターン名",

  // Claude生成プロンプト（指示文として使用）
  msg1Template: "",           // 複数バリエーション: --- 区切り
  msg1InboundTemplate: "",    // 複数バリエーション: --- 区切り
  msg2Template: "",

  // テンプレート固定（直送）
  apoMsg1Template: "",        // [名前] 置換あり
  apoMsg2Template: "",        // [名前] 置換あり
  inboundApoTemplate: "",     // [名前] 置換あり（インバウンドアポ打診 1通）

  // アポ承認返信テンプレート
  apoMealPart1: "",  apoMealPart2: "",
  apoCafePart1: "",  apoCafePart2: "",
  apoPhonePart1: "", apoPhonePart2: "",
  lineTemplate: "https://line.me/ti/p/xxxxx",  // 各Part2末尾に自動挿入

  // 数値設定
  apoTriggerCount: 3,         // 相手の返信が何回来たらアポ打診するか（最低値: 1）

  // いいね設定
  maxLikesPerRun: 30,         // 1回あたりの最大いいね数
  maxLikesDaily: 50,          // 1日あたりの最大いいね数

  // いいねフィルター
  excludeAge: "18-22, 45-99", // 除外年齢範囲（カンマ区切り）
  excludeJobs: [],            // 除外職業リスト

  // 非マッチ送信設定
  scoutMsgTemplate: "",       // 複数バリエーション: --- 区切り
  maxScoutPerRun: 10,         // 1回あたりの最大送信数
  maxScoutDaily: 20,          // 1日あたりの最大送信数

  // 自動スケジュール
  batchScheduleTimes: ["20:00", "22:00"],  // 一斉送信時刻（空配列=スケジュールなし）
}
```

---

## 11. 自動モード一覧

### 自動いいね（startAutoLike）

- 検索リスト `/search/list` でプロフィールを順次開いてLike
- `isProfileFiltered()` でパターンのフィルター条件（年齢・職業）と照合
- `messageHashes` でLike済みを管理（重複防止）
- `maxLikesPerRun` / `maxLikesDaily` で上限制御
- ページ遷移後も `autoLikeRunning` フラグで自動再開

### 自動足跡（startAutoFootprint）

- 相手プロフィールを閲覧して足跡を残す
- `footprintHashes` で訪問済みを管理（重複防止）

### 自動スカウト（startAutoScout）

- 検索リストから対象を選んでスカウトメッセージ送信
- `scoutMsgTemplate` の --- バリエーションからランダム選択
- `messageHashes` で送信済みを管理（重複防止）
- `maxScoutPerRun` / `maxScoutDaily` で上限制御
- 送信後: 送信先プロフィールIDを `scoutSentUserIds` に追記

### 会話優先度スコアリング（injectPriorityScores）

- 会話リストページでメッセージに `★N` スコアバッジを表示
- スコア基準: メッセージ量、デートキーワード（食事/ランチ/会いたい等）、未読バッジ

---

## 12. Chrome MV3 対応事項

### Service Worker 終了問題

Chrome MV3 では Service Worker がいつでも終了する可能性がある。  
`chrome.runtime.sendMessage()` の **Promise 形式** は SW 終了時に "message channel closed" エラーをキャッチできない。  
→ **コールバック形式を使い、`chrome.runtime.lastError` を読む**。

対象関数（全てコールバック形式で実装済み）:
- `judgeApoReply()`
- `generateFromPrompt()`（retry ロジック付き）
- `extractOpponentName()`

### SW_ERRORS（再試行対象エラー）

```javascript
const SW_ERRORS = [
  'No SW',
  'Could not establish connection',
  'Extension context invalidated',
  'GAS URLまたはToken',
  'message channel closed',
];
```

### keepalive パターン

長時間の処理前に SW 起動確認:
```javascript
try {
  await chrome.runtime.sendMessage({ action: 'keepalive' });
} catch (_) {
  await sleep(2000); // SW再起動を待つ
}
```

---

## 13. 送信トリガーの設計

### 不変条件（絶対に守る設計）

**「⚡ 一斉送信を起動」または「▶ 今すぐ送信」または 設定済みスケジュールアラーム のいずれかを押さない限り、メッセージは自動送信されない。**

### 廃止された自動送信経路（2026-06-16 削除）

以下は過去に存在したが、意図しない送信を引き起こすため全廃した:

| 廃止した機能 | 削除理由 |
|---|---|
| 手動アクセス時の自動 executeStageForCurrentChat() | チャットを開くだけで送信されるバグ |
| 8時間周期の checkReplies アラーム | ユーザーの操作なしに定期送信していた |
| インバウンド3分タイマー（旧 inboundApoPending） | localStorage の残留データで翌日も誤発火 |

現在残っているタイマーとその安全性:

| タイマー | 種類 | 安全か？ |
|---|---|---|
| インバウンド15秒タイマー | `setTimeout` 15秒 | ✅ ページ離脱でキャンセル、stage/isInbound確認あり |
| batchQueue 遷移後 sendFirstMessage 1800ms | `setTimeout` 1.8秒 | ✅ batchQueueに含まれる場合のみ（ボタン操作が起点） |
| checkQueue 遷移後 executeStage 2500ms | `setTimeout` 2.5秒 | ✅ checkQueueに含まれる場合のみ（ボタン操作が起点） |
| いいね/足跡/スカウトのループタイマー | `setTimeout` 各種 | ✅ ユーザー操作で明示的に起動 |
| batch_HH_MM アラーム | `chrome.alarms` | ✅ 詳細設定で時刻登録した場合のみ生成 |

### sendApoNow フラグの設計

```javascript
// executeStageForCurrentChat() 内
const sendApoNow = checkQueue.includes(chatPath) || isSendNowPressed;
```

- `checkQueue.includes(chatPath)`: 一斉送信バッチで自動遷移してきた場合
- `isSendNowPressed`: 「▶ 今すぐ送信」ボタンを押した場合（インメモリ、ページ遷移でリセット）
- `sendApoNow = false` の場合: アポ承認を検知しても送信せず、`apoJudgment` を保存して通知のみ

---

## 14. 今後の実装予定

### 高優先度

#### LINE Messaging API 連携
- Business Account 申請済み（2026-06-16）
- Messaging API 有効化・チャンネルアクセストークン取得待ち
- 実装内容: アポ承認後にLINEで自動メッセージ送信（東カレアプリ外）
- 想定実装場所: `background.js` に `sendLineMessage()` を追加

#### コンバージョン計測
- パターン × 初回メッセージ × 検索条件別のファネル計測
- stage 0→1→2→3→4 の各遷移をイベントとして GAS に記録
- 現状: `logEvent` アクションはあるが計測ダッシュボードが未整備

### 中優先度

#### マルチパターンA/Bテスト
- 複数パターンをランダムまたはラウンドロビンで割り当て
- 承認率をパターン別に集計

#### スカウト返信の段階別対応
- 現状: スカウト返信があれば即アポ打診
- 改善: 返信内容に応じて通常の msg1/msg2 → アポのフローを経由するオプション

#### 送信前確認UI
- 一斉送信前に「対象N件・内容プレビュー」を表示してユーザーが確認してから送信

### 低優先度

#### 会話自動クローズ
- stage 4 完了後、相手から長期間返信がない場合に自動 active:false

#### オフピーク時刻スケジューリング
- 指定時刻（例: 20:00-23:00）にのみ一斉送信を実行

---

## 15. 変更履歴

### 2026-06-16（セッション1: 追い打ちバグ修正・大規模リファクタ）

**[CRITICAL] 返信ゼロ時の絶対安全ガード追加**
- 問題: 「ひな」への初回送信後（replyCount=0）、返信ゼロのままアポ打診が送られた
- 原因: 手動チャットアクセス時に `executeStageForCurrentChat()` が自動実行されていた
- 修正: `opponentCount === 0` の即 return ガードを最優先で追加

**[CRITICAL] 手動アクセス時の自動送信を完全削除**
- `init()` 内の `else if (state.stage >= 1)` ブランチを削除
- チャットを開くだけでは絶対に送信されなくなった

**[CRITICAL] 8時間 checkReplies アラーム廃止**
- `chrome.alarms.create('checkReplies', { periodInMinutes: 480 })` を削除
- `onAlarm` での `checkReplies` 処理を削除
- 旧データクリア: background.js 起動時に `chrome.alarms.clear('checkReplies')` 実行

**[apoTriggerCount] 最低値保証**
- `effectiveApoTrigger = Math.max(1, pattern.apoTriggerCount || 3)` で 0以下を防止

**[アポ承認タイミング制御] 新設計**
- 旧: 承認検知した瞬間に即送信
- 新: 承認検知 → `apoJudgment` を保存 → 送信は `sendApoNow` 条件付き
- `apoSendMode`（localStorage永続フラグ）を廃止、`isSendNowPressed`（インメモリ）に変更

**[SEL確定] DevToolsで実機確認**
- `text-align:right/left/center` で自分/相手/システム通知を区別
- `[style*="word-break"]` から本文テキストを取得

**[judgeApoReply] エラー処理改善**
- API失敗時: `'unclear'` → `'error'` センチネルを返すように変更
- `'error'` 時は `active:false` にせず次回バッチで再試行

**[generateFromPrompt] MV3対応**
- Promise形式 → コールバック形式に変換
- `SW_ERRORS` に `'message channel closed'` を追加

**[{slot_header}] プレースホルダー追加**
- Part1/Part2 両方で使用可能
- 空き日程あり: 「このあたり空いてます！」展開、なし: 空文字

---

### 2026-06-16（セッション2: インバウンド・スカウト返信改善）

**[インバウンドフロー] 3分タイマー廃止 → 15秒タイマーに変更**
- 旧: `inboundApoPending` を localStorage に保存、ページ読み込み時に3分後タイマーをセット
- 問題: localStorage 残留で翌日アクセス時にも誤発火する可能性
- 新: `sendFirstMessage()` 完了時に `setTimeout(15 * 1000)` をセット（インメモリ）
- 安全: ページ離脱でキャンセル、発火前に `stage === 1 && isInbound` を再確認
- `inboundApoPending` キーを background.js 起動時にクリア

**[isInbound フラグ] conversationStates に追加**
- `sendFirstMessage()` でセット
- `executeStageForCurrentChat()` の isInbound 分岐がバッチ処理時のフォールバックとして機能

**[スカウト返信誤認バグ修正] profile_open ID で照合するよう変更**
- 問題: チャットURL末尾IDとプロフィールID（profile_open）が異なる場合にスカウト検出失敗
- 修正: `sendFirstMessage()` でも DOM の `a.radius100[onclick*="profile_open"]` からIDを取得
- フォールバック: DOM取得不可時のみ URL 末尾IDを使用

**[ヒロミバグ修正] scoutReply フロー**
- 問題: スカウト済みユーザーが返信 → `sendFirstMessage()` がインバウンドと誤認 → msg1Inbound+アポ送信
- 修正: スカウトチェックをインバウンドチェックの前に実施

**[友達一覧ボタン変更]**
- 「💌 選択した相手に初回送信」廃止
  - 問題: selectedForBatch を bypass して batchQueue に直接書いていた / checkQueue を処理しない
- 「⚡ 一斉送信を起動」＋「⏹ 停止」に変更
  - `handleScheduledBatchSend()` を呼ぶ（stage 1-3 の checkQueue も同時処理）

**[今すぐ送信ボタン改善]**
- `bottom:20px` → `bottom:70px`（東カレのボトムナビと被らない位置）
- `e.stopPropagation()` + `e.preventDefault()` 追加（「探す」画面への誤遷移を防止）

**[サイレントreturn修正]**
- `opponentCount <= replyCount` の早期 return で「新しい返信待ち（相手の返信後に自動送信）」を表示
- 旧: 何も表示せずに return していたため「反応しない」に見えた

---

### 2026-06-17（セッション3: アーキテクチャバグ修正・navigateTo追加）

**[CRITICAL] 一斉送信が追跡中ユーザーを処理しないバグを修正**
- 原因: `handleScheduledBatchSend()` で `checkQueue: firstQueue.length > 0 ? [] : replyPaths` と書いてしまい、batchQueue（チェック済みstage0）がある場合にcheckQueue（追跡中stage1-3）が空になっていた
- 正しい仕様: 一斉送信は **追跡中ユーザー（stage1-3）とチェック済みユーザー（stage0）の両方** を処理する
- 修正: `checkQueue: replyPaths`（常にセット）に変更

**[navigateTo] Turbo SPA対応ナビゲーションヘルパー追加**
- 東カレはHotwire/Turbo SPAのため `location.href` 直接代入がルーターに無視される場合がある
- `navigateTo(path)` を追加: `Turbo.visit(url)` → `a.click()` → `location.assign(url)` の優先順
- `advanceCheckQueue()` / `batchAdvance()` / `handleScheduledBatchSend()` / `checkReplies` アクションの全遷移箇所を `navigateTo()` に統一

**[📝 生成ボタン] candidates.html 連携を追加**
- 友達一覧の「📝 生成」ボタン: チェック済みstage0ユーザーのメッセージ候補をClaudeで一括生成
- `candidatesJob` に保存 → `candidates.html` を別タブで開く（`background.js` の `openCandidates` アクション経由）
- 承認後: `batchQueue` に `{path, name, approvedText}` として保存 → 一斉送信で `approvedText` を直接送信

**[スカウト返信] 検出ロジック修正**
- 旧: `scoutSentUserIds`（DOM IDベース）で判定 → ID不一致で誤検出
- 新: `getConversationHistory()` で `自分:` のメッセージが存在 かつ 相手返信ありで判定

**[二重送信防止] `sendFirstMessage()` にstageガード追加**
- `stage >= 1` の場合は即スキップして `batchAdvance()` に進む
