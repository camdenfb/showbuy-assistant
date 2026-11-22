"use client";

import { useActionState, useState } from "react";
import { deletePromo, savePromo, setPromoActive, type PromoState } from "./actions";

type Section = {
  id: string;
  name: string;
  regular_price_centavos: number;
};

type Promo = {
  id: string;
  code: string;
  active: boolean;
  usage_limit: number | null;
  requires_single_seat: boolean;
  price_centavos_by_section: Record<string, number>;
};

type Props = {
  showbuyId: string;
  sections: Section[];
  promos: Promo[];
};

type SectionBand = {
  key: string;
  label: string;
  sectionIds: string[];
  regularPesos: number;
};

/** Collapse same-named for-sale sections (e.g. Heart L/R → Heart). */
function buildSectionBands(sections: Section[]): SectionBand[] {
  const byName = new Map<string, Section[]>();
  for (const section of sections) {
    const key = section.name.trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(section);
    byName.set(key, list);
  }
  return [...byName.entries()]
    .sort((a, b) => a[1][0]!.name.localeCompare(b[1][0]!.name))
    .map(([key, group]) => {
      const primary = [...group].sort((a, b) => a.id.localeCompare(b.id))[0]!;
      return {
        key,
        label: primary.name.trim(),
        sectionIds: group.map((section) => section.id),
        regularPesos: primary.regular_price_centavos / 100,
      };
    });
}

function bandDefaultPesos(band: SectionBand, promo: Promo | null): number {
  if (!promo) return band.regularPesos;
  for (const sectionId of band.sectionIds) {
    const centavos = promo.price_centavos_by_section[sectionId];
    if (centavos != null) return centavos / 100;
  }
  return band.regularPesos;
}

export function PromoForm({ showbuyId, sections, promos }: Props) {
  const bound = savePromo.bind(null, showbuyId);
  const [state, formAction, pending] = useActionState<PromoState | null, FormData>(
    bound,
    null,
  );
  const [editing, setEditing] = useState<Promo | null>(null);
  const bands = buildSectionBands(sections);

  return (
    <div className="space-y-8">
      {state?.ok ? (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{state.message}</p>
      ) : null}
      {state && !state.ok ? (
        <p className="text-sm text-red-700">{state.reason}</p>
      ) : null}

      <ul className="space-y-3">
        {promos.map((promo) => (
          <li
            key={promo.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 py-3 text-sm"
          >
            <span>
              <span className="font-mono font-semibold">{promo.code}</span>
              {" · "}
              {promo.active ? "active" : "inactive"}
              {promo.usage_limit != null ? ` · limit ${promo.usage_limit}` : " · unlimited"}
              {promo.requires_single_seat ? " · SINGLE" : ""}
            </span>
            <span className="flex flex-wrap gap-3">
              <button
                type="button"
                className="underline"
                onClick={() => setEditing(promo)}
              >
                Edit
              </button>
              <button
                type="button"
                className="underline"
                onClick={() => void setPromoActive(showbuyId, promo.id, !promo.active)}
              >
                {promo.active ? "Deactivate" : "Activate"}
              </button>
              <button
                type="button"
                className="underline"
                onClick={() => void deletePromo(showbuyId, promo.id)}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
        {promos.length === 0 ? (
          <li className="text-sm text-zinc-600">No promos yet.</li>
        ) : null}
      </ul>

      <form action={formAction} className="max-w-lg space-y-3">
        <h2 className="text-lg font-medium text-zinc-900">
          {editing ? `Edit ${editing.code}` : "Add promo"}
        </h2>
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
        <label className="block text-sm">
          Code
          <input
            name="code"
            required
            defaultValue={editing?.code ?? ""}
            key={`code-${editing?.id ?? "new"}`}
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 font-mono"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={editing?.active ?? true}
            key={`active-${editing?.id ?? "new"}`}
            className="size-4"
          />
          Active
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="requiresSingle"
            defaultChecked={editing?.requires_single_seat ?? false}
            key={`single-${editing?.id ?? "new"}`}
            className="size-4"
          />
          SINGLE (one isolated seat)
        </label>
        <label className="block text-sm">
          Usage limit (blank = unlimited)
          <input
            name="usageLimit"
            type="number"
            min={0}
            defaultValue={editing?.usage_limit ?? ""}
            key={`limit-${editing?.id ?? "new"}`}
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Promo price (₱)</legend>
          {bands.map((band) => (
            <label key={band.key} className="block text-sm">
              {band.label}
              <input
                name={`price_group_${band.key}`}
                type="number"
                min={0}
                step={1}
                required
                defaultValue={bandDefaultPesos(band, editing)}
                key={`price-${band.key}-${editing?.id ?? "new"}`}
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
              />
            </label>
          ))}
          {bands.length === 0 ? (
            <p className="text-sm text-zinc-600">Mark sections for sale first.</p>
          ) : null}
        </fieldset>
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={pending || bands.length === 0}
            className="btn-primary rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save promo"}
          </button>
          {editing ? (
            <button
              type="button"
              className="rounded border border-zinc-300 px-4 py-2 text-sm"
              onClick={() => setEditing(null)}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
