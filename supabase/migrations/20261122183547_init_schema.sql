-- Slice 2: schema, RLS lock-down, hold_seats. Demo data lives in seed.sql only.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Enums (spec.md)
-- ---------------------------------------------------------------------------
CREATE TYPE public.seat_status AS ENUM (
  'house',
  'available_t2m',
  'pullout_pending',
  'direct_buy',
  'on_hold',
  'sold_t2m',
  'sold_direct'
);

CREATE TYPE public.t2m_status AS ENUM (
  'available',
  'unavailable',
  'sold',
  'unknown'
);

CREATE TYPE public.order_status AS ENUM (
  'sent_payment_info',
  'payment_submitted',
  'paid',
  'sent_claim_code',
  'cancelled',
  'process_manually'
);

CREATE TYPE public.discount_card AS ENUM ('none', 'pwd', 'senior');

CREATE TYPE public.applied_discount AS ENUM ('none', 'promo', 'rebate');

CREATE TYPE public.payment_platform AS ENUM ('gcash', 'bpi', 'maya');

CREATE TYPE public.showbuy_coverage AS ENUM ('full', 'partial');

CREATE TYPE public.email_type AS ENUM ('payment_info', 'claim_code');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.showbuys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  event_url text NOT NULL,
  t2m_show_id text NOT NULL,
  last_synced_at timestamptz,
  has_backend_access boolean NOT NULL DEFAULT false,
  coverage public.showbuy_coverage NOT NULL DEFAULT 'full',
  t2m_fee_percent numeric(5, 2) NOT NULL
    CONSTRAINT showbuys_fee_range CHECK (t2m_fee_percent >= 0 AND t2m_fee_percent <= 100),
  capital_investment_centavos integer NOT NULL
    CONSTRAINT showbuys_capital_nonneg CHECK (capital_investment_centavos >= 0),
  other_expenses jsonb NOT NULL DEFAULT '[]'::jsonb,
  claim_code_template text NOT NULL,
  deduct_card_rebates boolean NOT NULL DEFAULT false,
  sync_interval_minutes integer NOT NULL DEFAULT 60
    CONSTRAINT showbuys_sync_positive CHECK (sync_interval_minutes > 0),
  orders_paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showbuy_id uuid NOT NULL REFERENCES public.showbuys (id) ON DELETE CASCADE,
  platform public.payment_platform NOT NULL,
  account_name text NOT NULL,
  account_number text NOT NULL,
  qr_code_path text,
  UNIQUE (id, showbuy_id)
);

CREATE TABLE public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showbuy_id uuid NOT NULL REFERENCES public.showbuys (id) ON DELETE CASCADE,
  name text NOT NULL,
  regular_price_centavos integer NOT NULL
    CONSTRAINT sections_price_nonneg CHECK (regular_price_centavos >= 0),
  t2m_ticket_type_ids integer[] NOT NULL DEFAULT '{}',
  UNIQUE (id, showbuy_id)
);

CREATE TABLE public.promos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showbuy_id uuid NOT NULL REFERENCES public.showbuys (id) ON DELETE CASCADE,
  code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  price_centavos_by_section jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_single_seat boolean NOT NULL DEFAULT false,
  usage_limit integer
    CONSTRAINT promos_usage_nonneg CHECK (usage_limit IS NULL OR usage_limit >= 0),
  UNIQUE (id, showbuy_id),
  UNIQUE (showbuy_id, code)
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showbuy_id uuid NOT NULL REFERENCES public.showbuys (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  email text NOT NULL,
  mobile text NOT NULL,
  preferred_section_id uuid NOT NULL,
  qty integer NOT NULL CONSTRAINT orders_qty_positive CHECK (qty > 0),
  first_choice_seat_ids uuid[] NOT NULL,
  second_choice_seat_ids uuid[] NOT NULL,
  promo_code text,
  promo_id uuid,
  discount_card public.discount_card NOT NULL DEFAULT 'none',
  payment_account_id uuid NOT NULL,
  status public.order_status NOT NULL DEFAULT 'sent_payment_info',
  held_seat_ids uuid[] NOT NULL DEFAULT '{}',
  tickets jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_centavos integer NOT NULL CONSTRAINT orders_total_nonneg CHECK (total_centavos >= 0),
  applied_discount public.applied_discount NOT NULL DEFAULT 'none',
  card_rebate_centavos integer NOT NULL DEFAULT 0
    CONSTRAINT orders_card_rebate_nonneg CHECK (card_rebate_centavos >= 0),
  payment_email_sent_at timestamptz,
  hold_expires_at timestamptz NOT NULL,
  payment_confirmed_at timestamptz,
  claim_code text,
  claim_email_sent_at timestamptz,
  manual_reason text,
  idempotency_key text NOT NULL,
  receipt_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  CONSTRAINT orders_preferred_section_same_showbuy
    FOREIGN KEY (preferred_section_id, showbuy_id)
    REFERENCES public.sections (id, showbuy_id),
  CONSTRAINT orders_payment_account_same_showbuy
    FOREIGN KEY (payment_account_id, showbuy_id)
    REFERENCES public.payment_accounts (id, showbuy_id),
  CONSTRAINT orders_promo_same_showbuy
    FOREIGN KEY (promo_id, showbuy_id)
    REFERENCES public.promos (id, showbuy_id),
  CONSTRAINT orders_choice_lengths CHECK (
    cardinality(first_choice_seat_ids) = qty
    AND cardinality(second_choice_seat_ids) = qty
  ),
  CONSTRAINT orders_no_cancel_after_pay CHECK (
    payment_confirmed_at IS NULL OR status <> 'cancelled'::public.order_status
  ),
  CONSTRAINT orders_promo_rebate_zero CHECK (
    applied_discount <> 'promo'::public.applied_discount OR card_rebate_centavos = 0
  ),
  UNIQUE (showbuy_id, idempotency_key),
  UNIQUE (receipt_token)
);

-- total_centavos must equal sum of ticket pricePerSeatCentavos (CHECK cannot use subqueries)
CREATE OR REPLACE FUNCTION public.orders_enforce_total_matches_tickets()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sum integer;
BEGIN
  SELECT coalesce(sum((ticket ->> 'pricePerSeatCentavos')::integer), 0)
  INTO v_sum
  FROM jsonb_array_elements(NEW.tickets) AS ticket;
  IF NEW.total_centavos IS DISTINCT FROM v_sum THEN
    RAISE EXCEPTION 'total_centavos must equal sum of ticket prices';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_enforce_total_matches_tickets_trg
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_enforce_total_matches_tickets();


CREATE UNIQUE INDEX orders_claim_code_uidx
  ON public.orders (claim_code)
  WHERE claim_code IS NOT NULL;

CREATE TABLE public.seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showbuy_id uuid NOT NULL REFERENCES public.showbuys (id) ON DELETE CASCADE,
  section_id uuid NOT NULL,
  t2m_seat_id integer NOT NULL,
  row_label text NOT NULL,
  seat_number integer NOT NULL,
  grid_row integer NOT NULL,
  position integer NOT NULL,
  status public.seat_status NOT NULL,
  t2m_status public.t2m_status NOT NULL DEFAULT 'unknown',
  t2m_sale_price_centavos integer
    CONSTRAINT seats_t2m_sale_nonneg CHECK (
      t2m_sale_price_centavos IS NULL OR t2m_sale_price_centavos >= 0
    ),
  conflict text,
  active_order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  CONSTRAINT seats_section_same_showbuy
    FOREIGN KEY (section_id, showbuy_id)
    REFERENCES public.sections (id, showbuy_id),
  CONSTRAINT seats_one_active_order CHECK (
    active_order_id IS NULL
    OR status IN (
      'on_hold'::public.seat_status,
      'sold_direct'::public.seat_status
    )
  ),
  UNIQUE (id, showbuy_id),
  UNIQUE (showbuy_id, t2m_seat_id),
  UNIQUE (showbuy_id, grid_row, position)
);

CREATE TABLE public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  showbuy_id uuid NOT NULL REFERENCES public.showbuys (id) ON DELETE CASCADE,
  file_path text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  check_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT receipts_order_same_showbuy
    FOREIGN KEY (order_id) REFERENCES public.orders (id)
);

-- Ensure receipt order belongs to same showbuy (trigger keeps it simple + enforceable)
CREATE OR REPLACE FUNCTION public.receipts_enforce_showbuy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_showbuy uuid;
BEGIN
  SELECT o.showbuy_id INTO v_showbuy FROM public.orders o WHERE o.id = NEW.order_id;
  IF v_showbuy IS NULL OR v_showbuy <> NEW.showbuy_id THEN
    RAISE EXCEPTION 'receipt showbuy_id must match order';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER receipts_enforce_showbuy_trg
  BEFORE INSERT OR UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.receipts_enforce_showbuy();

CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  email_type public.email_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  UNIQUE (order_id, email_type)
);

CREATE TABLE public.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showbuy_id uuid NOT NULL REFERENCES public.showbuys (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  showbuy_id uuid,
  order_id uuid,
  result text NOT NULL,
  latency_ms integer,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX seats_showbuy_status_idx ON public.seats (showbuy_id, status);
CREATE INDEX orders_showbuy_status_idx ON public.orders (showbuy_id, status);
CREATE INDEX audit_log_showbuy_idx ON public.audit_log (showbuy_id, at DESC);

-- ---------------------------------------------------------------------------
-- RLS: enable everywhere; no policies for anon/authenticated
-- ---------------------------------------------------------------------------
ALTER TABLE public.showbuys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Privileges: server (service_role) only
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO postgres, service_role, anon, authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON ROUTINES TO service_role;

-- ---------------------------------------------------------------------------
-- hold_seats: lock showbuy, recheck, first then second choice, save winning quote
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hold_seats(
  p_showbuy_id uuid,
  p_idempotency_key text,
  p_name text,
  p_email text,
  p_mobile text,
  p_preferred_section_id uuid,
  p_qty integer,
  p_first_choice uuid[],
  p_second_choice uuid[],
  p_first_quote jsonb,
  p_second_quote jsonb,
  p_promo_code text,
  p_discount_card public.discount_card,
  p_payment_account_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing uuid;
  v_paused boolean;
  v_section_ok boolean;
  v_pay_ok boolean;
  v_promo public.promos%ROWTYPE;
  v_promo_code text;
  v_promo_uses integer;
  v_choice uuid[];
  v_quote jsonb;
  v_seat public.seats%ROWTYPE;
  v_neighbor public.seats%ROWTYPE;
  v_order_id uuid;
  v_tickets jsonb;
  v_total integer;
  v_applied public.applied_discount;
  v_card_disc integer;
  v_ok boolean;
  v_i integer;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key required' USING ERRCODE = '22023';
  END IF;

  -- Serialize holds / promo / SINGLE / sync intent for this showbuy
  SELECT s.orders_paused INTO v_paused
  FROM public.showbuys s
  WHERE s.id = p_showbuy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'showbuy not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT o.id INTO v_existing
  FROM public.orders o
  WHERE o.showbuy_id = p_showbuy_id AND o.idempotency_key = p_idempotency_key;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_paused THEN
    RAISE EXCEPTION 'orders paused' USING ERRCODE = 'P0001';
  END IF;

  IF p_qty IS NULL OR p_qty < 1
     OR cardinality(p_first_choice) IS DISTINCT FROM p_qty
     OR cardinality(p_second_choice) IS DISTINCT FROM p_qty THEN
    RAISE EXCEPTION 'qty/choice length mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.sections sec
    WHERE sec.id = p_preferred_section_id AND sec.showbuy_id = p_showbuy_id
  ) INTO v_section_ok;
  IF NOT v_section_ok THEN
    RAISE EXCEPTION 'preferred section not in showbuy' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.payment_accounts pa
    WHERE pa.id = p_payment_account_id AND pa.showbuy_id = p_showbuy_id
  ) INTO v_pay_ok;
  IF NOT v_pay_ok THEN
    RAISE EXCEPTION 'payment account not in showbuy' USING ERRCODE = '22023';
  END IF;

  v_promo_code := NULLIF(lower(trim(COALESCE(p_promo_code, ''))), '');
  IF v_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo
    FROM public.promos pr
    WHERE pr.showbuy_id = p_showbuy_id AND pr.code = v_promo_code
    FOR UPDATE;
    IF NOT FOUND OR NOT v_promo.active THEN
      RAISE EXCEPTION 'promo inactive or missing' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*)::integer INTO v_promo_uses
    FROM public.orders o
    WHERE o.showbuy_id = p_showbuy_id
      AND o.promo_id = v_promo.id
      AND o.status <> 'cancelled'::public.order_status;
    IF v_promo.usage_limit IS NOT NULL AND v_promo_uses >= v_promo.usage_limit THEN
      RAISE EXCEPTION 'promo usage limit reached' USING ERRCODE = 'P0001';
    END IF;
    IF v_promo.requires_single_seat AND p_qty <> 1 THEN
      RAISE EXCEPTION 'SINGLE requires qty 1' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Try first choice, then second
  v_ok := false;
  FOR v_i IN 1..2 LOOP
    IF v_i = 1 THEN
      v_choice := p_first_choice;
      v_quote := p_first_quote;
    ELSE
      v_choice := p_second_choice;
      v_quote := p_second_quote;
    END IF;

    IF v_quote IS NULL
       OR jsonb_typeof(v_quote -> 'tickets') <> 'array'
       OR jsonb_array_length(v_quote -> 'tickets') <> p_qty
       OR (v_quote ->> 'totalCentavos') IS NULL THEN
      CONTINUE;
    END IF;

    -- Lock seats in stable order, then recheck each
    v_ok := true;
    PERFORM 1
    FROM public.seats s
    WHERE s.id = ANY (v_choice) AND s.showbuy_id = p_showbuy_id
    ORDER BY s.id
    FOR UPDATE;

    IF (SELECT count(*) FROM public.seats s WHERE s.id = ANY (v_choice) AND s.showbuy_id = p_showbuy_id)
       <> p_qty THEN
      v_ok := false;
    ELSE
      FOR v_seat IN
        SELECT s.* FROM public.seats s
        WHERE s.id = ANY (v_choice) AND s.showbuy_id = p_showbuy_id
        ORDER BY s.id
      LOOP
        IF v_seat.section_id IS DISTINCT FROM p_preferred_section_id THEN
          v_ok := false; EXIT;
        END IF;
        IF v_seat.status <> 'direct_buy'::public.seat_status OR v_seat.conflict IS NOT NULL
           OR v_seat.active_order_id IS NOT NULL THEN
          v_ok := false; EXIT;
        END IF;

        IF v_promo_code IS NOT NULL AND v_promo.requires_single_seat THEN
          SELECT n.* INTO v_neighbor
          FROM public.seats n
          WHERE n.showbuy_id = p_showbuy_id
            AND n.grid_row = v_seat.grid_row
            AND n.position IN (v_seat.position - 1, v_seat.position + 1)
            AND n.status IN (
              'direct_buy'::public.seat_status,
              'available_t2m'::public.seat_status
            )
          LIMIT 1;
          IF FOUND THEN
            v_ok := false; EXIT;
          END IF;
        END IF;
      END LOOP;
    END IF;

    IF v_ok THEN
      v_tickets := v_quote -> 'tickets';
      v_total := (v_quote ->> 'totalCentavos')::integer;
      v_applied := COALESCE((v_quote ->> 'appliedDiscount')::public.applied_discount, 'none');
      v_card_disc := COALESCE((v_quote ->> 'cardRebateCentavos')::integer, 0);
      IF v_total < 0 OR v_card_disc < 0 THEN
        RAISE EXCEPTION 'quote money must be >= 0' USING ERRCODE = '22023';
      END IF;
      IF v_applied = 'promo'::public.applied_discount AND v_card_disc <> 0 THEN
        RAISE EXCEPTION 'promo quote must have zero rebate' USING ERRCODE = '22023';
      END IF;
      IF v_total <> (
        SELECT coalesce(sum((ticket ->> 'pricePerSeatCentavos')::integer), 0)
        FROM jsonb_array_elements(v_tickets) AS ticket
      ) THEN
        RAISE EXCEPTION 'totalCentavos must equal sum of ticket prices' USING ERRCODE = '22023';
      END IF;
      EXIT;
    END IF;
  END LOOP;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'neither choice available' USING ERRCODE = 'P0001';
  END IF;

  -- Re-check promo limit inside lock after seat checks
  IF v_promo_code IS NOT NULL THEN
    SELECT count(*)::integer INTO v_promo_uses
    FROM public.orders o
    WHERE o.showbuy_id = p_showbuy_id
      AND o.promo_id = v_promo.id
      AND o.status <> 'cancelled'::public.order_status;
    IF v_promo.usage_limit IS NOT NULL AND v_promo_uses >= v_promo.usage_limit THEN
      RAISE EXCEPTION 'promo usage limit reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.orders (
    showbuy_id,
    name,
    email,
    mobile,
    preferred_section_id,
    qty,
    first_choice_seat_ids,
    second_choice_seat_ids,
    promo_code,
    promo_id,
    discount_card,
    payment_account_id,
    status,
    held_seat_ids,
    tickets,
    total_centavos,
    applied_discount,
    card_rebate_centavos,
    hold_expires_at,
    idempotency_key
  ) VALUES (
    p_showbuy_id,
    p_name,
    p_email,
    p_mobile,
    p_preferred_section_id,
    p_qty,
    p_first_choice,
    p_second_choice,
    v_promo_code,
    CASE WHEN v_promo_code IS NOT NULL THEN v_promo.id ELSE NULL END,
    p_discount_card,
    p_payment_account_id,
    'sent_payment_info'::public.order_status,
    v_choice,
    v_tickets,
    v_total,
    v_applied,
    v_card_disc,
    now() + interval '48 hours',
    p_idempotency_key
  )
  RETURNING id INTO v_order_id;

  UPDATE public.seats s
  SET status = 'on_hold'::public.seat_status,
      active_order_id = v_order_id
  WHERE s.id = ANY (v_choice) AND s.showbuy_id = p_showbuy_id;

  INSERT INTO public.audit_log (event_type, showbuy_id, order_id, result, detail)
  VALUES (
    'hold_seats',
    p_showbuy_id,
    v_order_id,
    'ok',
    jsonb_build_object('qty', p_qty, 'held', to_jsonb(v_choice))
  );

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.hold_seats(
  uuid, text, text, text, text, uuid, integer, uuid[], uuid[], jsonb, jsonb, text, public.discount_card, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.hold_seats(
  uuid, text, text, text, text, uuid, integer, uuid[], uuid[], jsonb, jsonb, text, public.discount_card, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.receipts_enforce_showbuy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.orders_enforce_total_matches_tickets() FROM PUBLIC, anon, authenticated;
