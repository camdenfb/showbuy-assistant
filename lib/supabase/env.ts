/** Server-only env helpers. Do not import from client components. */

export function requirePublicSupabaseEnv(): {
  url: string;
  publishableKey: string;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("missing_supabase_public_env");
  }
  return { url, publishableKey };
}

export function requireSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("missing_supabase_secret_key");
  return key;
}
