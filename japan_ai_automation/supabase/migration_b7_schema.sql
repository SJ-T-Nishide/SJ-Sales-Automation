-- ============================================================
-- B7: イベント駆動シーケンスエンジン — テーブル定義
-- ============================================================

-- ① sequence_nodes: シーケンスノードグラフ（DAG）
CREATE TABLE IF NOT EXISTS sequence_nodes (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product                text        NOT NULL,
  node_key               text        NOT NULL,
  parent_node_key        text,
  trigger_event          text        NOT NULL DEFAULT 'node_sent',
  condition              jsonb       NOT NULL DEFAULT '{}',
  delay_minutes          integer     NOT NULL DEFAULT 0,
  schedule_anchor        text,                          -- 'seminar_date' or NULL（relative）
  anchor_offset_minutes  integer     NOT NULL DEFAULT 0,-- anchor からのオフセット（分）
  channel                text        NOT NULL DEFAULT 'email',
  subject                text,
  body                   text,
  stop_on                jsonb       NOT NULL DEFAULT '{}',
  active                 boolean     NOT NULL DEFAULT true,
  sort_order             integer     NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sequence_nodes UNIQUE (product, node_key)
);

CREATE INDEX IF NOT EXISTS idx_sequence_nodes_product
  ON sequence_nodes (product) WHERE active;
CREATE INDEX IF NOT EXISTS idx_sequence_nodes_trigger
  ON sequence_nodes (trigger_event, parent_node_key);

-- ② lead_sequence_runs: リードごとのノード実行予約（v2エンジンの状態）
CREATE TABLE IF NOT EXISTS lead_sequence_runs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  node_id      uuid        NOT NULL REFERENCES sequence_nodes(id),
  product      text        NOT NULL,
  node_key     text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending',  -- pending|sent|skipped|cancelled|failed
  scheduled_at timestamptz NOT NULL,
  sent_at      timestamptz,
  locked_until timestamptz,
  attempts     integer     NOT NULL DEFAULT 0,
  dedup_key    text        UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_due
  ON lead_sequence_runs (scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_runs_lead
  ON lead_sequence_runs (lead_id);
CREATE INDEX IF NOT EXISTS idx_runs_status
  ON lead_sequence_runs (status);

-- ③ lead_events: イベントログ（append-only）
CREATE TABLE IF NOT EXISTS lead_events (
  id          bigserial   PRIMARY KEY,
  lead_id     uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type  text        NOT NULL,  -- enrolled|attended|absent|meeting_booked|node_sent|opted_out
  product     text,
  node_key    text,                  -- node_sent イベント時のみ
  payload     jsonb       NOT NULL DEFAULT '{}',
  processed   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_unprocessed
  ON lead_events (created_at) WHERE NOT processed;
CREATE INDEX IF NOT EXISTS idx_lead_events_lead
  ON lead_events (lead_id);

-- ④ leads に新規列を追加
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS meeting_booked      boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meeting_booked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS seminar_date        timestamptz,
  ADD COLUMN IF NOT EXISTS sequence_version    smallint     NOT NULL DEFAULT 1;
-- sequence_version: 1=旧直線エンジン(SequenceEngine.gs), 2=新DAGエンジン(EventProcessor.gs)

CREATE INDEX IF NOT EXISTS idx_leads_seq_version
  ON leads (sequence_version) WHERE opted_out = false;
