-- Per-showbuy sequential order numbers for claim codes (01, 02, …).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number integer;

-- Backfill existing rows in created_at order within each showbuy.
WITH numbered AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY showbuy_id ORDER BY created_at ASC, id ASC) AS n
  FROM public.orders
)
UPDATE public.orders o
SET order_number = numbered.n
FROM numbered
WHERE o.id = numbered.id
  AND o.order_number IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN order_number SET NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_number_positive;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_number_positive CHECK (order_number >= 1);

CREATE UNIQUE INDEX IF NOT EXISTS orders_showbuy_order_number_uidx
  ON public.orders (showbuy_id, order_number);

CREATE OR REPLACE FUNCTION public.assign_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.order_number IS NULL THEN
    SELECT COALESCE(MAX(o.order_number), 0) + 1
    INTO NEW.order_number
    FROM public.orders o
    WHERE o.showbuy_id = NEW.showbuy_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_assign_order_number ON public.orders;

CREATE TRIGGER orders_assign_order_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_order_number();
