-- ============================================================
-- B7: イベント駆動シーケンスエンジン — RPC定義
-- 実行場所: Supabase SQL Editor
-- 前提: migration_b7_schema.sql 実行済み
-- ============================================================

-- ----------------------------------------------------------------
-- RLS 設定（新規テーブル3つ）
-- ----------------------------------------------------------------
ALTER TABLE sequence_nodes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sequence_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events         ENABLE ROW LEVEL SECURITY;

-- sequence_nodes は anon が SELECT できる（GAS から直接参照する場合に備え）
CREATE POLICY "anon_select_sequence_nodes"
  ON sequence_nodes FOR SELECT TO anon USING (true);

-- lead_sequence_runs / lead_events は SECURITY DEFINER RPC 経由のみ
-- （直接 SELECT/INSERT/UPDATE/DELETE は不可）

-- ----------------------------------------------------------------
-- ① enroll_lead_v2 — リードをv2エンジンに登録し enrolled イベントを発行
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION enroll_lead_v2(
  p_lead_id uuid,
  p_product  text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead leads%rowtype;
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'lead_not_found');
  END IF;
  IF v_lead.opted_out THEN
    RETURN json_build_object('ok', false, 'error', 'opted_out');
  END IF;
  -- 既にv2登録済みなら enrolled イベントだけ発行しない（冪等）
  IF v_lead.sequence_version = 2 THEN
    RETURN json_build_object('ok', true, 'already', true);
  END IF;

  UPDATE leads
    SET sequence_version     = 2,
        sequence_enrolled_at = COALESCE(sequence_enrolled_at, now()),
        opted_in_email       = true
    WHERE id = p_lead_id;

  INSERT INTO lead_events (lead_id, event_type, product, payload)
    VALUES (
      p_lead_id,
      'enrolled',
      p_product,
      jsonb_build_object('product', p_product)
    );

  RETURN json_build_object('ok', true, 'already', false);
END;
$$;

GRANT EXECUTE ON FUNCTION enroll_lead_v2(uuid, text) TO anon;

-- ----------------------------------------------------------------
-- ② fan_out_lead_events — 未処理イベントを読み、子ノードをスケジュール
--
-- ノード検索ルール:
--   enrolled / attended / absent / meeting_booked イベント
--     → trigger_event が一致し parent_node_key IS NULL のノード
--   node_sent イベント
--     → trigger_event = 'node_sent' かつ parent_node_key = event.node_key
--
-- condition 評価（JSONB key-value）:
--   空 {} → 常にパス
--   {"attended": true}      → v_lead.attended = true のみ
--   {"meeting_booked": false} → v_lead.meeting_booked = false のみ
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fan_out_lead_events(p_limit int DEFAULT 50)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event  lead_events%rowtype;
  v_node   sequence_nodes%rowtype;
  v_lead   leads%rowtype;
  v_sched  timestamptz;
  v_pass   boolean;
  v_count  int := 0;
BEGIN
  FOR v_event IN
    SELECT * FROM lead_events
    WHERE processed = false
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    -- リードを取得（opted_out はスキップ）
    SELECT * INTO v_lead FROM leads WHERE id = v_event.lead_id LIMIT 1;
    IF NOT FOUND OR v_lead.opted_out THEN
      UPDATE lead_events SET processed = true WHERE id = v_event.id;
      CONTINUE;
    END IF;

    -- 子ノードを検索
    FOR v_node IN
      SELECT * FROM sequence_nodes
      WHERE product      = v_event.product
        AND trigger_event = v_event.event_type
        AND (
          (v_event.event_type = 'node_sent'
            AND parent_node_key = v_event.node_key)
          OR
          (v_event.event_type != 'node_sent'
            AND parent_node_key IS NULL)
        )
        AND active = true
      ORDER BY sort_order ASC
    LOOP
      -- condition 評価
      v_pass := true;
      IF v_node.condition != '{}' THEN
        IF (v_node.condition ->> 'attended') IS NOT NULL
           AND (v_node.condition ->> 'attended')::bool
               IS DISTINCT FROM v_lead.attended THEN
          v_pass := false;
        END IF;
        IF v_pass AND (v_node.condition ->> 'meeting_booked') IS NOT NULL
           AND (v_node.condition ->> 'meeting_booked')::bool
               IS DISTINCT FROM v_lead.meeting_booked THEN
          v_pass := false;
        END IF;
      END IF;
      IF NOT v_pass THEN CONTINUE; END IF;

      -- scheduled_at 計算
      IF v_node.schedule_anchor = 'seminar_date'
         AND v_lead.seminar_date IS NOT NULL THEN
        v_sched := v_lead.seminar_date
                   + (v_node.anchor_offset_minutes::text || ' minutes')::interval;
      ELSE
        v_sched := now()
                   + (v_node.delay_minutes::text || ' minutes')::interval;
      END IF;

      -- lead_sequence_runs に予約（dedup_key で冪等）
      INSERT INTO lead_sequence_runs
        (lead_id, node_id, product, node_key, status, scheduled_at, dedup_key)
      VALUES
        (
          v_lead.id,
          v_node.id,
          v_node.product,
          v_node.node_key,
          'pending',
          v_sched,
          v_lead.id::text || ':' || v_node.node_key
        )
      ON CONFLICT (dedup_key) DO NOTHING;
    END LOOP;

    UPDATE lead_events SET processed = true WHERE id = v_event.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION fan_out_lead_events(int) TO anon;

-- ----------------------------------------------------------------
-- ③ claim_due_runs — 送信対象を8分ロックしてリード+ノード情報付きで返す
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_due_runs(p_limit int DEFAULT 10)
RETURNS TABLE(
  run_id            uuid,
  lead_id           uuid,
  node_id           uuid,
  product           text,
  node_key          text,
  channel           text,
  subject           text,
  body              text,
  lead_name         text,
  lead_email        text,
  lead_phone        text,
  line_uid          text,
  unsubscribe_token text,
  attendance_token  text,
  seminar_date      timestamptz,
  meeting_booked    boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    UPDATE lead_sequence_runs r
      SET locked_until = now() + interval '8 minutes',
          attempts     = r.attempts + 1
      WHERE r.id IN (
        SELECT r2.id
        FROM lead_sequence_runs r2
        JOIN leads          l2 ON l2.id = r2.lead_id
        JOIN sequence_nodes n2 ON n2.id = r2.node_id
        WHERE r2.status        = 'pending'
          AND r2.scheduled_at <= now()
          AND (r2.locked_until IS NULL OR r2.locked_until < now())
          AND l2.opted_out      = false
          AND l2.opted_in_email = true
          -- stop_on: meeting_booked チェック
          AND NOT (
            (n2.stop_on ->> 'meeting_booked' = 'true')
            AND l2.meeting_booked = true
          )
        ORDER BY r2.scheduled_at ASC
        LIMIT p_limit
        FOR UPDATE OF r2 SKIP LOCKED
      )
      RETURNING r.*
  )
  SELECT
    c.id            AS run_id,
    c.lead_id,
    c.node_id,
    c.product,
    c.node_key,
    n.channel,
    n.subject,
    n.body,
    l.name          AS lead_name,
    l.email         AS lead_email,
    l.phone         AS lead_phone,
    l.line_uid,
    l.unsubscribe_token,
    l.attendance_token,
    l.seminar_date,
    l.meeting_booked
  FROM claimed      c
  JOIN leads          l ON l.id = c.lead_id
  JOIN sequence_nodes n ON n.id = c.node_id;
$$;

GRANT EXECUTE ON FUNCTION claim_due_runs(int) TO anon;

-- ----------------------------------------------------------------
-- ④ complete_run — 送信完了/スキップを記録し node_sent イベントを発行
-- p_status: 'sent' | 'skipped' | 'failed'
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_run(
  p_run_id uuid,
  p_status text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run lead_sequence_runs%rowtype;
BEGIN
  UPDATE lead_sequence_runs
    SET status  = p_status,
        sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE NULL END
    WHERE id = p_run_id
      AND status = 'pending'   -- 二重完了防止
    RETURNING * INTO v_run;

  IF NOT FOUND THEN
    -- 既に処理済みの場合は silent ok
    RETURN json_build_object('ok', true, 'skipped', true);
  END IF;

  -- 送信成功時は node_sent イベントを発行（fan_out が次ノードをスケジュール）
  IF p_status = 'sent' THEN
    INSERT INTO lead_events (lead_id, event_type, product, node_key, payload)
    VALUES (
      v_run.lead_id,
      'node_sent',
      v_run.product,
      v_run.node_key,
      jsonb_build_object('run_id', p_run_id, 'node_key', v_run.node_key)
    );
  END IF;

  RETURN json_build_object('ok', true, 'skipped', false, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION complete_run(uuid, text) TO anon;

-- ----------------------------------------------------------------
-- ⑤ cancel_runs_for_lead — リードの pending ランを一括キャンセル
-- meeting_booked 検知時などに呼び出す
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_runs_for_lead(
  p_lead_id uuid,
  p_product  text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE lead_sequence_runs
    SET status = 'cancelled'
    WHERE lead_id = p_lead_id
      AND status  = 'pending'
      AND (p_product IS NULL OR product = p_product);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('ok', true, 'cancelled', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_runs_for_lead(uuid, text) TO anon;

-- ----------------------------------------------------------------
-- ⑥ mark_absent_after_seminar — セミナー日時超過・未出席リードに absent 発行
-- GAS のデイリートリガーから呼び出す
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_absent_after_seminar()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead    leads%rowtype;
  v_product text;
  v_count   int := 0;
BEGIN
  FOR v_lead IN
    SELECT * FROM leads
    WHERE sequence_version = 2
      AND attended         = false
      AND opted_out        = false
      AND seminar_date IS NOT NULL
      AND seminar_date < now() - interval '1 hour'
      AND NOT EXISTS (
        SELECT 1 FROM lead_events
        WHERE lead_id    = leads.id
          AND event_type = 'absent'
      )
  LOOP
    -- enrolled イベントからプロダクトを取得
    SELECT product INTO v_product
    FROM lead_events
    WHERE lead_id    = v_lead.id
      AND event_type = 'enrolled'
    ORDER BY created_at DESC
    LIMIT 1;

    INSERT INTO lead_events (lead_id, event_type, product, payload)
    VALUES (v_lead.id, 'absent', v_product, '{}');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_absent_after_seminar() TO anon;

-- ----------------------------------------------------------------
-- ⑦ attend_by_token（v2対応版 — b3版を上書き）
-- 変更点: v2リードに attended イベントを発行し lead_id を返す
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION attend_by_token(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead leads%rowtype;
  v_product text;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN json_build_object('ok', false, 'error', 'token_required');
  END IF;

  SELECT * INTO v_lead
    FROM leads
    WHERE attendance_token = p_token
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF v_lead.attended THEN
    RETURN json_build_object('ok', true, 'already', true,
      'name', v_lead.name, 'lead_id', v_lead.id);
  END IF;

  UPDATE leads
    SET attended    = true,
        attended_at = now()
    WHERE id = v_lead.id;

  -- v2エンジン: attended イベントを発行（fan_out が出席後ノードをスケジュール）
  IF v_lead.sequence_version = 2 THEN
    SELECT product INTO v_product
      FROM lead_events
      WHERE lead_id    = v_lead.id
        AND event_type = 'enrolled'
      ORDER BY created_at DESC
      LIMIT 1;

    INSERT INTO lead_events (lead_id, event_type, product, payload)
    VALUES (
      v_lead.id, 'attended', v_product,
      jsonb_build_object('token', p_token)
    );
  END IF;

  RETURN json_build_object('ok', true, 'already', false,
    'name', v_lead.name, 'lead_id', v_lead.id);
END;
$$;

GRANT EXECUTE ON FUNCTION attend_by_token(text) TO anon;

-- ----------------------------------------------------------------
-- ⑧ unsubscribe_by_token（v2対応版 — b3版を上書き）
-- 変更点: v2リードの pending ランをキャンセル
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION unsubscribe_by_token(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead leads%rowtype;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN json_build_object('ok', false, 'error', 'token_required');
  END IF;

  SELECT * INTO v_lead
    FROM leads
    WHERE unsubscribe_token = p_token
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF v_lead.opted_out THEN
    RETURN json_build_object('ok', true, 'already', true, 'name', v_lead.name);
  END IF;

  UPDATE leads
    SET opted_out     = true,
        sequence_step = 0
    WHERE id = v_lead.id;

  -- v2エンジン: pending ランを一括キャンセル
  IF v_lead.sequence_version = 2 THEN
    UPDATE lead_sequence_runs
      SET status = 'cancelled'
      WHERE lead_id = v_lead.id
        AND status  = 'pending';

    INSERT INTO lead_events (lead_id, event_type, product, payload)
    VALUES (v_lead.id, 'opted_out', NULL, '{}');
  END IF;

  RETURN json_build_object('ok', true, 'already', false, 'name', v_lead.name);
END;
$$;

GRANT EXECUTE ON FUNCTION unsubscribe_by_token(text) TO anon;

-- ----------------------------------------------------------------
-- ⑨ record_meeting_booked — 面談予約を記録（TimeRex/Calendly webhook用）
-- meeting_booked=true に更新し、v2リードには meeting_booked イベントを発行
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_meeting_booked(
  p_lead_id    uuid,
  p_product    text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead    leads%rowtype;
  v_product text;
  v_count   int;
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  UPDATE leads
    SET meeting_booked    = true,
        meeting_booked_at = now(),
        stage_key         = CASE
          WHEN stage_key IN ('new','approached') THEN 'met'
          ELSE stage_key
        END
    WHERE id = p_lead_id;

  -- pending ランを一括キャンセル（meeting_booked → stop_on で止まる前に明示キャンセル）
  UPDATE lead_sequence_runs
    SET status = 'cancelled'
    WHERE lead_id = p_lead_id
      AND status  = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- v2エンジン: meeting_booked イベントを発行（フォローノードをスケジュール）
  IF v_lead.sequence_version = 2 THEN
    v_product := COALESCE(
      p_product,
      (SELECT product FROM lead_events
       WHERE lead_id = p_lead_id AND event_type = 'enrolled'
       ORDER BY created_at DESC LIMIT 1)
    );

    INSERT INTO lead_events (lead_id, event_type, product, payload)
    VALUES (
      p_lead_id, 'meeting_booked', v_product,
      jsonb_build_object('cancelled_runs', v_count)
    );
  END IF;

  RETURN json_build_object('ok', true, 'cancelled_runs', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION record_meeting_booked(uuid, text) TO anon;

-- ----------------------------------------------------------------
-- ⑩ claim_leads_for_sending（v2除外版 — b2版を上書き）
-- sequence_version = 2 のリードは EventProcessor に委譲するため除外
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_leads_for_sending(p_limit int DEFAULT 20)
RETURNS SETOF leads
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE leads
  SET sending_locked_until = now() + interval '8 minutes'
  WHERE id IN (
    SELECT id FROM leads
    WHERE sequence_step > 0
      AND sequence_version != 2        -- v2リードはEventProcessorが担当
      AND opted_in_email   = true
      AND opted_out        = false
      AND (sending_locked_until IS NULL OR sending_locked_until < now())
      AND sequence_enrolled_at IS NOT NULL
    ORDER BY sequence_enrolled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

GRANT EXECUTE ON FUNCTION claim_leads_for_sending(int) TO anon;

-- ----------------------------------------------------------------
-- 確認クエリ
-- ----------------------------------------------------------------
SELECT routine_name, routine_type
  FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_name IN (
      'enroll_lead_v2',
      'fan_out_lead_events',
      'claim_due_runs',
      'complete_run',
      'cancel_runs_for_lead',
      'mark_absent_after_seminar',
      'attend_by_token',
      'unsubscribe_by_token',
      'record_meeting_booked'
    )
  ORDER BY routine_name;
