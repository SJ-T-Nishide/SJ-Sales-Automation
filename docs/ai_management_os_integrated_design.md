# AI経営OS 統合設計書（ブラッシュアップ版）

**作成日:** 2026-05-22  
**ベース:** 既存AI経営シグナルシステム + 経営陣提案

---

## 📌 主要な改善点

### 経営陣提案で追加された要素
1. **GitHub Vault:** MD形式の知識基盤
2. **Slack Bot MVP:** 社員向けQ&A（自己改善ループ）
3. **CEO Daily Briefing:** 毎朝3段階（30秒/3分/深掘り）
4. **Looker Studio:** KPIダッシュボード
5. **4レベル権限:** public/internal/management/private
6. **MiiTel統合:** 通話記録の自動分析
7. **OTAレビュー監視:** Booking.com/Airbnb/trip.com

### 既存設計からの継承
- tl;dv会議録自動転送（完了済み）
- Slackメンション監視
- Plaud AIプライバシー保護設計
- Zapier自動化（n8nから変更済み）

---

## 🔧 統合ツール構成・コスト

| ツール | 用途 | 月額 | 備考 |
|--------|------|------|------|
| **Zapier** | 自動化ハブ（全連携の中枢） | $19.99-49 | n8nより安定・使いやすい |
| **Claude API** | Signal抽出・Bot回答・Briefing | $25-50 | 既存設計と同じ |
| **GitHub Vault** | 知識基盤（FAQ・マニュアル） | 無料 | 新規追加 |
| **Plaud AI** | 社長専用録音（既存） | 無料 | 既に導入済み |
| **Looker Studio** | KPIダッシュボード | 無料 | 新規追加 |
| **Google Sheets** | データベース | 無料 | 既存 |
| **Slack** | Bot・通知・承認フロー | 無料 | 既存 |
| **OTA API/Scraper** | レビュー監視 | $0-30 | 段階的導入 |
| **MiiTel** | 通話記録分析 | 無料 | 本体契約あれば |
| **合計** | | **$45-130/月** | |

**段階別コスト:**
- Phase 2-3（現在）: $45-50/月（Zapier Starter + Claude API）
- Phase 4-5: $65-100/月（Bot・Briefing・Looker追加）
- Phase 6: $95-130/月（OTA監視・MiiTel追加）

---

## 📊 統合データフロー

### ① 情報収集（自動・常時）

```
【パブリックデータソース】（社員も閲覧可能）
├ Slack（#tldv-summaries、メンション、全チャンネル）
├ Gmail（tasone.clients@gmail.com: 顧客メール・tl;dv通知）
├ tl;dv（社員との会議録音・要約）
├ MiiTel（通話記録・文字起こし）← Phase 5
└ OTAレビュー（Booking.com/Airbnb/trip.com）← Phase 6
  ↓
Zapier定期監視 → Google Sheets一時保存
  ↓
Claude API → Signal抽出・分類・要約
  ↓
GitHub Vault（MD形式で保存）
  + Google Sheets（タスク・アイデア・リスク）

【プライベートデータソース】（社長のみ）
Plaud AI（一日中録音・ナレッジ蓄積）
  ↓
専用Webインターフェース（Phase 4実装）
  ├ 社長が文字起こしを確認
  └ Claude APIがリアルタイム分析
    ↓
タスク・アイデアのみ抽出（原文は非公開）
  ↓
GitHub Vault（private権限）
  + Google Sheets（"Plaud AI: 非公開"ラベル）
```

### ② リアルタイム反映

```
GitHub Vault に MD が push
  ↓
GitHub Actions → Zapier Webhook（自動検知）
  ↓
┌────────────────────────────────────────┐
│ ① CEO Daily Briefing（毎朝8時）         │
│    - 30秒版: 最重要3件のみ               │
│    - 3分版: タスク・リスク・数値サマリ    │
│    - 深掘り版: 全Signal詳細             │
│                                        │
│ ② Slack Bot（24時間稼働）               │
│    - 施設情報・FAQ・マニュアル即時回答   │
│    - 答えられなかった質問を自動記録      │
│    - 👎で誤回答を検知 → 修正候補生成    │
│                                        │
│ ③ Looker Studio KPI（リアルタイム）     │
│    - 施設別レビュー推移                 │
│    - 清掃不備頻度                       │
│    - タスク完了率                       │
│                                        │
│ ④ 夕方レポート（毎夕17時）              │
│    - 当日8-17時のSignal                │
│    - タスク進捗状況                     │
└────────────────────────────────────────┘
```

---

## 🎯 統合機能一覧

### Phase 2（現在実装中）
- ✅ tl;dvメール → Slack自動転送（完了）
- 🔄 Slack → Sheets自動保存（明日実装）
- ⏳ Slackメンション監視（明日実装）
- ⏳ データ蓄積テスト（3-4日間）

### Phase 3: AI分析・レポート（1週間後）
- 朝レポート（8時）: 前日17:00〜当日7:59のSignal
- 夕レポート（17時）: 当日8:00〜16:59のSignal
- タスク自動抽出（タイトル・優先度・期限・担当者判定）
- Google Sheets保存
- Slack #経営朝レポート 投稿

### Phase 4: Slack Bot MVP（2-3週間後）← 新規追加
**基本機能:**
- 社員からの質問に即時回答
- GitHub Vault（FAQ・マニュアル）を参照
- 答えられなかった質問を自動記録

**自己改善ループ:**
- 答えが見つからない質問 → FAQ候補リストに自動追加
- 👎リアクションで誤回答検知 → 修正候補を生成
- 週次でFAQ更新提案（社長承認）

**実装:**
- Slack Bot API + Claude API
- GitHub Vaultから知識検索
- 質問履歴をSheets保存

### Phase 5: CEO Daily Briefing（3-4週間後）← 新規追加
**3段階構成:**
1. **30秒版:** 最重要Signal 3件のみ（緊急タスク・リスク）
2. **3分版:** タスク10件 + リスク + KPIサマリ
3. **深掘り版:** 全Signal + 会議要約 + レビュー詳細

**配信:**
- 毎朝8時にSlack DM自動送信
- Google Docsに保存（日次アーカイブ）
- CEOフィードバックを次回精度向上に反映

### Phase 6: KPIダッシュボード + OTA監視（1-2ヶ月後）← 新規追加
**Looker Studio:**
- 施設別レビュー推移グラフ
- 清掃不備頻度（月次・施設別）
- タスク完了率
- MiiTel通話分析（顧客満足度）

**OTAレビュー監視:**
- Booking.com（公式API）
- Airbnb（Apifyスクレイパー）
- trip.com（スクレイパー）
- 異常検知（低評価・クレーム急増）→ 即時Slack通知

---

## 📂 GitHub Vault 構成

```
GitHub Repository: sj-ai-knowledge-vault
├ README.md
├ faq/
│   ├ public/（全員閲覧可能）
│   │   ├ facility_info.md（施設基本情報）
│   │   └ general_faq.md（一般FAQ）
│   ├ internal/（社員のみ）
│   │   ├ operations_manual.md（運営マニュアル）
│   │   ├ cleaning_checklist.md（清掃チェックリスト）
│   │   └ emergency_contacts.md（緊急連絡先）
│   ├ management/（管理職・経営陣のみ）
│   │   ├ kpi_definitions.md（KPI定義）
│   │   ├ cost_analysis.md（コスト分析）
│   │   └ strategy_notes.md（戦略メモ）
│   └ private/（社長のみ）
│       ├ plaud_summaries/（Plaud AI要約）
│       └ decision_log.md（意思決定ログ）
├ signals/（自動生成）
│   ├ tasks/（タスクMD）
│   ├ ideas/（アイデアMD）
│   └ risks/（リスクMD）
└ briefings/（自動生成）
    └ daily/（日次Briefing）
```

---

## 🔐 4レベル権限設計

| レベル | 対象 | 内容 | GitHub | Sheets | Slack Bot |
|--------|------|------|--------|--------|-----------|
| **public** | 全員 | 施設基本情報・一般FAQ | 公開repo | 全員閲覧 | 全員利用可 |
| **internal** | 社員全員 | マニュアル・清掃情報 | Private repo（社員追加） | 社員のみ | 社員のみ |
| **management** | 管理職・経営陣 | KPI・コスト・戦略 | Private repo（限定） | 限定共有 | 管理職のみ |
| **private** | 社長のみ | Plaud要約・意思決定 | Private repo（社長のみ） | 社長のみ | 利用不可 |

**実装:**
- GitHub: リポジトリのCollaborators設定
- Sheets: 共有設定で権限管理
- Slack Bot: ユーザーIDで権限判定

---

## 📅 統合実装スケジュール

### Phase 2: データ蓄積（2026-05-22〜05-24）← 現在
- **5/22（今日）:** Zapier Slack→Sheets設定（明日実施）
- **5/22-24:** データ蓄積テスト
- **完了判定:** Sheetsに50件以上蓄積、エラーなし

### Phase 3: AI分析・レポート（2026-05-25〜05-26）
- **5/25:** Claude API統合、朝夕レポート実装
- **5/26 朝8時:** 初回レポート配信
- **完了判定:** 3日間エラーなくレポート配信

### Phase 4: Slack Bot MVP + Plaud専用UI（2026-06-01〜06-07）
- **6/1-3:** GitHub Vault構築、FAQ整備
- **6/4-5:** Slack Bot実装（基本Q&A）
- **6/6-7:** Plaud専用Webインターフェース実装
- **完了判定:** Bot回答成功率70%以上

### Phase 5: CEO Daily Briefing（2026-06-08〜06-14）
- **6/8-10:** 3段階Briefing生成ロジック実装
- **6/11-12:** Slack DM自動配信
- **6/13-14:** フィードバックループ実装
- **完了判定:** CEOが「有用」と判定

### Phase 6: Looker Studio + OTA監視（2026-06-15〜06-30）
- **6/15-20:** Looker Studioダッシュボード構築
- **6/21-25:** Booking.com API統合
- **6/26-30:** Airbnb/trip.comスクレイパー統合（optional）
- **完了判定:** ダッシュボード稼働、レビュー監視開始

---

## 💰 段階別コスト

### Phase 2-3（現在〜6月初旬）
- Zapier Starter: $19.99
- Claude API: $25-30
- **合計:** $45-50/月

### Phase 4-5（6月中旬）
- Zapier Starter→Professional: $49（タスク増加）
- Claude API: $40-50（Bot・Briefing追加）
- **合計:** $89-99/月

### Phase 6（6月末〜）
- Zapier Professional: $49
- Claude API: $50-60（OTA分析追加）
- Apify（OTA scraper）: $30（optional）
- **合計:** $99-139/月

**最終的な月額:** $100-130/月（全機能稼働時）

---

## 🎯 既存設計からの主要変更点

### 追加要素
1. **GitHub Vault:** MD形式の知識基盤（FAQコンテンツ管理）
2. **Slack Bot:** 社員向けQ&A + 自己改善ループ
3. **CEO Daily Briefing:** 3段階（30秒/3分/深掘り）
4. **Looker Studio:** KPIダッシュボード
5. **4レベル権限:** 細かいアクセス制御

### 変更要素
- n8n → Zapier（既に変更済み）

### 継承要素
- tl;dv自動転送（完了済み）
- Slackメンション監視
- Plaud AIプライバシー保護設計
- Google Sheets DB
- 朝夕レポート（既存設計を3段階に拡張）

---

## 📊 期待される効果（追加・拡張）

### 短期（Phase 2-3完了後）
- ✅ 既存設計と同じ（データ蓄積・レポート配信）

### 中期（Phase 4-5完了後）
- ✅ **社員の問い合わせ対応時間90%削減**（Slack Bot）
- ✅ **CEOの情報収集時間60%削減**（Daily Briefing）
- ✅ **FAQ自動更新で知識劣化防止**

### 長期（Phase 6完了後）
- ✅ **OTAレビュー対応時間50%削減**（異常自動検知）
- ✅ **清掃不備の早期発見**（Looker KPI監視）
- ✅ **顧客満足度向上**（MiiTel通話分析）

---

## 🔄 自己改善ループの仕組み

### Slack Botの学習サイクル

```
社員がBotに質問
  ↓
GitHub Vaultから回答検索
  ↓
【答えが見つかった】
  回答を返す → 社員が👎リアクション
    ↓
  誤回答として記録 → Claude APIが修正候補生成
    ↓
  週次でFAQ修正提案（社長承認）
    ↓
  GitHub Vault更新
  
【答えが見つからない】
  「現在回答できません」→ 質問を自動記録
    ↓
  FAQ候補リストに追加 → Claude APIが回答ドラフト生成
    ↓
  週次でFAQ追加提案（社長承認）
    ↓
  GitHub Vault更新
```

**効果:**
- 使えば使うほど回答精度が上がる
- 人間の承認で品質担保
- 自動でナレッジベースが拡充

---

## 🚀 次のアクション

### 今日（5/22）
- このブラッシュアップ案を確認・承認
- 質問・修正があれば対応

### 明日（5/23）
- Task 2: Zapier Slack→Sheets設定（1.5-2時間）
- Task 3: Slackメンション監視（2時間）
- Task 4: 統合テスト（1時間）

### 来週（5/26〜）
- Phase 3: AI分析・レポート実装
- 初回レポート配信

---

**最終更新:** 2026-05-22  
**ステータス:** ブラッシュアップ案（承認待ち）  
**次回アクション:** ユーザー確認 → Phase 2実装継続
