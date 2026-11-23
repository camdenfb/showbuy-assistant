-- Allow seat-map re-import when orders exist: update free seats in place;
-- never delete held/sold seats or wipe the map.
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
  v_t2m_seat_id integer;
  v_existing public.seats%ROWTYPE;
  v_mode text;
BEGIN
  PERFORM 1 FROM public.showbuys s WHERE s.id = p_showbuy_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'showbuy not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer INTO v_order_count
  FROM public.orders o WHERE o.showbuy_id = p_showbuy_id;

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

  v_mode := CASE WHEN v_order_count > 0 THEN 'classify' ELSE 'replace' END;

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
    IF v_mode = 'classify' AND EXISTS (
      SELECT 1 FROM public.seats s
      WHERE s.showbuy_id = p_showbuy_id AND s.section_id = v_section_id
    ) THEN
      RAISE EXCEPTION 'section has seats' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF v_mode = 'replace' THEN
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
  ELSE
    -- Orders exist: reclassify free seats only; preserve holds and sold-direct.
    FOR v_seat IN SELECT * FROM jsonb_array_elements(p_seats)
    LOOP
      v_t2m_seat_id := (v_seat ->> 't2mSeatId')::integer;
      SELECT * INTO v_existing
      FROM public.seats s
      WHERE s.showbuy_id = p_showbuy_id AND s.t2m_seat_id = v_t2m_seat_id
      FOR UPDATE;

      IF FOUND THEN
        IF v_existing.active_order_id IS NOT NULL
          OR v_existing.status IN (
            'on_hold'::public.seat_status,
            'sold_direct'::public.seat_status
          )
        THEN
          UPDATE public.seats SET
            section_id = (v_seat ->> 'sectionId')::uuid,
            row_label = v_seat ->> 'row',
            seat_number = (v_seat ->> 'number')::integer,
            grid_row = (v_seat ->> 'gridRow')::integer,
            position = (v_seat ->> 'position')::integer,
            t2m_status = (v_seat ->> 't2mStatus')::public.t2m_status,
            t2m_sale_price_centavos = NULLIF(v_seat ->> 't2mSalePriceCentavos', '')::integer
          WHERE id = v_existing.id;
        ELSE
          UPDATE public.seats SET
            section_id = (v_seat ->> 'sectionId')::uuid,
            row_label = v_seat ->> 'row',
            seat_number = (v_seat ->> 'number')::integer,
            grid_row = (v_seat ->> 'gridRow')::integer,
            position = (v_seat ->> 'position')::integer,
            status = (v_seat ->> 'status')::public.seat_status,
            t2m_status = (v_seat ->> 't2mStatus')::public.t2m_status,
            t2m_sale_price_centavos = NULLIF(v_seat ->> 't2mSalePriceCentavos', '')::integer,
            imported_sale_price_centavos = NULLIF(v_seat ->> 'importedSalePriceCentavos', '')::integer,
            conflict = NULLIF(v_seat ->> 'conflict', '')
          WHERE id = v_existing.id;
        END IF;
      ELSE
        INSERT INTO public.seats (
          id, showbuy_id, section_id, t2m_seat_id, row_label, seat_number,
          grid_row, position, status, t2m_status, t2m_sale_price_centavos,
          imported_sale_price_centavos, conflict, active_order_id
        ) VALUES (
          COALESCE(NULLIF(v_seat ->> 'id', '')::uuid, gen_random_uuid()),
          p_showbuy_id,
          (v_seat ->> 'sectionId')::uuid,
          v_t2m_seat_id,
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
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.audit_log (event_type, showbuy_id, result, detail)
  VALUES (
    'import_seat_map',
    p_showbuy_id,
    'ok',
    jsonb_build_object(
      'sections', jsonb_array_length(p_sections),
      'seats', jsonb_array_length(p_seats),
      'mode', v_mode
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_seat_map(uuid, boolean, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_seat_map(uuid, boolean, jsonb, jsonb)
  TO service_role;
