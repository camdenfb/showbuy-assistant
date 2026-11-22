/** Case-insensitive showbuyer email allowlist. Empty/missing denies everyone. */
export function isShowbuyerEmail(
  email: string | null | undefined,
  allowlistEnv: string | undefined = process.env.SHOWBUYER_EMAILS,
): boolean {
  if (!email) return false;
  const raw = allowlistEnv?.trim() ?? "";
  if (raw === "") return false;
  const allowed = new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowed.size === 0) return false;
  return allowed.has(email.trim().toLowerCase());
}
