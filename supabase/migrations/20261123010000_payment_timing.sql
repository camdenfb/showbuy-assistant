-- Pay now vs pay later on customer orders.

alter table public.orders
  add column if not exists payment_timing text
    check (payment_timing is null or payment_timing in ('now', 'later'));

comment on column public.orders.payment_timing is
  'now = paid on order page (no payment email); later = email payment details. null = legacy later.';
