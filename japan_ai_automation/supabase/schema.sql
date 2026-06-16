-- ============================================================
-- Japan AI Automation CRM — Phase 1 スキーマ
-- Supabase (ap-northeast-1 東京) にそのまま実行してください
-- ============================================================

-- ============ leads（リードマスタ） ============
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid,                          -- Phase 5 SaaS化時にNOT NULL化

  -- 連絡先
  name          text,
  email         text,
  phone         text,                          -- 正規化済: 08012345678（ハイフンなし）

  -- 分類
  source        text,                          -- ゴールドオンライン/楽待/健美家/Meta/紹介等
  referrer_id   text,                          -- パートナー機能用（Phase 5）
  product       text        default 'B-1',     -- B-1/A②/B-2
  status        text        default '未対応',  -- 未対応/アプローチ中/面談済/成約/失注
  heat          text        default 'C',       -- A/B/C（手動入力）
  assigned_to   text,                          -- 西出/松村

  -- タイミング
  last_contacted_at   timestamptz,             -- 最終直接コンタクト日
  last_marketed_at    timestamptz,             -- 最終マーケアタック日
  seminar_date        date,                    -- セミナー参加予定日

  -- 同意（法令対応）
  opted_in_email  boolean     default false,
  opted_in_sms    boolean     default false,
  opted_out       boolean     default false,   -- 配信停止フラグ（必ず送信前チェック）
  opted_in_at     timestamptz,
  opted_in_ip     text,

  -- メタデータ
  notes           text,
  custom_fields   jsonb       default '{}',
  source_tab      text,                        -- インポート元Sheetsタブ名
  source_row      int,                         -- インポート元行番号
  source_sheet_id text,                        -- Google Sheet ID

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- 名寄せ用ユニーク制約（NULL・空文字は除外）
create unique index if not exists idx_leads_email
  on leads(email) where email is not null and email != '';

create unique index if not exists idx_leads_phone
  on leads(phone) where phone is not null and phone != '';

-- 検索・フィルタ用インデックス
create index if not exists idx_leads_status_heat    on leads(status, heat);
create index if not exists idx_leads_assigned_to    on leads(assigned_to);
create index if not exists idx_leads_last_marketed  on leads(last_marketed_at);
create index if not exists idx_leads_product        on leads(product);
create index if not exists idx_leads_opted_out      on leads(opted_out);

-- ============ messages_log（送信ログ） ============
create table if not exists messages_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid,
  lead_id       uuid references leads(id) on delete set null,

  channel       text        not null,          -- email/sms/line
  direction     text        default 'outbound',

  subject       text,                          -- メール件名
  body          text        not null,

  status        text        default 'sent',    -- queued/sent/failed/bounced/opened/clicked
  error         text,

  -- キャンペーン追跡（測定の土台）
  campaign_id   text,                          -- 一斉送信グループID（UUID）
  campaign_name text,                          -- 例: "2026-06-16_B1_未対応A熱"

  sent_by       text        default 'manual',  -- manual/auto
  sent_at       timestamptz default now(),
  dedup_key     text,                          -- 二重送信防止: "{lead_id}_{campaign_id}"

  meta          jsonb       default '{}'
);

create unique index if not exists idx_messages_dedup
  on messages_log(dedup_key) where dedup_key is not null;

create index if not exists idx_messages_lead_id  on messages_log(lead_id, sent_at);
create index if not exists idx_messages_campaign on messages_log(campaign_id);

-- ============ alert_rules（追客アラートルール） ============
create table if not exists alert_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid,

  name        text        not null,
  description text,

  -- 条件（GASが毎朝評価するJSON）
  -- 例: {"days_since_last_marketed": 7, "heat_in": ["A","B"], "status_not_in": ["成約","失注"]}
  -- 例: {"days_since_last_contacted": 14, "heat_in": ["A"], "product": "B-1"}
  condition   jsonb       not null,

  -- 通知メッセージテンプレート
  -- 変数: {name} {phone} {email} {source} {heat} {status} {days_since_marketed}
  message_template  text  not null,

  notify_slack_channel  text    default '#sales-alerts',
  mention_assigned_to   boolean default true,

  active        boolean     default true,
  last_run_at   timestamptz,

  created_at    timestamptz default now()
);

-- ============ デフォルトアラートルール ============
insert into alert_rules (name, description, condition, message_template, notify_slack_channel) values
(
  '7日間未アタック（A・B熱）',
  '熱度A/BのリードにLastマーケアタックから7日以上経過',
  '{"days_since_last_marketed": 7, "heat_in": ["A","B"], "status_not_in": ["成約","失注"]}',
  '🔥 【追客アラート】{name}さん（{heat}熱）\n最終アタック: {days_since_marketed}日前\n電話: {phone}\n流入: {source}',
  '#sales-alerts'
),
(
  '14日間未アタック（全リード）',
  '全ステータスで14日以上アタックなし',
  '{"days_since_last_marketed": 14, "status_not_in": ["成約","失注"]}',
  '⚠️ 【要フォロー】{name}さん\n最終アタック: {days_since_marketed}日前\nステータス: {status} / 熱度: {heat}',
  '#sales-alerts'
)
on conflict do nothing;

-- ============ updated_at 自動更新 ============
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

-- ============ RLS（Phase 1: service_roleのみ） ============
-- GASはservice_role_keyを使用。anon/authenticatedはアクセス不可。
alter table leads          enable row level security;
alter table messages_log   enable row level security;
alter table alert_rules    enable row level security;
-- ポリシーを設定しない = デフォルト拒否。service_roleはRLSをバイパスする。
