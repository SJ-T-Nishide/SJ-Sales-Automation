# Japan AI Automation CRM — セットアップ手順

## 構成

```
japan_ai_automation/
├── supabase/
│   └── schema.sql        ← SupabaseのSQL Editorで実行
└── gas/
    ├── appsscript.json
    ├── Config.gs          ← ヘッダー同義語・設定
    ├── SupabaseClient.gs  ← Supabase APIラッパー
    ├── Importer.gs        ← Sheets → Supabaseインポーター
    └── AlertEngine.gs     ← 毎朝アラート通知
```

---

## Step 1: Supabase プロジェクト作成

1. https://supabase.com → New Project
2. **Region: Northeast Asia (Tokyo)** を必ず選択
3. プロジェクト名: `successjapan-crm`
4. パスワードをメモ
5. 作成後、**SQL Editor** で `supabase/schema.sql` の内容を実行

---

## Step 2: Supabase APIキーを取得

Settings → API から以下をコピー：
- **Project URL**: `https://xxxxxx.supabase.co`
- **service_role key**（`anon` keyではない。秘匿性高）

---

## Step 3: GAS プロジェクト作成

1. https://script.google.com → 新しいプロジェクト
2. プロジェクト名: `Japan AI Automation CRM`
3. 以下のファイルを作成してコードを貼り付け:
   - `Config.gs`
   - `SupabaseClient.gs`
   - `Importer.gs`
   - `AlertEngine.gs`
4. `appsscript.json` の内容でマニフェストを更新

**または clasp で push（推奨）:**
```bash
cd japan_ai_automation/gas
clasp create --title "Japan AI Automation CRM"
clasp push --force
```

---

## Step 4: スクリプトプロパティを設定

GASエディタ → ⚙️ プロジェクトの設定 → スクリプトプロパティ

| キー | 値 |
|------|----|
| `SUPABASE_URL` | `https://xxxxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | supabaseのservice_role key |
| `SLACK_WEBHOOK_URL` | SlackのIncoming Webhook URL |
| `SLACK_MENTION_西出` | `@U123456789`（SlackのユーザーID） |
| `SLACK_MENTION_松村` | `@U987654321`（SlackのユーザーID） |

---

## Step 5: インポート実行

GASエディタで `importAllLeads` を選択して実行。

初回は権限承認が求められます。`admin@successjapan.jp` で承認。

実行ログでインポート結果を確認:
```
=== リードインポート開始 ===
タブ処理中: タスワンリード情報(統合)
  ヘッダー行: 1行目 / 認識列: name, email, phone, status, heat, assigned_to
  メールあり: 120件 UPSERT完了
タブ処理中: 泊マッチMeta
  ...
=== インポート完了 ===
合計: 350行 / インポート: 280件 / スキップ: 70件 / エラー: 0件
```

---

## Step 6: アラートトリガー設定

GASエディタで `setupDailyAlertTrigger` を実行。
→ 毎朝8時（JST）に自動でSlack通知が届くようになります。

---

## 追加スクリプトプロパティ（ValueSMS・Resend）

Phase 2（一斉送信WebApp）で追加:

| キー | 値 |
|------|----|
| `VALUESMS_API_KEY` | ValueSMS APIキー |
| `RESEND_API_KEY` | Resend APIキー |
| `RESEND_FROM_DOMAIN` | `successjapan.jp`（送信元ドメイン） |

---

## 注意事項

- `service_role key` は絶対にコードに直書きしない（PropertiesServiceのみ）
- インポーターは元Sheetsを**読み取り専用**で使用。元データは改変しない
- `opted_out=true` のリードには絶対に送信しない（AlertEngine・WebApp両方でチェック済み）
