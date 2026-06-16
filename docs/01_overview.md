# AI経営シグナル朝レポートシステム - 概要

## 一言で言うと

**朝起きたら、昨日会社で起きた重要事項・未対応タスク・社長判断事項がSlackに届いている状態を作る。**

## 背景と課題

### 現状の課題
- 会議・電話・対面・Slackの情報が分散しており、経営者が全体把握するコストが高い
- 社員は報告コストがかかる、経営者は抜け漏れが発生する
- 言った言わない問題、重要シグナルの見落としを防ぎたい

### 目指す状態
- **「200人規模でも全会議に同席している感覚」を経営者が得られる状態**
- 重要シグナルは自動抽出、アクションは明確化、判断事項は即座に届く
- 社員の報告負荷を減らしつつ、経営の透明性と一体感を高める

## システム全体構成（3層アーキテクチャ）

```
【入力レイヤー】
├─ Plaud AI（対面・現地録音）
├─ クラウドPBX（電話自動録音）※Phase 5以降
├─ Google Meet / Zoom + tl;dv（会議録画・文字起こし）
├─ Slack（メンション・DM・チャンネル）
└─ Google Calendar（予定・会議情報）

        ↓ データ収集

【処理レイヤー】
├─ Whisper / tl;dv / PBX文字起こし → テキスト化
├─ Notion / Google Driveに集積
├─ n8n（オーケストレーション）
└─ Claude API（経営コンテキストを持たせたAIエージェント）
    ├─ 優先度判定（S/A/B/C）
    ├─ シグナル検知（KPIアラート）
    └─ タスク抽出（TODO・アイデア）

        ↓ 分析・整形

【出力レイヤー】
├─ Slack朝ブリーフィング（経営陣・幹部向け）
├─ タスク登録（Asana / Linear / Notion DB）※承認制から始める
├─ Googleカレンダー登録案（下書き提示→人間が承認）
└─ 会議URL発行・先方送付文の下書き（人間が確認して送付）
```

## フェーズ別実装計画

### Phase 1（今週）：経営コンテキスト最小版を作る ✅
- Google DocsにKPI・重要人物・シグナル/ノイズ定義を記載
- 経営コンテキスト初期版を保存
- **成果物：** `docs/02_management_context.md` → Google Docs保存

### Phase 2（来週〜2週間）：手動で朝レポートを試す ⏳ **← 今ココ**
- Plaud / tl;dv / Slackログを手動でClaudeに投げる
- 「軽量版朝レポートプロンプト」を使う
- 毎日フィードバックをメモして判断基準を磨く
- **ここで価値を確認してから自動化に進む**
- **成果物：** `docs/03_manual_morning_report_prompt.md`, `docs/04_feedback_template.md`

### Phase 3（手動テストで価値が確認できた後）：MVP自動化（朝レポートBot）
- n8n + Claude API + Slack Botで自動化
- 入力：Slack特定チャンネル・tl;dv要約・Plaud文字起こし・Googleカレンダー
- 出力：毎朝8時にSlackへ投稿
- **成果物：** n8nワークフロー、Slack Bot、Claude APIスクリプト

### Phase 4（Phase 3が安定した後）：タスク化
- AIがタスク候補を出す → 人間が承認 → タスク登録
- **Sランク：** 即Slack通知
- **Aランク：** タスク化候補（承認制）
- **Bランク：** 朝レポート掲載のみ
- **Cランク：** 保存のみ

### Phase 5（3〜6ヶ月）：PBX接続・カレンダー自動化
- **クラウドPBX候補：** INNOVERA（本命）、BIZTEL、03plus、MiiTel
- **条件：** 全通話自動録音・録音通知設定の柔軟性・スマホアプリ対応・文字起こし・API連携
- カレンダー登録・Zoom URL発行・先方送付文は「下書き提示→人間確認」形式

## 技術スタック

| 役割 | ツール |
|------|--------|
| オーケストレーション | n8n（セルフホスト推奨）|
| AIエンジン | Claude API（モデル：Sonnet系想定）|
| コード実装 | Claude Code |
| 音声→テキスト | Whisper API / tl;dv / PBX付属文字起こし |
| 対面録音 | Plaud AI |
| 会議録画 | tl;dv（Google Meet・Zoom両対応）|
| ストレージ | Google Sheets / Google Drive |
| 通知 | Slack Bot |
| タスク管理 | Asana or Linear or Notion DB |
| カレンダー | Google Calendar API |
| 電話 | クラウドPBX（Phase 5〜）|

### 環境変数管理

```bash
# .env ファイルで管理
CLAUDE_MODEL=claude-sonnet-4-20250514
SLACK_BOT_TOKEN=xoxb-...
NOTION_API_KEY=secret_...
GOOGLE_CALENDAR_ID=...@group.calendar.google.com
N8N_WEBHOOK_URL=https://...
```

## 社内ルール・注意事項

### プライバシー・倫理面
- 📌 録音は業務目的のみ・私的会話は対象外
- 📌 社員への説明：「監視」ではなく「報告コスト削減・言った言わない防止・一体感醸成」
- 📌 録音原本の閲覧は管理者のみ・社員向けは要約のみ共有

### 人間確認フロー
- 📌 カレンダー自動登録・外部送信は最初は「下書き提示→人間確認」形式
- 📌 タスク自動登録は「AIが候補提示→人間承認」形式から始める
- 📌 Sランクシグナルは即座に通知するが、最終判断は人間

## 最初にやるべきこと（Phase 2チェックリスト）

- [ ] Google Driveに「AI経営シグナル」フォルダを作成
- [ ] [経営コンテキスト初期版](./02_management_context.md)をGoogle Docsに保存
- [ ] 直近のPlaud音声・tl;dv要約・Slackログを1つ用意する
- [ ] [軽量版プロンプト](./03_manual_morning_report_prompt.md)を使って手動で朝レポートを1回出す
- [ ] 毎朝手動テスト → [フィードバック記録](./04_feedback_template.md)をGoogle Docsに記録
- [ ] **価値確認後** → n8n自動化（Phase 3）へ進む

## Phase 2 → Phase 3 移行判断基準

以下の条件を満たしたらPhase 3（自動化）へ進みます：
- [ ] 1週間以上手動テストを継続できた
- [ ] 総合評価が平均3.5以上（5段階）
- [ ] 経営者が「朝レポートがあると助かる」と実感している
- [ ] フィードバックに基づいて経営コンテキストを1回以上更新した

## 参考リンク

- [経営コンテキスト](./02_management_context.md)
- [手動朝レポートプロンプト](./03_manual_morning_report_prompt.md)
- [フィードバックテンプレート](./04_feedback_template.md)
- [将来の自動化設計](./05_future_system_design.md)

---

**作成日：** 2026-05-21  
**現在フェーズ：** Phase 2 - 手動テスト準備中  
**次のマイルストーン：** 1週間の手動テスト完了 → 価値確認 → Phase 3へ
