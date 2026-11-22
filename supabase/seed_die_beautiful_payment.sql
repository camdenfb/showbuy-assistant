-- Fictional payment account for Die Beautiful (local/demo only). Impossible account number.
insert into public.payment_accounts (
  id, showbuy_id, platform, account_name, account_number, qr_code_path
) values (
  'c1111111-c111-c111-c111-c11111111111',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'gcash',
  'Demo Die Beautiful GCash',
  '0917-000-0000',
  null
)
on conflict (id) do nothing;
