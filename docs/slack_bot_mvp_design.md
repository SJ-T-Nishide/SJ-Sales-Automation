# Slack Bot MVP 設計書

**作成日:** 2026-05-23  
**アーキテクチャ:** Zapier + Claude API  
**Phase:** 4  
**実装期間:** 2-3週間後予定

---

## 📌 システム概要

### 目的
社員からのSlack質問に即時回答し、使えば使うほど賢くなる自己改善型Botを構築する。

### 主要機能
1. **基本Q&A:** GitHub Vaultから回答を検索して返答
2. **権限管理:** 4レベル権限（public/internal/management/private）
3. **学習ループ:** 答えられない質問を記録
4. **自動改善:** 週次でFAQ更新提案を生成

---

## 🏗️ アーキテクチャ

### システム構成

```
┌─────────────────────────────────────────┐
│          Slack（社員が質問）             │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│        Zapier Zap（Botロジック）         │
├─────────────────────────────────────────┤
│ 1. Slack Trigger（メンション検知）       │
│ 2. ユーザー情報取得（権限判定用）        │
│ 3. Claude API（回答生成）                │
│    - GitHub Vault検索                   │
│    - 4レベル権限判定                     │
│    - 回答生成                            │
│ 4. Slack返信                            │
│ 5. 質問履歴をGoogle Sheets保存          │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│          データ保存先                    │
├─────────────────────────────────────────┤
│ - GitHub Vault（FAQ・マニュアル）        │
│ - Google Sheets（質問履歴・学習データ）  │
└─────────────────────────────────────────┘
```

### 技術スタック

| 項目 | 技術 | 月額コスト |
|------|------|-----------|
| Bot基盤 | Zapier Professional | $49 |
| AI回答生成 | Claude API（Sonnet 4.6） | $30-40 |
| 知識基盤 | GitHub Vault | 無料 |
| データ保存 | Google Sheets | 無料 |
| 通知 | Slack | 無料（既存） |
| **合計** | | **$79-89/月** |

---

## 🎯 機能仕様

### 1. 基本Q&A機能

#### トリガー
- Slack Bot（@AI経営アシスタント）へのメンション
- DM送信

#### 処理フロー
```
社員が質問
  ↓
Zapier Trigger（app_mentionまたはmessage.im）
  ↓
質問者のSlack User IDを取得
  ↓
質問者の権限レベルを判定（後述）
  ↓
Claude APIに送信：
  - プロンプト：「以下の質問に答えてください」
  - 質問内容
  - 権限レベル
  - GitHub Vault全体（権限でフィルタリング）
  ↓
Claude APIが回答生成
  ↓
Slackに返信
  ↓
質問履歴をGoogle Sheetsに保存
```

#### Claude APIプロンプト構造
```markdown
あなたはSuccess Japan株式会社の社員向けAIアシスタントです。
以下の知識基盤から質問に回答してください。

【質問者の権限レベル】
{権限レベル: internal}

【知識基盤】
※権限レベルに応じてフィルタリング済み

=== public権限（全員閲覧可能）===
{faq/public/の全コンテンツ}

=== internal権限（社員のみ）===
{faq/internal/の全コンテンツ}

=== management権限（管理職のみ）===
※質問者の権限がmanagement以上の場合のみ含む
{faq/management/の全コンテンツ}

=== private権限（社長のみ）===
※含まない（社長のみアクセス可能）

【質問】
{質問内容}

【回答ガイドライン】
1. 知識基盤に明確な回答がある場合：その内容を元に回答
2. 知識基盤にない場合：「現在その情報は知識基盤にありません」と返答
3. 権限外の情報を求められた場合：「その情報は管理職以上のみ閲覧可能です」と返答
4. 回答の最後に情報ソースを記載（例：「参考：運営マニュアル > 清掃管理」）
```

---

### 2. 権限管理（4レベル）

#### 権限レベル定義

| レベル | 対象 | 判定方法 |
|--------|------|---------|
| **public** | 全員 | デフォルト |
| **internal** | 社員全員 | Slackワークスペースメンバー |
| **management** | 管理職・経営陣 | Slack User Group「@管理職」に所属 |
| **private** | 社長のみ | Slack User ID = `U123456789`（西出社長のID） |

#### 実装方法（Zapier）

**Step 1: Slack User情報取得**
- Zapier Action: **Slack - Get User Info**
- Input: `trigger.user_id`
- Output: `user.name`, `user.email`, `user.profile`

**Step 2: Slack User Groups取得**
- Zapier Action: **Slack - Get User Groups for User**
- Input: `trigger.user_id`
- Output: `user_groups[]`

**Step 3: 権限レベル判定（Zapier Code）**
```javascript
// 権限レベル判定ロジック
const userId = inputData.user_id;
const userGroups = inputData.user_groups || [];

// 社長判定（User IDで判定）
if (userId === 'U123456789') {  // 西出社長のUser ID
  return { permission_level: 'private' };
}

// 管理職判定（User Groupで判定）
const managementGroupId = 'S01234567';  // @管理職グループのID
if (userGroups.includes(managementGroupId)) {
  return { permission_level: 'management' };
}

// 社員判定（Slackワークスペースメンバー）
return { permission_level: 'internal' };

// public権限は実装しない（社外ユーザーはBotを使えない前提）
```

**Step 4: GitHub Vaultのフィルタリング**
権限レベルに応じて、Claude APIに渡すコンテンツをフィルタリング：
- `public`: `faq/public/`のみ
- `internal`: `faq/public/` + `faq/internal/`
- `management`: `faq/public/` + `faq/internal/` + `faq/management/`
- `private`: 全てのコンテンツ（`faq/private/`含む）

---

### 3. GitHub Vault検索

#### GitHub APIでFAQコンテンツを取得

**Zapier Action: HTTP Request**
```
Method: GET
URL: https://api.github.com/repos/SJ-T-Nishide/sj-ai-knowledge-vault/contents/faq/{権限レベル}
Headers:
  Authorization: Bearer {GITHUB_TOKEN}
  Accept: application/vnd.github.v3+json
```

**取得したコンテンツをClaude APIプロンプトに挿入**

---

### 4. 学習ループ（答えられない質問の記録）

#### トリガー
Claude APIが「知識基盤にない」と返答した場合

#### 処理フロー
```
Claude APIが「現在その情報は知識基盤にありません」と返答
  ↓
Google Sheets「質問履歴」シートに記録：
  - タイムスタンプ
  - 質問者
  - 質問内容
  - 回答内容
  - ステータス：「未学習」
  ↓
週次でFAQ候補として抽出（後述）
```

#### Google Sheets構造

**シート名: 質問履歴**

| 列 | 内容 |
|----|------|
| A: タイムスタンプ | 質問日時 |
| B: 質問者 | Slack User名 |
| C: 質問内容 | 質問全文 |
| D: 回答内容 | Botの回答 |
| E: 回答ソース | 「FAQ参照」or「知識基盤にない」 |
| F: ステータス | 「回答済み」「未学習」「FAQ候補」 |
| G: 権限レベル | 質問者の権限レベル |

---

### 5. 自動改善（週次FAQ更新提案）

#### 実装方法

**Zapier Scheduled Trigger（毎週金曜 17:00）**
```
Trigger: Schedule by Zapier
Frequency: Every Week, Friday, 17:00

Action 1: Google Sheets - Lookup Spreadsheet Rows
  - Spreadsheet: AI経営シグナル_データベース
  - Worksheet: 質問履歴
  - Search Column: F（ステータス）
  - Search Value: "未学習"
  ↓
Action 2: Claude API - Generate FAQ Candidates
  - プロンプト:
    「以下の質問リストから、FAQ追加候補を抽出してください。
     各候補について、質問・回答案・適切な権限レベルを提示してください。」
  - 入力: 未学習質問リスト
  ↓
Action 3: Slack - Send Message
  - Channel: #経営朝レポート（または社長DM）
  - Message:
    「【週次FAQ更新提案】
     今週、以下の質問が複数回ありました。FAQ追加を検討してください。
     
     1. 質問: 〇〇について
        回答案: 〇〇です
        推奨権限: internal
        
     承認する場合は、GitHub Vaultに追加してください。」
```

#### 承認フロー（手動）

社長が提案を確認 → GitHub Vaultに手動で追加 → 次回からBotが回答可能に

**将来的な自動化（Phase 5以降）:**
- Slack Botの「承認」ボタンをクリック
- 自動的にGitHub Vaultに追加
- PRを作成して社長がレビュー

---

## 📝 実装手順

### Phase 4A: 基本Q&A機能（1週間）

**1. Slack App設定（1-2時間）**
- Slack Appを作成
- Bot Token Scopes追加:
  - `app_mentions:read`
  - `chat:write`
  - `users:read`
  - `usergroups:read`
  - `im:history`（DM対応）
  - `im:write`（DM返信）
- Event Subscriptions設定:
  - `app_mention`
  - `message.im`（DM対応）
- Bot User追加: `@AI経営アシスタント`

**2. Zapier Zap作成（3-4時間）**

**Zap 1: メンション対応**
```
Trigger: Slack - New Mention
  ↓
Action 1: Slack - Get User Info
  ↓
Action 2: Slack - Get User Groups for User
  ↓
Action 3: Code by Zapier - 権限レベル判定
  ↓
Action 4: HTTP Request - GitHub APIでFAQ取得
  ↓
Action 5: Claude API - 回答生成
  ↓
Action 6: Slack - Send Channel Message（返信）
  ↓
Action 7: Google Sheets - Create Row（質問履歴保存）
```

**3. テスト（1-2時間）**
- 各権限レベルでテスト
- エッジケース確認

---

### Phase 4B: 学習ループ（3-4日）

**4. 質問履歴記録の実装（2時間）**
- Google Sheets「質問履歴」シート作成
- Zapier Actionで質問履歴を保存

**5. 週次FAQ提案の実装（3-4時間）**
- Zapier Scheduled Trigger作成
- Claude APIでFAQ候補生成
- Slack通知

**6. テスト（1-2時間）**
- 手動でScheduled Triggerを実行
- 提案内容の確認

---

### Phase 4C: 自動改善ループ（1週間、optional）

**7. GitHub API連携（4-5時間）**
- GitHub APIでFAQ追加を自動化
- PR作成機能

**8. Slack Interactive Messages（3-4時間）**
- 「承認」「却下」ボタン実装
- ボタンクリックでGitHub APIを呼び出し

**9. テスト（1-2時間）**

---

## 💰 コスト詳細

### 初期費用
- なし

### 月額費用

| 項目 | 金額 | 備考 |
|------|------|------|
| Zapier Professional | $49 | 2,000タスク/月 |
| Claude API | $30-40 | 使用量による（1日50-100質問想定） |
| その他 | $0 | GitHub・Sheets・Slack無料 |
| **合計** | **$79-89** | |

### 質問数シミュレーション

**想定:**
- 社員10名
- 1日平均5質問/人 = 50質問/日
- 月間1,500質問

**Claude APIコスト:**
- 1質問あたり: 入力5,000トークン + 出力1,000トークン
- 1,500質問/月 × $0.02 = **約$30-40/月**

---

## 🎯 成功指標（KPI）

### Phase 4A完了後（1週間後）

| 指標 | 目標 |
|------|------|
| 回答成功率 | 70%以上 |
| 平均応答時間 | 5秒以内 |
| 質問数 | 10-20件/日 |

### Phase 4B完了後（2-3週間後）

| 指標 | 目標 |
|------|------|
| 回答成功率 | 80%以上 |
| FAQ更新提案数 | 週3-5件 |
| FAQ承認率 | 50%以上 |

### Phase 4C完了後（1ヶ月後、optional）

| 指標 | 目標 |
|------|------|
| 回答成功率 | 90%以上 |
| 自動FAQ追加数 | 月10-20件 |

---

## 🔐 セキュリティ・プライバシー

### データ保護
1. **権限管理:** 4レベル権限で情報アクセスを制限
2. **質問履歴:** Google Sheetsは社長のみアクセス可能に設定
3. **GitHub Vault:** Private repositoryで管理
4. **Claude API:** APIキーは環境変数で管理、ログは保持しない

### プライバシー
- 質問内容はGoogle Sheetsに保存されるが、社長のみ閲覧可能
- Claude APIには個人情報を含まないよう注意

---

## 📋 次のステップ

### 今週（Phase 4A開始）
1. Slack App作成
2. Zapier Zap実装（基本Q&A）
3. テスト

### 来週（Phase 4B）
4. 学習ループ実装
5. 週次FAQ提案実装

### 今後（Phase 4C、optional）
6. 自動改善ループ実装

---

## 🔗 関連ドキュメント

- [GitHub Vault README](../sj-ai-knowledge-vault/README.md)
- [AI経営OS統合設計書](./ai_management_os_integrated_design.md)
- [Phase 4実装ガイド](../ai_signal_system/docs/phase4_implementation_guide.md)

---

**最終更新:** 2026-05-23  
**ステータス:** 設計完了、実装待ち  
**実装予定:** 2-3週間後
