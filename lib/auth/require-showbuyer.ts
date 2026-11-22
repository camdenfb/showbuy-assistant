import { isShowbuyerEmail } from "./allowlist";
import { createSupabaseServerClient } from "../supabase/server";

export async function requireShowbuyer(): Promise<
  { ok: true; email: string } | { ok: false; reason: string }
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, reason: "unauthenticated" };
  const email = data.user.email;
  if (!email || !data.user.email_confirmed_at) {
    return { ok: false, reason: "unconfirmed" };
  }
  if (!isShowbuyerEmail(email)) return { ok: false, reason: "not_allowlisted" };
  return { ok: true, email };
}
