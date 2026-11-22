-- Requires migrations + seed (e.g. supabase db reset locally).
begin;

select plan(15);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'hold_seats'
  ),
  1,
  'exactly one hold_seats function exists'
);

-- ---------------------------------------------------------------------------
-- anon denied
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok(
  $q$ select count(*) from public.showbuys $q$,
  '42501',
  'anon cannot select showbuys'
);

select throws_ok(
  $q$ select public.hold_seats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'anon-key',
    'A', 'a@example.test', '09000000000',
    'a2222222-a222-a222-a222-a22222222222',
    1,
    array['a4000001-a400-a400-a400-a40000000001']::uuid[],
    array['a4000004-a400-a400-a400-a40000000004']::uuid[],
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    null,
    'none',
    'a1111111-a111-a111-a111-a11111111111',
    null,
    null
  ) $q$,
  '42501',
  'anon cannot execute hold_seats'
);

-- ---------------------------------------------------------------------------
-- authenticated denied
-- ---------------------------------------------------------------------------
set local role authenticated;

select throws_ok(
  $q$ select count(*) from public.orders $q$,
  '42501',
  'authenticated cannot select orders'
);

select throws_ok(
  $q$ select public.hold_seats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'auth-key',
    'A', 'a@example.test', '09000000000',
    'a2222222-a222-a222-a222-a22222222222',
    1,
    array['a4000001-a400-a400-a400-a40000000001']::uuid[],
    array['a4000004-a400-a400-a400-a40000000004']::uuid[],
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    null,
    'none',
    'a1111111-a111-a111-a111-a11111111111',
    null,
    null
  ) $q$,
  '42501',
  'authenticated cannot execute hold_seats'
);

-- ---------------------------------------------------------------------------
-- service_role: two holds on one seat → exactly one wins that seat
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;

select lives_ok(
  $q$ select public.hold_seats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'hold-race-1',
    'Buyer One', 'one@example.test', '09000000001',
    'a2222222-a222-a222-a222-a22222222222',
    1,
    array['a4000001-a400-a400-a400-a40000000001']::uuid[],
    array['a4000004-a400-a400-a400-a40000000004']::uuid[],
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    null,
    'none',
    'a1111111-a111-a111-a111-a11111111111',
    null,
    null
  ) $q$,
  'first hold on C1 succeeds'
);

select throws_ok(
  $q$ select public.hold_seats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'hold-race-2',
    'Buyer Two', 'two@example.test', '09000000002',
    'a2222222-a222-a222-a222-a22222222222',
    1,
    array['a4000001-a400-a400-a400-a40000000001']::uuid[],
    array['a4000001-a400-a400-a400-a40000000001']::uuid[],
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    null,
    'none',
    'a1111111-a111-a111-a111-a11111111111',
    null,
    null
  ) $q$,
  'P0001',
  'second hold on same seat fails'
);

select is(
  (select count(*)::integer from public.seats
    where id = 'a4000001-a400-a400-a400-a40000000001'
      and status = 'on_hold'
      and active_order_id is not null),
  1,
  'exactly one active hold on contested seat'
);

-- ---------------------------------------------------------------------------
-- Suggested choice: only those seats; never fall back to first/second
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$ select public.hold_seats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'suggest-fail-1',
    'Suggest Fail', 'sf@example.test', '09000000009',
    'a2222222-a222-a222-a222-a22222222222',
    1,
    array['a4000005-a400-a400-a400-a40000000005']::uuid[],
    array['a4000005-a400-a400-a400-a40000000005']::uuid[],
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    null,
    'none',
    'a1111111-a111-a111-a111-a11111111111',
    array['a4000001-a400-a400-a400-a40000000001']::uuid[],
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb
  ) $q$,
  'P0001',
  'unavailable suggested choice fails without falling back'
);

select is(
  (select status::text from public.seats where id = 'a4000005-a400-a400-a400-a40000000005'),
  'direct_buy',
  'first-choice seat untouched when suggested hold fails'
);

-- ---------------------------------------------------------------------------
-- Last promo use: usage_limit = 1 → only one order gets earlybird
-- ---------------------------------------------------------------------------
select lives_ok(
  $q$ select public.hold_seats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'promo-race-1',
    'Promo One', 'p1@example.test', '09000000003',
    'a2222222-a222-a222-a222-a22222222222',
    1,
    array['a4000004-a400-a400-a400-a40000000004']::uuid[],
    array['a4000005-a400-a400-a400-a40000000005']::uuid[],
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":400000}],"totalCentavos":400000,"appliedDiscount":"promo","cardRebateCentavos":0}'::jsonb,
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":400000}],"totalCentavos":400000,"appliedDiscount":"promo","cardRebateCentavos":0}'::jsonb,
    'earlybird',
    'none',
    'a1111111-a111-a111-a111-a11111111111',
    null,
    null
  ) $q$,
  'first promo order succeeds'
);

select throws_ok(
  $q$ select public.hold_seats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'promo-race-2',
    'Promo Two', 'p2@example.test', '09000000004',
    'a2222222-a222-a222-a222-a22222222222',
    1,
    array['a4000005-a400-a400-a400-a40000000005']::uuid[],
    array['a4000005-a400-a400-a400-a40000000005']::uuid[],
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":400000}],"totalCentavos":400000,"appliedDiscount":"promo","cardRebateCentavos":0}'::jsonb,
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":400000}],"totalCentavos":400000,"appliedDiscount":"promo","cardRebateCentavos":0}'::jsonb,
    'earlybird',
    'none',
    'a1111111-a111-a111-a111-a11111111111',
    null,
    null
  ) $q$,
  'P0001',
  'second promo order hits usage limit'
);

select is(
  (select count(*)::integer from public.orders
    where showbuy_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and promo_id = 'a6666666-a666-a666-a666-a66666666666'
      and status <> 'cancelled'),
  1,
  'exactly one non-cancelled order used the last promo'
);

-- is_for_sale enforced in hold_seats
update public.sections
set is_for_sale = false
where id = 'a2222222-a222-a222-a222-a22222222222';

select throws_ok(
  $q$ select public.hold_seats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'not-for-sale',
    'X', 'x@example.test', '09000000099',
    'a2222222-a222-a222-a222-a22222222222',
    1,
    array['a4000005-a400-a400-a400-a40000000005']::uuid[],
    array['a4000005-a400-a400-a400-a40000000005']::uuid[],
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    '{"tickets":[{"regularPriceCentavos":500000,"pricePerSeatCentavos":500000}],"totalCentavos":500000,"appliedDiscount":"none","cardRebateCentavos":0}'::jsonb,
    null,
    'none',
    'a1111111-a111-a111-a111-a11111111111',
    null,
    null
  ) $q$,
  'P0001',
  'hold_seats refuses a section that is not for sale'
);

set local role anon;
select throws_ok(
  $q$ select public.import_seat_map(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    false,
    '[]'::jsonb,
    '[]'::jsonb
  ) $q$,
  '42501',
  'anon cannot execute import_seat_map'
);

select * from finish();
rollback;
