-- ============================================================
-- B7: イベント駆動シーケンスエンジン — B-1シーケンスノード定義
-- 実行場所: Supabase SQL Editor
-- 前提: migration_b7_schema.sql / migration_b7_rpcs.sql 実行済み
-- ============================================================
--
-- B-1 DAG 構造:
--
--   [enrolled]
--       │
--       ▼
--   b1-welcome ──────────────────────────────┐
--       │ (node_sent)                         │ (node_sent, schedule_anchor=seminar_date)
--       ▼                                     ▼
--   b1-f72h                             b1-pre-seminar
--   (stop_on: meeting_booked)
--       │ (node_sent)
--       ▼
--   b1-f168h
--   (stop_on: meeting_booked)
--
--   [attended] ──▶ b1-post-attend
--   [absent]   ──▶ b1-post-absent
--
-- ============================================================

INSERT INTO sequence_nodes (
  product, node_key, parent_node_key,
  trigger_event, condition, delay_minutes,
  schedule_anchor, anchor_offset_minutes,
  channel, subject, body, stop_on, active, sort_order
)
VALUES

-- ① b1-welcome: 申込直後ウェルカムメール
(
  'B-1', 'b1-welcome', NULL,
  'enrolled', '{}', 0,
  NULL, 0,
  'email',
  '【Success Japan】セミナーお申込みありがとうございます',
  '{name} 様

この度は「民泊経営パッケージ説明会」にお申込みいただき、誠にありがとうございます。

■ セミナー当日の出席確認
下記URLよりご出席のご確認をお願いいたします。
{attend_url}

■ 個別面談のご予約
セミナー後に個別でご相談も承っております。
[TimeRex面談予約リンクをここに挿入]

ご不明な点がございましたら、お気軽にご返信ください。

Success Japan株式会社
西出 高宏

─────────────────────
メールの配信を停止する場合は下記より手続きください。
{unsubscribe_url}',
  '{}', true, 1
),

-- ② b1-f72h: 72時間後フォロー（面談未予約者向け）
(
  'B-1', 'b1-f72h', 'b1-welcome',
  'node_sent', '{}', 4320,          -- 72h × 60 = 4320 分
  NULL, 0,
  'email',
  '【Success Japan】3日が経ちました — {name} 様へ',
  '{name} 様

先日はセミナーにお申込みいただきありがとうございました。

まだ個別面談のご予約がお済みでない方へ、
改めてご案内させてください。

現在、民泊経営パッケージのご説明会を随時開催しております。
[TimeRex面談予約リンクをここに挿入]

ご都合の合う日時がございましたら、ぜひお気軽にご予約ください。

Success Japan株式会社
西出 高宏

─────────────────────
メールの配信を停止する場合は下記より手続きください。
{unsubscribe_url}',
  '{"meeting_booked": true}', true, 2
),

-- ③ b1-f168h: 7日後フォロー（b1-f72h送信の4日後）
(
  'B-1', 'b1-f168h', 'b1-f72h',
  'node_sent', '{}', 5760,          -- (168-72)h × 60 = 5760 分
  NULL, 0,
  'email',
  '【Success Japan】お役立ち情報：民泊経営の実績',
  '{name} 様

Success Japanの西出です。

先週のセミナーへのご参加（またはご関心）ありがとうございました。

本日は実際に民泊経営パッケージをご利用いただいているオーナー様の
事例をご紹介させていただきます。

[事例・実績をここに記載]

ご興味がございましたら、個別面談でより詳しくご説明いたします。
[TimeRex面談予約リンクをここに挿入]

Success Japan株式会社
西出 高宏

─────────────────────
メールの配信を停止する場合は下記より手続きください。
{unsubscribe_url}',
  '{"meeting_booked": true}', true, 3
),

-- ④ b1-pre-seminar: セミナー前日リマインド（seminar_date の18時間前に送信）
--    seminar_date が未設定の場合は b1-welcome 送信の即時フォールバックになるため
--    active=false で登録し、seminar_date 活用が確立したら有効化する
(
  'B-1', 'b1-pre-seminar', 'b1-welcome',
  'node_sent', '{}', 0,
  'seminar_date', -1080,            -- seminar_date の1080分(18時間)前
  'email',
  '【明日はセミナーです】Success Japan',
  '{name} 様

明日のセミナーをお忘れなく。

■ セミナー詳細
日時: {seminar_date}
[Zoom/会場URLをここに挿入]

■ 出席確認（お手数ですが1クリックお願いします）
{attend_url}

当日お会いできることを楽しみにしております。

Success Japan株式会社
西出 高宏',
  '{}', false, 4
),

-- ⑤ b1-post-attend: 出席確認後フォロー（1時間後）
(
  'B-1', 'b1-post-attend', NULL,
  'attended', '{}', 60,
  NULL, 0,
  'email',
  '【ご出席確認】ありがとうございます',
  '{name} 様

本日のセミナーのご出席確認ありがとうございます。

引き続き個別面談のご予約も承っております。
担当者より改めてご連絡させていただきますが、
ご都合の良いお日にちをあらかじめご選択いただくことも可能です。
[TimeRex面談予約リンクをここに挿入]

当日お会いできることを楽しみにしております。

Success Japan株式会社
西出 高宏',
  '{}', true, 5
),

-- ⑥ b1-post-absent: 欠席（セミナー未出席）フォロー（2時間後）
(
  'B-1', 'b1-post-absent', NULL,
  'absent', '{}', 120,
  NULL, 0,
  'email',
  '【Success Japan】セミナーはいかがでしたか？',
  '{name} 様

本日はセミナーにご参加いただけましたでしょうか。

もしお忙しくご参加が難しかった場合も、
個別面談にてセミナーと同じ内容をご説明することが可能です。
[TimeRex面談予約リンクをここに挿入]

お気軽にご予約ください。

Success Japan株式会社
西出 高宏

─────────────────────
メールの配信を停止する場合は下記より手続きください。
{unsubscribe_url}',
  '{"meeting_booked": true}', true, 6
)

-- ⑦ b1-meeting-booked: 面談予約確認メール（即時）
,
(
  'B-1', 'b1-meeting-booked', NULL,
  'meeting_booked', '{}', 0,
  NULL, 0,
  'email',
  '【面談予約確認】Success Japan',
  '{name} 様

この度は個別面談のご予約ありがとうございます。

担当者より改めてご連絡させていただきます。
当日お会いできることを楽しみにしております。

■ ご不明な点がございましたら
お気軽にご返信いただくか、下記までご連絡ください。
admin@successjapan.jp

Success Japan株式会社
西出 高宏',
  '{}', true, 7
)

ON CONFLICT (product, node_key) DO UPDATE
  SET subject              = EXCLUDED.subject,
      body                 = EXCLUDED.body,
      delay_minutes        = EXCLUDED.delay_minutes,
      schedule_anchor      = EXCLUDED.schedule_anchor,
      anchor_offset_minutes = EXCLUDED.anchor_offset_minutes,
      stop_on              = EXCLUDED.stop_on,
      sort_order           = EXCLUDED.sort_order;

-- ----------------------------------------------------------------
-- 確認クエリ
-- ----------------------------------------------------------------
SELECT product, node_key, trigger_event, parent_node_key,
       delay_minutes, schedule_anchor, active
  FROM sequence_nodes
  WHERE product = 'B-1'
  ORDER BY sort_order;
