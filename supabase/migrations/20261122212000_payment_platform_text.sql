-- Allow free-text payment platform labels (not only gcash/bpi/maya).

ALTER TABLE public.payment_accounts
  ALTER COLUMN platform TYPE text USING platform::text;

DROP TYPE IF EXISTS public.payment_platform;
