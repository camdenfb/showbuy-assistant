-- Allow holds when seats share the preferred section's name (e.g. all "Heart").

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
  v_pref_name text;
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
  v_seat_name text;
  v_seat_for_sale boolean;
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

  SELECT sec.is_for_sale, lower(trim(sec.name))
  INTO v_for_sale, v_pref_name
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
        SELECT lower(trim(sec.name)), sec.is_for_sale
        INTO v_seat_name, v_seat_for_sale
        FROM public.sections sec
        WHERE sec.id = v_seat.section_id AND sec.showbuy_id = p_showbuy_id;
        IF NOT FOUND OR NOT v_seat_for_sale OR v_seat_name IS DISTINCT FROM v_pref_name THEN
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
