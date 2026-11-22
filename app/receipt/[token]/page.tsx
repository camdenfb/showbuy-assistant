import { notFound } from "next/navigation";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ReceiptForm } from "./receipt-form";

type Props = { params: Promise<{ token: string }> };

export default async function ReceiptPage({ params }: Props) {
  const { token } = await params;
  if (!token || token.length < 16) notFound();

  const supabase = createSupabaseServiceClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, showbuy_id")
    .eq("receipt_token", token)
    .maybeSingle();
  if (!order) notFound();

  const { data: showbuy } = await supabase
    .from("showbuys")
    .select("name")
    .eq("id", order.showbuy_id)
    .maybeSingle();

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-white px-4 py-10 text-zinc-900">
      <h1 className="text-2xl font-semibold">Upload receipt</h1>
      <p className="mt-1 text-sm text-zinc-600">{showbuy?.name ?? "Showbuy"}</p>
      <div className="mt-8">
        <ReceiptForm
          token={token}
          orderNumber={order.id.slice(0, 8)}
          status={order.status}
        />
      </div>
    </main>
  );
}
