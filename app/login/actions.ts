"use server";

import { redirect } from "next/navigation";
import { isShowbuyerEmail } from "@/lib/auth/allowlist";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!isShowbuyerEmail(email)) {
    redirect("/login?error=not_allowlisted");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user?.email_confirmed_at) {
    redirect("/login?error=auth");
  }
  redirect("/dashboard");
}
