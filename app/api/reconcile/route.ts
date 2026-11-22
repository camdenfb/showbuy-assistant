import { NextResponse } from "next/server";
import { reconcileDueShowbuys } from "@/lib/reconcile/run-showbuy";

export const instant = false;

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header =
    request.headers.get("authorization") ??
    request.headers.get("x-cron-secret") ??
    "";
  if (header === secret) return true;
  if (header === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

async function handle(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const summary = await reconcileDueShowbuys();
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
