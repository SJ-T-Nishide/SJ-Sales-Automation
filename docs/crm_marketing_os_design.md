# Success Japan CRM / マーケティングOS 設計書

**策定日**: 2026-06-16
**目標**: 自社版UTAGE+Salesforce代替。Phase 5でSaaS外販。

---

## システム全体像

```
[流入] selecttype/LP/広告 → GAS Webhook
[DB]   Supabase (ap-northeast-1 東京)
[自動化] GAS 5分トリガー
  ├─ Email → Resend API
  ├─ SMS   → ValueSMS API
  ├─ LINE  → LINE Messaging API（Phase 2）
  └─ Slack → 営業アラート通知
[UI]   GAS WebApp（一斉送信・フィルタ）
[分析] Claude API（Phase 4〜）
```

---

## フェーズ別実装計画

| Phase | 期間 | 内容 |
|-------|------|------|
| **1** | 〜6月末 | 既存リード統合・一斉送信・追客アラート |
| **2** | 7月 | LINE配信・簡易ダッシュボード（反響率・移行率） |
| **3** | 8月 | オートウェビナー → 個別面談予約 |
| **4** | 9月 | AIマーケ施策・クリエイティブ提案 |
| **5** | 10月〜 | パートナー（紹介報酬）機能・SaaS外販準備 |

---

## 配信スタック（確定）

| チャネル | ツール | 月額 |
|---------|--------|------|
| メール | Resend Pro | $20 |
| SMS | ValueSMS | ¥8/通（従量） |
| LINE | LINE Messaging API Light | ¥5,000（Phase 2〜） |
| PBX・録音 | innovera | ¥11,000〜18,500 |
| DB | Supabase Pro | ¥2,900 |

---

## Phase 1 データモデル

### 設計方針
- **流入経路・ファネル段階・全アクションを最初から記録**（後から遡れない）
- `tenant_id` を最初から付与（SaaS化時のコスト最小化）
- 元Sheetsデータは読取専用（改変しない）
- メール/電話で名寄せ・重複排除

### テーブル構成
```
leads          ← リードマスタ（source/referrer_id/heat/status/opted_out）
messages_log   ← 全送信ログ（campaign_id・dedup_key で誤送信防止）
alert_rules    ← 追客ルール（JSON条件・可変・随時設定可能）
```

### 流入経路の記録（測定の土台）
`leads.source` に流入元を記録。UTMパラメータ対応は Phase 2。
`leads.referrer_id` はパートナー機能（Phase 5）用に箱だけ用意。

---

## GAS構成（Phase 1）

| ファイル | 役割 |
|---------|------|
| `Config.gs` | ヘッダー同義語・設定 |
| `SupabaseClient.gs` | Supabase REST APIラッパー |
| `Importer.gs` | Sheets → Supabase インポーター |
| `AlertEngine.gs` | 追客ルール評価 → Slack通知 |
| `WebApp.gs` | 一斉送信UI（Phase 2で追加） |

---

## セキュリティ・法令対応

| 項目 | 対応 |
|------|------|
| APIキー | PropertiesService のみ（コード直書き禁止） |
| オプトアウト | `opted_out=true` を送信前に必ずチェック |
| 特商法（電話勧誘） | Do-Not-Call対応は Phase 1から |
| Supabase RLS | service_roleのみアクセス可（Phase 1） |
| 誤配信防止 | `dedup_key`・ドライランモード・送信前プレビュー |

---

## UTAGEとの比較・選定理由

| 比較軸 | UTAGE | 自社製 |
|--------|-------|--------|
| 導入スピード | ◎ 即日 | △ 数週間 |
| AIマーケ提案（#4） | ❌ 不可 | ✅ 自社データで実現 |
| SaaS外販（Phase 5） | ❌ 不可 | ✅ 勝ち筋 |
| データ所有 | △ ベンダーロックイン | ✅ 完全自社 |
| 月額コスト | ¥17,600 | ¥22,000〜 |

**結論**: UTAGEは導入しない。ウェビナー機能（Phase 3）のみ時間切れ時に部分レンタル検討。

---

## Phase 1 実装詳細（2026-06-16 完了）

### Supabase 環境

| 項目 | 値 |
|------|-----|
| プロジェクト名 | successjapan-crm |
| リージョン | ap-northeast-1（東京） |
| Project URL | `https://eqogkmauxlwjrweicbgr.supabase.co` |
| 使用キー | **anon key**（service_role keyは不使用） |

**anon keyを使う理由**: GASは`Mozilla/5.0`系のUser-Agentを送信するため、Supabaseがブラウザからのservice_roleアクセスをセキュリティ上ブロックする。回避策としてanon keyを使い、RLSポリシーで全操作を許可する。

#### RLSポリシー（3テーブル共通）
```sql
create policy "gas_all_leads" on leads
  for all to anon using (true) with check (true);
-- messages_log / alert_rules も同様
```

#### ユニーク制約（PostgRESTのon_conflict用）
```sql
alter table leads add constraint leads_email_key unique (email);
alter table leads add constraint leads_phone_key unique (phone);
```
> **注意**: `WHERE email IS NOT NULL` のような部分インデックスではPostgRESTの`on_conflict`パラメータが動作しない。フルユニーク制約が必須。

---

### leadsテーブル 全カラム

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | 自動生成 |
| email | text UNIQUE | 正規化済み（小文字・trim） |
| phone | text UNIQUE | ハイフン除去・0補完・11or10桁のみ有効 |
| name | text | |
| heat | text | A/B/C（デフォルト: C） |
| status | text | 未対応/アプローチ中/面談済/成約/失注（デフォルト: 未対応） |
| product | text | B-1/A②/B-2 等 |
| notes | text | 備考 |
| source | text | 流入元 |
| assigned_to | text | 担当者名 |
| seminar_date | timestamptz | セミナー参加日 |
| last_contacted_at | timestamptz | 最終コンタクト日 |
| last_marketed_at | timestamptz | 最終マーケアタック日 |
| opted_in_email | boolean | デフォルト false |
| opted_in_sms | boolean | デフォルト false |
| opted_out | boolean | デフォルト false（true=全配信停止） |
| source_tab | text | 取込元シートのタブ名 |
| source_row | integer | 取込元の行番号 |
| source_sheet_id | text | 取込元スプレッドシートID |
| referrer_id | text | パートナー紹介ID（Phase 5用） |
| tenant_id | text | SaaS化用（Phase 5用） |
| created_at | timestamptz | 自動 |
| updated_at | timestamptz | 自動（トリガーで更新） |

---

### GAS Config.gs 設定内容

#### HEADER_SYNONYMS（ヘッダー自動認識）
スプレッドシートの列名が以下のどれかに部分一致すれば自動マッピング：

| 標準フィールド | 認識するヘッダー例 |
|--------------|----------------|
| name | 氏名、名前、お名前、フルネーム |
| email | メール、メールアドレス、Email |
| phone | 電話、電話番号、携帯、Tel |
| heat | 熱度、ランク、グレード |
| status | ステータス、対応状況 |
| product | 商材、興味商材、product |
| notes | 備考、メモ、note |
| seminar_date | セミナー日、参加日、開催日 |
| last_contacted_at | 最終コンタクト、最終接触日 |
| last_marketed_at | 最終アタック、最終送信日 |
| assigned_to | 担当、担当者 |
| source | 流入元、媒体 |

#### SKIP_TABS（スキップするタブ名に含まれるキーワード）
```
各シートまとめ / テンプレ / サンプル / 集計 / マスタ / 設定 / 使い方
```
> `集計` をスキップタブに含めると `泊マッチMeta(集計)` もスキップされてしまうため、現在は含めていない

#### HEAT_NORMALIZE（熱度の表記ゆれ正規化）
```
S/特A/最高 → A
普通/中/通常 → B
低/冷/見込なし → C
```

#### STATUS_NORMALIZE（ステータスの表記ゆれ正規化）
```
新規/未対応 → 未対応
追客中/アプローチ → アプローチ中
面談 → 面談済
成約/契約 → 成約
失注/NG/不要 → 失注
```

---

### Importer.gs 実装詳細

#### 処理フロー（1タブ分）
```
1. getDataRange().getValues() で全データ取得
2. detectHeaderRow_() でヘッダー行を自動検出（最大5行目まで探索、2列以上マッチで確定）
3. mapHeaders_() でヘッダー→標準フィールド名マップ作成
4. 各行を buildLead_() でleadオブジェクトに変換
   ├─ 電話番号正規化: ハイフン・スペース除去、+81→0変換、10桁→0補完、11/10桁以外はnull
   ├─ メール正規化: 小文字化、簡易バリデーション（@あり）
   ├─ 日付フィールド: Date型はISO変換、文字列は GMT+0900→+09:00 正規化後にnew Date()
   ├─ heat/status: NORMALIZE辞書で正規化、不明の場合デフォルト値
   └─ email/phone両方なし → null（スキップ）
5. バッチ内重複排除（同一バッチに同じemailが複数あるとPostgreSQL 21000エラー）
   ├─ emailあり: email重複排除 + email側にphoneも入れているためphone重複も除外
   └─ phoneのみ: phone重複排除
6. supabaseBatchUpsert() でバッチ送信（BATCH_SIZE=50件）
   ├─ emailありグループ → on_conflict=email でUPSERT
   └─ phoneのみグループ → on_conflict=phone でUPSERT
```

#### 電話番号ユニーク制約衝突時のリトライ
同じ電話番号が異なるemailで登録されている場合（例：A・B両方のシートに同じ人）、バッチ単位で23505エラーが発生する。以下の順で個別リトライ：
```
1. バッチ全体でUPSERT → 23505(phone)エラー
2. 50件を1件ずつ個別UPSERT
3. 個別でも23505(phone)エラー → phoneフィールドを除いてUPSERT
```
> この処理が遅い原因（バッチ50件→50回APIコール）。特に泊マッチMetaで全行が対象になり1バッチ23秒かかる

#### チェックポイント機能
GASの5分実行制限対策。`PropertiesService.getScriptProperties()` に `IMPORT_CHECKPOINT` として保存：
```json
{ "sheetId": "1zIYwhJ...", "tabName": "タスワンリード情報(統合)" }
```
- タブ完了ごとに上書き保存
- 全タブ完了時に削除
- 次回実行時にチェックポイント以前のタブをスキップ

#### テスト関数
| 関数 | 目的 | 実行時間 |
|------|------|---------|
| `testSupabaseConnection()` | anon key接続確認・SELECT 1件 | 〜2秒 |
| `testImportSample(N)` | 最初の有効タブの先頭N行（デフォルト10）でフルパイプライン | 〜10秒 |
> **運用ルール**: コード変更後は必ず `testImportSample()` で確認してから `importAllLeads()` を実行する

---

### AlertEngine.gs 実装詳細

#### alert_rules テーブルの condition JSON 形式
```json
{
  "status_not_in": ["成約", "失注"],
  "heat_in": ["A", "B"],
  "days_since_last_marketed": 7
}
```

| フィールド | 型 | 意味 |
|------------|-----|------|
| status_not_in | string[] | これらのステータスは除外 |
| heat_in | string[] | この熱度のみ対象 |
| product | string | 商材フィルタ |
| days_since_last_marketed | number | 最終マーケアタックからの経過日数（未設定時はcreated_atを使用） |
| days_since_last_contacted | number | 最終コンタクトからの経過日数 |

#### デフォルトルール（schema.sql で初期投入）
| ルール名 | 条件 | 閾値 |
|---------|------|------|
| 7日間未アタック（A・B熱） | heat_in=[A,B], status_not_in=[成約,失注] | days_since_last_marketed: 7 |
| 14日間未アタック（全リード） | status_not_in=[成約,失注] | days_since_last_marketed: 14 |

#### URLエンコードの注意点
PostgRESTの複合演算子（`not.in.(...)`, `in.(...)`）を使う場合、URLに直接埋め込むと括弧・日本語がInvalid argumentエラーになる。必ず `encodeURIComponent()` でエンコードすること：
```javascript
// NG: &status=not.in.("成約","失注")
// OK:
endpoint += `&status=${encodeURIComponent('not.in.(' + statusList + ')')}`;
```

#### Slackメンション設定
スクリプトプロパティに `SLACK_MENTION_{担当者名}` 形式で登録：
```
SLACK_MENTION_西出 = U012AB3CD
SLACK_MENTION_松村 = U012AB3CE
```
`leads.assigned_to` が担当者名と一致すればメンション付きで通知。

#### 毎朝8時トリガー
```javascript
ScriptApp.newTrigger('runDailyAlerts')
  .timeBased().everyDays(1).atHour(8).inTimezone('Asia/Tokyo').create();
```
重複防止のため `setupDailyAlertTrigger()` 実行時に既存トリガーを削除してから再登録。

---

### スクリプトプロパティ一覧（GASプロジェクト設定）

| プロパティ名 | 内容 |
|------------|------|
| `SUPABASE_URL` | `https://eqogkmauxlwjrweicbgr.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon key（service_role keyではない） |
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/services/...` |
| `SLACK_MENTION_西出` | SlackユーザーID（例: U012AB3CD） |
| `SLACK_MENTION_松村` | SlackユーザーID |

---

### Phase 1 実績

| 項目 | 値 |
|------|-----|
| 取込対象スプレッドシート | 04_リード管理シート　楽待セミナー参加者202506～ |
| 処理タブ数 | 25タブ（うち3タブはヘッダー未検出のためスキップ） |
| インポート操作総数 | 約3,172件（upsert） |
| **Supabase実件数** | **1,650件**（重複排除後のユニーク数） |
| 実行回数 | 3回（チェックポイントで継続） |
| エラー件数 | 0件 |
| 主な流入元タブ | 楽待流入/Meta/セレクトタイプ/泊マッチMeta/外部セミナー 等 |

---

### 既知の制限・TODO

| 項目 | 内容 | 対処時期 |
|------|------|---------|
| 泊マッチMetaが遅い | phone競合で50件→50回APIコール化、1バッチ23秒 | Phase 2以降で改善検討 |
| opted_in_email/sms | 全件falseで取込（シートに同意フラグなし） | 明示的同意取得後に更新 |
| source列未マッピング | 多くのタブにsource列がなくnull | 手動でSupabase更新 or Phase 2のUI |
| メール送信（Resend） | 未実装 | Phase 2 |
| SMS送信（ValueSMS） | 未実装 | Phase 2 |
| LINE送信 | 未実装（申請中） | Phase 3 |
