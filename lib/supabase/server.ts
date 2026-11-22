import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requirePublicSupabaseEnv, requireSecretKey } from "./env";

export async function createSupabaseServerClient() {
  const { url, publishableKey } = requirePublicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component without mutable cookies — proxy refreshes session.
        }
      },
    },
  });
}

/** Service-role client for privileged DB calls. Server-only. */
export function createSupabaseServiceClient() {
  const { url } = requirePublicSupabaseEnv();
  return createClient(url, requireSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
