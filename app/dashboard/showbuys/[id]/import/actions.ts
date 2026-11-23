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
  | { ok: true; message?: string }
  | { ok: false; reason: string; reviewAgain?: boolean };

export type SectionSaveState =
  | { ok: true; message: string }
  | { ok: false; reason: string };

const IMPORT_CLASSES = new Set<UnavailableClass>([
  "house",
  "direct_buy",
  "on_hold",
  "sold_direct",
  "sold_t2m",
]);

export async function saveSectionSettings(
  showbuyId: string,
  _prev: SectionSaveState | null,
  formData: FormData,
): Promise<SectionSaveState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const ticketType = Number(formData.get("ticketType"));
  const sectionIdRaw = String(formData.get("sectionId") ?? "").trim();
  const name = String(formData.get("sectionName") ?? "").trim();
  const pesos = Number(formData.get("sectionPricePesos"));
  const isForSale = formData.get("sectionForSale") === "on";

  if (!Number.isFinite(ticketType)) return { ok: false, reason: "invalid_ticket_type" };
  if (!name) return { ok: false, reason: "name_required" };
  if (!Number.isFinite(pesos) || pesos < 0) return { ok: false, reason: "invalid_price" };

  const priceCentavos = Math.round(pesos * 100);
  const supabase = createSupabaseServiceClient();

  const { data: showbuy } = await supabase
    .from("showbuys")
    .select("id")
    .eq("id", showbuyId)
    .maybeSingle();
  if (!showbuy) return { ok: false, reason: "showbuy_not_found" };

  if (sectionIdRaw) {
    const { data: updated, error } = await supabase
      .from("sections")
      .update({
        name,
        regular_price_centavos: priceCentavos,
        is_for_sale: isForSale,
        t2m_ticket_type_ids: [ticketType],
      })
      .eq("id", sectionIdRaw)
      .eq("showbuy_id", showbuyId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, reason: error.message };
    if (!updated) return { ok: false, reason: "section_not_found" };
    return { ok: true, message: "Section saved" };
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("sections").insert({
    id,
    showbuy_id: showbuyId,
    name,
    regular_price_centavos: priceCentavos,
    t2m_ticket_type_ids: [ticketType],
    is_for_sale: isForSale,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, message: "Section saved" };
}

/** Seat map import uses saved section rows from the DB (not Ticket2Me prices). */
export async function saveSeatMapImport(
  showbuyId: string,
  _prev: ImportState | null,
  formData: FormData,
): Promise<ImportState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const confirmReplace = formData.get("confirmReplace") === "on";

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

    const { data: dbSections, error: sectionsError } = await supabase
      .from("sections")
      .select("id, name, regular_price_centavos, t2m_ticket_type_ids, is_for_sale")
      .eq("showbuy_id", showbuyId);
    if (sectionsError) return { ok: false, reason: sectionsError.message };

    const sectionByTicketType: Record<number, string> = {};
    const regularPriceBySection: Record<string, number> = {};
    const sectionsPayload: {
      id: string;
      name: string;
      regularPriceCentavos: number;
      t2mTicketTypeIds: number[];
      isForSale: boolean;
    }[] = [];

    for (const type of types) {
      const existing = (dbSections ?? []).find((section) =>
        section.t2m_ticket_type_ids?.includes(type),
      );
      if (!existing) {
        return {
          ok: false,
          reason: `Save section settings for ticket type ${type} before importing seats`,
        };
      }
      sectionByTicketType[type] = existing.id;
      regularPriceBySection[existing.id] = existing.regular_price_centavos;
      sectionsPayload.push({
        id: existing.id,
        name: existing.name,
        regularPriceCentavos: existing.regular_price_centavos,
        t2mTicketTypeIds: [type],
        isForSale: existing.is_for_sale !== false,
      });
    }

    const classifications: Record<number, UnavailableClass> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("class-")) continue;
      const seatId = Number(key.slice("class-".length));
      const cls = String(value) as UnavailableClass;
      if (IMPORT_CLASSES.has(cls)) {
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

    if (error) {
      const message = error.message;
      if (message.includes("confirm replace required")) {
        return { ok: false, reason: "confirm replace required" };
      }
      if (message.includes("section priced by promo")) {
        return { ok: false, reason: "section priced by promo" };
      }
      if (message.includes("section has seats")) {
        return { ok: false, reason: "section has seats" };
      }
      return { ok: false, reason: message };
    }

    redirect(`/dashboard/showbuys/${showbuyId}/import?saved=1`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    return { ok: false, reason: "import_failed" };
  }
}
