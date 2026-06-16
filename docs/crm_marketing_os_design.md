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
