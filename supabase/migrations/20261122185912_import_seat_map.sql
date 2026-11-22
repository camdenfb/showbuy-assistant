-- Phase 1: partial showbuys, imported sold prices, import_seat_map, is_for_sale on holds.

ALTER TABLE public.sections
  ADD COLUMN is_for_sale boolean NOT NULL DEFAULT true;

ALTER TABLE public.seats
  ADD COLUMN imported_sale_price_centavos integer
    CONSTRAINT seats_imported_sale_nonneg CHECK (
      imported_sale_price_centavos IS NULL OR imported_sale_price_centavos >= 0
    );

-- Replace hold_seats to enforce is_for_sale
DROP FUNCTION IF EXISTS public.hold_seats(
  uuid, text, text, text, text, uuid, integer, uuid[], uuid[], jsonb, jsonb, text, public.discount_card, uuid, uuid[], jsonb
);

CREATE FUNCTION public.hold_seats(
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
  p_payment_account_id uuid,
  p_suggested_choice uuid[] DEFAULT NULL,
  p_suggested_quote jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing uuid;
  v_paused boolean;
  v_for_sale boolean;
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
  v_max integer;
  v_use_suggested boolean;
  v_suggested uuid[];
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key required' USING ERRCODE = '22023';
  END IF;

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

  v_suggested := COALESCE(p_suggested_choice, '{}'::uuid[]);
  v_use_suggested := cardinality(v_suggested) > 0;

  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'qty/choice length mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_use_suggested THEN
    IF cardinality(v_suggested) IS DISTINCT FROM p_qty THEN
      RAISE EXCEPTION 'qty/choice length mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF cardinality(p_first_choice) IS DISTINCT FROM p_qty
     OR cardinality(p_second_choice) IS DISTINCT FROM p_qty THEN
    RAISE EXCEPTION 'qty/choice length mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT sec.is_for_sale INTO v_for_sale
  FROM public.sections sec
  WHERE sec.id = p_preferred_section_id AND sec.showbuy_id = p_showbuy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preferred section not in showbuy' USING ERRCODE = '22023';
  END IF;
  IF NOT v_for_sale THEN
    RAISE EXCEPTION 'section not for sale' USING ERRCODE = 'P0001';
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

  v_ok := false;
  v_max := CASE WHEN v_use_suggested THEN 1 ELSE 2 END;

  FOR v_i IN 1..v_max LOOP
    IF v_use_suggested THEN
      v_choice := v_suggested;
      v_quote := p_suggested_quote;
    ELSIF v_i = 1 THEN
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
      IF v_use_suggested THEN
        RAISE EXCEPTION 'suggested choice unavailable' USING ERRCODE = 'P0001';
      END IF;
      CONTINUE;
    END IF;

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

    IF v_use_suggested AND NOT v_ok THEN
      RAISE EXCEPTION 'suggested choice unavailable' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'neither choice available' USING ERRCODE = 'P0001';
  END IF;

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
    showbuy_id, name, email, mobile, preferred_section_id, qty,
    first_choice_seat_ids, second_choice_seat_ids, suggested_choice_seat_ids,
    promo_code, promo_id, discount_card, payment_account_id, status,
    held_seat_ids, tickets, total_centavos, applied_discount, card_rebate_centavos,
    hold_expires_at, idempotency_key
  ) VALUES (
    p_showbuy_id, p_name, p_email, p_mobile, p_preferred_section_id, p_qty,
    p_first_choice, p_second_choice,
    CASE WHEN v_use_suggested THEN v_suggested ELSE NULL END,
    v_promo_code,
    CASE WHEN v_promo_code IS NOT NULL THEN v_promo.id ELSE NULL END,
    p_discount_card, p_payment_account_id,
    'sent_payment_info'::public.order_status,
    v_choice, v_tickets, v_total, v_applied, v_card_disc,
    now() + interval '48 hours', p_idempotency_key
  )
  RETURNING id INTO v_order_id;

  UPDATE public.seats s
  SET status = 'on_hold'::public.seat_status, active_order_id = v_order_id
  WHERE s.id = ANY (v_choice) AND s.showbuy_id = p_showbuy_id;

  INSERT INTO public.audit_log (event_type, showbuy_id, order_id, result, detail)
  VALUES (
    'hold_seats', p_showbuy_id, v_order_id, 'ok',
    jsonb_build_object('qty', p_qty, 'held', to_jsonb(v_choice), 'suggested', v_use_suggested)
  );

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.hold_seats(
  uuid, text, text, text, text, uuid, integer, uuid[], uuid[], jsonb, jsonb, text, public.discount_card, uuid, uuid[], jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_seats(
  uuid, text, text, text, text, uuid, integer, uuid[], uuid[], jsonb, jsonb, text, public.discount_card, uuid, uuid[], jsonb
) TO service_role;

-- import_seat_map: p_sections and p_seats are server-built JSON after refetch
CREATE OR REPLACE FUNCTION public.import_seat_map(
  p_showbuy_id uuid,
  p_confirm_replace boolean,
  p_sections jsonb,
  p_seats jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_count integer;
  v_seat_count integer;
  v_sec jsonb;
  v_seat jsonb;
  v_section_id uuid;
  v_existing_ids uuid[];
  v_kept_ids uuid[] := '{}';
BEGIN
  PERFORM 1 FROM public.showbuys s WHERE s.id = p_showbuy_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'showbuy not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer INTO v_order_count
  FROM public.orders o WHERE o.showbuy_id = p_showbuy_id;
  IF v_order_count > 0 THEN
    RAISE EXCEPTION 'showbuy has orders' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_seat_count
  FROM public.seats s WHERE s.showbuy_id = p_showbuy_id;
  IF v_seat_count > 0 AND NOT p_confirm_replace THEN
    RAISE EXCEPTION 'confirm replace required' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_sections) <> 'array' OR jsonb_array_length(p_sections) < 1 THEN
    RAISE EXCEPTION 'sections required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_seats) <> 'array' THEN
    RAISE EXCEPTION 'seats required' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(sec.id), '{}') INTO v_existing_ids
  FROM public.sections sec WHERE sec.showbuy_id = p_showbuy_id;

  FOR v_sec IN SELECT * FROM jsonb_array_elements(p_sections)
  LOOP
    IF (v_sec ->> 'id') IS NOT NULL AND (v_sec ->> 'id') <> '' THEN
      v_section_id := (v_sec ->> 'id')::uuid;
      UPDATE public.sections SET
        name = v_sec ->> 'name',
        regular_price_centavos = (v_sec ->> 'regularPriceCentavos')::integer,
        t2m_ticket_type_ids = ARRAY(
          SELECT jsonb_array_elements_text(v_sec -> 't2mTicketTypeIds')::integer
        ),
        is_for_sale = COALESCE((v_sec ->> 'isForSale')::boolean, true)
      WHERE id = v_section_id AND showbuy_id = p_showbuy_id;
      IF FOUND THEN
        v_kept_ids := array_append(v_kept_ids, v_section_id);
        CONTINUE;
      END IF;
      -- New section with a client-chosen id (keeps promo-stable ids on first import too)
      INSERT INTO public.sections (
        id, showbuy_id, name, regular_price_centavos, t2m_ticket_type_ids, is_for_sale
      ) VALUES (
        v_section_id,
        p_showbuy_id,
        v_sec ->> 'name',
        (v_sec ->> 'regularPriceCentavos')::integer,
        ARRAY(SELECT jsonb_array_elements_text(v_sec -> 't2mTicketTypeIds')::integer),
        COALESCE((v_sec ->> 'isForSale')::boolean, true)
      );
    ELSE
      INSERT INTO public.sections (
        showbuy_id, name, regular_price_centavos, t2m_ticket_type_ids, is_for_sale
      ) VALUES (
        p_showbuy_id,
        v_sec ->> 'name',
        (v_sec ->> 'regularPriceCentavos')::integer,
        ARRAY(SELECT jsonb_array_elements_text(v_sec -> 't2mTicketTypeIds')::integer),
        COALESCE((v_sec ->> 'isForSale')::boolean, true)
      )
      RETURNING id INTO v_section_id;
    END IF;
    v_kept_ids := array_append(v_kept_ids, v_section_id);
  END LOOP;

  -- Refuse removing a section a promo prices
  FOR v_section_id IN
    SELECT x FROM unnest(v_existing_ids) AS x
    WHERE NOT (x = ANY (v_kept_ids))
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.promos pr
      WHERE pr.showbuy_id = p_showbuy_id
        AND pr.price_centavos_by_section ? v_section_id::text
    ) THEN
      RAISE EXCEPTION 'section priced by promo' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  DELETE FROM public.seats WHERE showbuy_id = p_showbuy_id;

  DELETE FROM public.sections sec
  WHERE sec.showbuy_id = p_showbuy_id
    AND NOT (sec.id = ANY (v_kept_ids));

  FOR v_seat IN SELECT * FROM jsonb_array_elements(p_seats)
  LOOP
    INSERT INTO public.seats (
      id, showbuy_id, section_id, t2m_seat_id, row_label, seat_number,
      grid_row, position, status, t2m_status, t2m_sale_price_centavos,
      imported_sale_price_centavos, conflict, active_order_id
    ) VALUES (
      COALESCE(NULLIF(v_seat ->> 'id', '')::uuid, gen_random_uuid()),
      p_showbuy_id,
      (v_seat ->> 'sectionId')::uuid,
      (v_seat ->> 't2mSeatId')::integer,
      v_seat ->> 'row',
      (v_seat ->> 'number')::integer,
      (v_seat ->> 'gridRow')::integer,
      (v_seat ->> 'position')::integer,
      (v_seat ->> 'status')::public.seat_status,
      (v_seat ->> 't2mStatus')::public.t2m_status,
      NULLIF(v_seat ->> 't2mSalePriceCentavos', '')::integer,
      NULLIF(v_seat ->> 'importedSalePriceCentavos', '')::integer,
      NULLIF(v_seat ->> 'conflict', ''),
      NULL
    );
  END LOOP;

  INSERT INTO public.audit_log (event_type, showbuy_id, result, detail)
  VALUES (
    'import_seat_map',
    p_showbuy_id,
    'ok',
    jsonb_build_object('sections', jsonb_array_length(p_sections), 'seats', jsonb_array_length(p_seats))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_seat_map(uuid, boolean, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_seat_map(uuid, boolean, jsonb, jsonb)
  TO service_role;

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
-- seats already RLS-enabled; ensure new column covered
REVOKE ALL ON TABLE public.sections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.seats FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sections TO service_role;
GRANT ALL ON TABLE public.seats TO service_role;
