-- Fictional demo data only. Account numbers are intentionally impossible.
-- Fixed IDs so database tests can reference them.

-- Showbuy A: Harbor Lights — 15 Mar 2027 20:00 Asia/Manila
-- Showbuy B: Harbor Lights — 16 Mar 2027 20:00 Asia/Manila

INSERT INTO public.showbuys (
  id, name, starts_at, event_url, t2m_show_id,
  has_backend_access, coverage, t2m_fee_percent,
  capital_investment_centavos, other_expenses,
  claim_code_template, deduct_card_rebates, sync_interval_minutes, orders_paused
) VALUES
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Harbor Lights — Mar 15 (demo)',
  '2027-03-15 12:00:00+00',
  'https://example.test/t2m/harbor-lights-mar15',
  'demo-t2m-show-15',
  false,
  'full',
  8.00,
  13000000,
  '[{"label":"Marketing","amountCentavos":500000}]'::jsonb,
  '{section}{order}-{seat}-{qty}{discount}{random}',
  false,
  60,
  false
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Harbor Lights — Mar 16 (demo)',
  '2027-03-16 12:00:00+00',
  'https://example.test/t2m/harbor-lights-mar16',
  'demo-t2m-show-16',
  false,
  'full',
  8.00,
  13000000,
  '[{"label":"Marketing","amountCentavos":500000}]'::jsonb,
  '{section}{order}-{seat}-{qty}{discount}{random}',
  false,
  60,
  false
);

INSERT INTO public.payment_accounts (id, showbuy_id, platform, account_name, account_number, qr_code_path) VALUES
(
  'a1111111-a111-a111-a111-a11111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'gcash',
  'Demo Showbuyer GCash',
  '0000-000-0000',
  null
),
(
  'b1111111-b111-b111-b111-b11111111111',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'gcash',
  'Demo Showbuyer GCash',
  '0000-000-0001',
  null
);

INSERT INTO public.sections (id, showbuy_id, name, regular_price_centavos, t2m_ticket_type_ids) VALUES
(
  'a2222222-a222-a222-a222-a22222222222',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Orchestra',
  500000,
  '{101}'
),
(
  'a3333333-a333-a333-a333-a33333333333',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Balcony',
  300000,
  '{102}'
),
(
  'b2222222-b222-b222-b222-b22222222222',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Orchestra',
  500000,
  '{201}'
),
(
  'b3333333-b333-b333-b333-b33333333333',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Balcony',
  300000,
  '{202}'
);

-- Tiny maps: row C positions 1,2,4,5 (position 3 = aisle gap, no seat row)
-- Showbuy A Orchestra
INSERT INTO public.seats (
  id, showbuy_id, section_id, t2m_seat_id, row_label, seat_number,
  grid_row, position, status, t2m_status, t2m_sale_price_centavos, conflict, active_order_id
) VALUES
('a4000001-a400-a400-a400-a40000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-a222-a222-a222-a22222222222', 1001, 'C', 1, 1, 1, 'direct_buy', 'unavailable', null, null, null),
('a4000002-a400-a400-a400-a40000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-a222-a222-a222-a22222222222', 1002, 'C', 2, 1, 2, 'direct_buy', 'unavailable', null, null, null),
('a4000004-a400-a400-a400-a40000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-a222-a222-a222-a22222222222', 1004, 'C', 4, 1, 4, 'direct_buy', 'unavailable', null, null, null),
('a4000005-a400-a400-a400-a40000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-a222-a222-a222-a22222222222', 1005, 'C', 5, 1, 5, 'direct_buy', 'unavailable', null, null, null),
-- Showbuy A Balcony (for SECOND choice / promo tests)
('a5000001-a500-a500-a500-a50000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3333333-a333-a333-a333-a33333333333', 1101, 'B', 1, 2, 1, 'direct_buy', 'unavailable', null, null, null),
('a5000002-a500-a500-a500-a50000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3333333-a333-a333-a333-a33333333333', 1102, 'B', 2, 2, 2, 'available_t2m', 'available', null, null, null),
-- Showbuy B Orchestra (same labels, different showbuy — AC1)
('b4000001-b400-b400-b400-b40000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2222222-b222-b222-b222-b22222222222', 1001, 'C', 1, 1, 1, 'direct_buy', 'unavailable', null, null, null),
('b4000002-b400-b400-b400-b40000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2222222-b222-b222-b222-b22222222222', 1002, 'C', 2, 1, 2, 'direct_buy', 'unavailable', null, null, null),
('b4000004-b400-b400-b400-b40000000004', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2222222-b222-b222-b222-b22222222222', 1004, 'C', 4, 1, 4, 'house', 'unavailable', null, null, null),
('b4000005-b400-b400-b400-b40000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2222222-b222-b222-b222-b22222222222', 1005, 'C', 5, 1, 5, 'direct_buy', 'unavailable', null, null, null);

-- Limited promo on showbuy A (usage_limit = 1) for race test
INSERT INTO public.promos (
  id, showbuy_id, code, active, price_centavos_by_section, requires_single_seat, usage_limit
) VALUES (
  'a6666666-a666-a666-a666-a66666666666',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'earlybird',
  true,
  '{"a2222222-a222-a222-a222-a22222222222":400000,"a3333333-a333-a333-a333-a33333333333":250000}'::jsonb,
  false,
  1
);
