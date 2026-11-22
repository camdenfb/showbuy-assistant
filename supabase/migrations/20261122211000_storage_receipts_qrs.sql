-- Private Storage buckets for receipts and payment QR codes (service role only).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'receipts',
    'receipts',
    false,
    4194304,
    ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
  ),
  (
    'payment-qrs',
    'payment-qrs',
    false,
    4194304,
    ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
  )
ON CONFLICT (id) DO NOTHING;

-- No policies for anon/authenticated — access only via service role.
