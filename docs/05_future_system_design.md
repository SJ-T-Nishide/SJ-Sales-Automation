# 将来のシステム自動化設計（Phase 3以降）

> **Phase 2（手動テスト）で価値が確認できた後に実装する自動化の設計書**  
> 今回はコード実装せず、設計メモとして整理します。

---

## 前提

- Phase 2で朝レポートの価値が確認できたら、Phase 3へ進む
- 今回は**API連携・n8nワークフロー・Slack Bot**は実装しない
- 将来実装しやすいように、設計メモとして整理する

---

## Phase 3：MVP自動化（朝レポートBot）

### 目標
毎朝8時に、前日の情報を自動収集・分析して、Slackに朝レポートを投稿する。

### システム構成図

```
┌─────────────────┐
│ 入力レイヤー    │
├─────────────────┤
│ Plaud AI        │ → Google Sheets（文字起こしテキスト）
│ tl;dv           │ → Google Sheets（会議要約）
│ Slack           │ → Slack API（特定チャンネル・DM）
│ Google Calendar │ → Google Calendar API（前日の会議一覧）
└─────────────────┘
         ↓
┌─────────────────┐
│ 処理レイヤー    │
├─────────────────┤
│ n8n             │ ← 毎朝8時にトリガー
│  ├ Sheets API  │ ← 前日のPlaud・tl;dvデータを取得
│  ├ Slack API   │ ← 前日の特定チャンネル・DMを取得
│  ├ Google Cal  │ ← 前日の会議一覧を取得
│  └ Claude API  │ ← 経営コンテキスト + 前日データで分析
└─────────────────┘
         ↓
┌─────────────────┐
│ 出力レイヤー    │
├─────────────────┤
│ Slack Bot       │ → 経営陣・幹部向けチャンネルに投稿
│ Google Sheets   │ → 朝レポート履歴を保存
└─────────────────┘
```

### 技術スタック

| 役割 | ツール | 備考 |
|------|--------|------|
| オーケストレーション | n8n（セルフホスト） | Docker Composeで構築 |
| AIエンジン | Claude API | モデル：claude-sonnet-4-20250514 |
| ストレージ | Google Sheets | Plaud・tl;dv・レポート履歴 |
| 通知 | Slack Bot | Incoming Webhook or Bolt |
| 音声→テキスト | Plaud AI（手動）+ Whisper API（将来）| Phase 3では手動 |
| 会議→テキスト | tl;dv | 自動連携 |

### n8nワークフロー設計

```
[1] Cron Trigger（毎朝8時）
    ↓
[2] Google Sheets - Read Rows（Plaud文字起こしシート）
    条件：日付列 = 前日
    ↓
[3] Google Sheets - Read Rows（tl;dv要約シート）
    条件：日付列 = 前日
    ↓
[4] Slack - Get Channel History
    チャンネル：#経営報告
    条件：timestamp >= 前日00:00 AND timestamp < 今日00:00
    ↓
[5] Google Calendar - List Events
    条件：start >= 前日00:00 AND start < 今日00:00
    ↓
[6] Function - データ整形
    入力：Google Sheets・Slack・Calendarのデータ
    出力：Claude APIに投げる形式にフォーマット
    ↓
[7] HTTP Request - Claude API
    エンドポイント：https://api.anthropic.com/v1/messages
    ヘッダー：x-api-key, anthropic-version
    ボディ：
    {
      "model": "claude-sonnet-4-20250514",
      "max_tokens": 4096,
      "messages": [
        {
          "role": "user",
          "content": "（経営コンテキスト + 前日データ + 朝レポートプロンプト）"
        }
      ]
    }
    ↓
[8] Function - レスポンス整形
    Claude APIのレスポンスから朝レポートテキストを抽出
    ↓
[9] Slack - Post Message
    チャンネル：#経営朝レポート
    メッセージ：朝レポートテキスト（Markdown形式）
    ↓
[10] Google Sheets - Append Row（朝レポート履歴シート）
    内容：日付、レポート全文、入力データサマリ
```

### 環境変数

```bash
# .env ファイルで管理
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-20250514
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C01234567
GOOGLE_SHEETS_PLAUD_ID=...
GOOGLE_SHEETS_TLDV_ID=...
GOOGLE_SHEETS_REPORT_ID=...
GOOGLE_CALENDAR_ID=...@group.calendar.google.com
GOOGLE_SERVICE_ACCOUNT_JSON=...
```

### Claude APIプロンプト設計

```python
# プロンプト構成
prompt = f"""
【経営コンテキスト】
{management_context}  # docs/02_management_context.md の内容

---
【入力データ】

=== Plaud AI文字起こし ===
{plaud_data}

=== tl;dv会議要約 ===
{tldv_data}

=== Slackログ ===
{slack_data}

=== 会議一覧（Google Calendar） ===
{calendar_data}

---
【出力形式】
{output_format}  # docs/03_manual_morning_report_prompt.md の出力形式
"""
```

### Slack投稿フォーマット

```markdown
# 📊 朝レポート 2026-05-21

## 1. 今日の総括
昨日は投資家B社との商談が進展し、3件の追加案件の可能性が浮上。
一方、物件Xのレビューが4.8→4.5に低下、清掃品質の問題が原因。

## 2. 重要シグナル TOP5

### 🔴 #1 - Sランク【投資家】
**内容：** B社が3件の追加案件を検討中。今週中に具体的な提案が必要。
**なぜ重要か：** 成約すれば粗利+500万円の見込み。
**次のアクション：** 営業部が今週中に提案書を作成。社長が最終レビュー。
**放置リスク：** 他社に流れる可能性。今週中に動かないと失注の恐れ。

### 🔴 #2 - Sランク【運営】
**内容：** 物件Xのレビューが4.8→4.5に低下。ゲストコメントで清掃品質を指摘。
**なぜ重要か：** レビュー低下は売上に直結。今後の予約にも影響。
**次のアクション：** 清掃業者Zに即座にヒアリング。品質チェック体制を見直し。
**放置リスク：** さらにレビューが下がり、物件Xの売上が-20%になる可能性。

（以下略）

## 3. 未対応TODO（5件）
- [ ] **B社向け提案書作成**（営業部A / 期限：2026-05-23 / 重要度：S）
- [ ] **物件Xの清掃業者ヒアリング**（管理部B / 期限：2026-05-21 / 重要度：S）
（以下略）

---
📁 詳細は [Notion - 朝レポート履歴](https://notion.so/...) で確認できます。
```

---

## Phase 4：タスク自動化（承認制）

### 目標
AIがタスク候補を提示 → 人間が承認 → タスク管理ツールに自動登録

### フロー

```
朝レポート生成（Phase 3）
    ↓
AIがTODOを抽出
    ↓
重要度ランク判定
    ↓
【Sランク】即Slack通知 + タスク候補としてSlackボタン表示
【Aランク】タスク候補としてSlackボタン表示
【Bランク】朝レポート掲載のみ
【Cランク】保存のみ
    ↓
人間がSlackボタンで承認
    ↓
Asana / Linear / Google Sheetsに自動登録
```

### Slack Interactiveボタン設計

```json
{
  "type": "section",
  "text": {
    "type": "mrkdwn",
    "text": "*タスク候補：B社向け提案書作成*\n担当者：営業部A / 期限：2026-05-23 / 重要度：S"
  },
  "accessory": {
    "type": "button",
    "text": {
      "type": "plain_text",
      "text": "タスク登録"
    },
    "value": "task_123",
    "action_id": "approve_task"
  }
}
```

### n8nワークフロー（タスク登録）

```
Slack - Interactive Component（ボタンクリック）
    ↓
Function - タスク情報を抽出
    ↓
Asana - Create Task（または Linear / Google Sheets）
    ↓
Slack - Reply（「タスクを登録しました」）
```

---

## Phase 5：PBX接続・カレンダー自動化

### PBX候補

| PBX | 全通話録音 | 文字起こし | API | スマホアプリ | 備考 |
|-----|----------|-----------|-----|-------------|------|
| **INNOVERA** | ✅ | ✅ | ✅ | ✅ | 本命候補。API連携が豊富 |
| BIZTEL | ✅ | ✅ | ✅ | ✅ | 大手。高機能だが高価 |
| 03plus | ✅ | △ | △ | ✅ | 低価格。API弱い |
| MiiTel | ✅ | ✅ | ✅ | ✅ | AI分析特化。営業向け |

### PBX連携フロー

```
電話発着信
    ↓
クラウドPBXが自動録音
    ↓
PBX APIで録音データ取得
    ↓
Whisper APIで文字起こし
    ↓
Notion DBに保存
    ↓
朝レポート生成時に含める
```

### カレンダー自動化フロー

```
会議で「来週火曜にB社と再商談」という発言
    ↓
AIが会議候補を抽出
    ↓
Slackに下書き提示
「B社と再商談の会議を登録しますか？」
- 日時：2026-05-27 14:00-15:00
- 参加者：営業A、社長
- 場所：オンライン（Zoom URL自動発行）
- 先方送付文：「先日はありがとうございました。再度ご提案の機会をいただきたく…」
    ↓
人間がSlackボタンで承認
    ↓
Google Calendar APIで会議登録
    ↓
Zoom APIでURL発行
    ↓
Gmail APIで先方に送付（下書きモードで確認後送信）
```

---

## セキュリティ・プライバシー設計

### 録音データの取り扱い

| データ | 閲覧権限 | 保存期間 | 用途 |
|--------|---------|---------|------|
| 録音原本 | 管理者のみ | 3ヶ月 | トラブル時の確認 |
| 文字起こしテキスト | 経営陣・幹部 | 1年 | 朝レポート生成 |
| 朝レポート要約 | 経営陣・幹部・関係者 | 無期限 | 経営判断 |

### 環境変数管理

```bash
# .env ファイル（Gitにコミットしない）
CLAUDE_API_KEY=sk-ant-...
SLACK_BOT_TOKEN=xoxb-...
GOOGLE_SERVICE_ACCOUNT_JSON=...
GOOGLE_SHEETS_PLAUD_ID=...
GOOGLE_SHEETS_TLDV_ID=...
GOOGLE_SHEETS_REPORT_ID=...
GOOGLE_CALENDAR_CREDENTIALS=...
PBX_API_KEY=...
```

### .gitignore

```
.env
.env.local
credentials.json
token.json
*.mp3
*.wav
```

---

## コスト試算（Phase 3）

### Claude API
- モデル：claude-sonnet-4-20250514
- 入力：約10,000トークン/日（Plaud + tl;dv + Slack）
- 出力：約2,000トークン/日（朝レポート）
- 価格：入力 $3/1M tokens, 出力 $15/1M tokens
- **月額：** 約$20

### n8n
- セルフホスト（Docker Compose）
- サーバー：AWS EC2 t3.small（$15/月）
- ストレージ：10GB（$1/月）
- **月額：** 約$16

### Google Workspace
- Business Standard：既存契約（追加コストなし）

### Slack
- Pro Plan：$7.25/user/月（既存契約）

### 合計
- **Phase 3：** 約$40/月（Claude API + n8nサーバー + Slack）
- **Phase 5（PBX追加）：** 約$90/月（INNOVERA $50/月を想定）

---

## 開発スケジュール（Phase 3）

| 週 | タスク | 成果物 |
|----|--------|--------|
| Week 1 | n8n環境構築 | Docker Compose、.env設定 |
| Week 2 | Google Sheets設計・API接続 | Plaud/tl;dv シートテンプレート |
| Week 3 | Slack API接続・Claude API接続 | n8nワークフロー試作 |
| Week 4 | 統合テスト・デバッグ | 朝レポート自動投稿 |
| Week 5 | 本番運用開始・フィードバック収集 | 1週間の運用ログ |

---

## リスク・制約事項

### Phase 3
- ❌ Plaud AIの文字起こしは手動でGoogle Sheetsに保存（API未提供）
- ❌ tl;dvの自動連携はZapier経由（n8n直接連携は不可）
- ⚠️ Slackログの取得はチャンネル指定が必要（全チャンネルは不可）

### Phase 5
- ❌ PBXの選定に時間がかかる可能性
- ⚠️ カレンダー自動登録は最初「下書き提示→人間確認」から始める
- ⚠️ 外部送信（メール・カレンダー招待）は人間確認フロー必須

---

## 次のステップ

### Phase 2（今）
1. 手動で朝レポートを1週間テスト
2. フィードバックを毎日記録
3. 経営コンテキストを週次で更新
4. **価値が確認できたらPhase 3へ**

### Phase 3（自動化MVP）
1. n8n環境構築
2. Notion DB設計
3. Claude API接続
4. Slack Bot構築
5. 1週間の自動運用テスト

### Phase 4（タスク自動化）
1. Slack Interactiveボタン実装
2. Asana / Linear / Notion DB連携
3. 承認フロー構築

### Phase 5（PBX・カレンダー）
1. PBX選定・契約
2. PBX API連携
3. カレンダー下書き提示機能
4. 外部送信承認フロー

---

**作成日：** 2026-05-21  
**このドキュメントは生きたドキュメントです。** Phase 2のフィードバックに基づいて随時更新します。
