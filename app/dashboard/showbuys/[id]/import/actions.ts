"use server";

import { redirect } from "next/navigation";
import { createTicket2MeClient } from "@/lib/adapters/ticket2me";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import {
  mapT2mFeed,
  ticketTypesFromCells,
  type UnavailableClass,
} from "@/lib/rules/import-map";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ImportState =
  | { ok: true }
  | { ok: false; reason: string; reviewAgain?: boolean };

export async function saveSeatMapImport(
  showbuyId: string,
  _prev: ImportState | null,
  formData: FormData,
): Promise<ImportState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const confirmReplace = formData.get("confirmReplace") === "on";
  const ticketTypes = formData.getAll("ticketType").map((v) => Number(v));
  const sectionIds = formData.getAll("sectionId").map(String);
  const sectionNames = formData.getAll("sectionName").map(String);
  const sectionPrices = formData.getAll("sectionPricePesos").map(String);

  try {
    const client = createTicket2MeClient();
    const supabase = createSupabaseServiceClient();
    const { data: showbuy } = await supabase
      .from("showbuys")
      .select("id, t2m_show_id")
      .eq("id", showbuyId)
      .maybeSingle();
    if (!showbuy) return { ok: false, reason: "showbuy_not_found" };

    const feed = await client.fetchSeatPlan(showbuy.t2m_show_id);
    const types = ticketTypesFromCells(feed);
    if (
      types.length !== ticketTypes.length ||
      types.some((type, index) => type !== ticketTypes[index])
    ) {
      return { ok: false, reason: "ticket_types_changed", reviewAgain: true };
    }

    const sectionByTicketType: Record<number, string> = {};
    const regularPriceBySection: Record<string, number> = {};
    const sectionsPayload: {
      id: string;
      name: string;
      regularPriceCentavos: number;
      t2mTicketTypeIds: number[];
      isForSale: boolean;
    }[] = [];

    for (let i = 0; i < types.length; i++) {
      const sectionId = sectionIds[i] || crypto.randomUUID();
      const pesos = Number(sectionPrices[i] ?? "");
      if (!Number.isFinite(pesos) || pesos < 0) {
        return { ok: false, reason: "invalid_price" };
      }
      const price = Math.round(pesos * 100);
      const isForSale = formData.get(`sectionForSale-${types[i]}`) === "on";
      sectionByTicketType[types[i]!] = sectionId;
      regularPriceBySection[sectionId] = price;
      sectionsPayload.push({
        id: sectionId,
        name: sectionNames[i] || `Section ${types[i]}`,
        regularPriceCentavos: price,
        t2mTicketTypeIds: [types[i]!],
        isForSale,
      });
    }

    const classifications: Record<number, UnavailableClass> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("class-")) continue;
      const seatId = Number(key.slice("class-".length));
      const cls = String(value);
      if (cls === "house" || cls === "direct_buy" || cls === "sold_direct") {
        classifications[seatId] = cls;
      }
    }

    const mapped = mapT2mFeed({
      feed,
      showbuyId,
      sectionByTicketType,
      classifications,
      regularPriceBySection,
    });
    if (!mapped.ok) {
      return {
        ok: false,
        reason: mapped.reason,
        reviewAgain: mapped.reason === "stale_classification",
      };
    }

    const seatsPayload = mapped.seats.map((seat) => ({
      id: crypto.randomUUID(),
      sectionId: seat.sectionId,
      t2mSeatId: seat.t2mSeatId,
      row: seat.row,
      number: seat.number,
      gridRow: seat.gridRow,
      position: seat.position,
      status: seat.status,
      t2mStatus: seat.t2mStatus,
      t2mSalePriceCentavos: seat.t2mSalePriceCentavos,
      importedSalePriceCentavos: seat.importedSalePriceCentavos,
      conflict: seat.conflict,
    }));

    const { error } = await supabase.rpc("import_seat_map", {
      p_showbuy_id: showbuyId,
      p_confirm_replace: confirmReplace,
      p_sections: sectionsPayload,
      p_seats: seatsPayload,
    });

    if (error) return { ok: false, reason: error.message };

    redirect(`/dashboard/showbuys/${showbuyId}/import?saved=1`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    return { ok: false, reason: "import_failed" };
  }
}
