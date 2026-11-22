"use client";

import dynamic from "next/dynamic";
import { dateToManilaLocalInput } from "@/lib/rules/showbuy";
import {
  defaultShowbuyFormValues,
  type ShowbuyFormValues,
} from "../../showbuy-form";

const ShowbuyForm = dynamic(
  () => import("../../showbuy-form").then((mod) => mod.ShowbuyForm),
  {
    ssr: false,
    loading: () => (
      <div className="mt-6 max-w-lg text-sm text-zinc-600">Loading form…</div>
    ),
  },
);

export type SettingsFormInput = {
  name: string;
  eventUrl: string;
  t2mShowId: string;
  startsAtIso: string;
  hasBackendAccess: boolean;
  coverage: "full" | "partial";
  feePercent: number;
  capitalPesos: number;
  otherExpenses: { label: string; amountPesos: number }[];
  claimCodeTemplate: string;
  deductCardRebates: boolean;
  syncIntervalMinutes: number;
};

function toInitial(input: SettingsFormInput): ShowbuyFormValues {
  return defaultShowbuyFormValues({
    name: input.name,
    eventUrl: input.eventUrl,
    t2mShowId: input.t2mShowId,
    startsAtManila: dateToManilaLocalInput(new Date(input.startsAtIso)),
    hasBackendAccess: input.hasBackendAccess,
    coverage: input.coverage,
    feePercent: input.feePercent,
    capitalPesos: input.capitalPesos,
    otherExpenses: input.otherExpenses,
    claimCodeTemplate: input.claimCodeTemplate,
    deductCardRebates: input.deductCardRebates,
    syncIntervalMinutes: input.syncIntervalMinutes,
  });
}

export function SettingsForm({
  showbuyId,
  t2mLocked,
  input,
}: {
  showbuyId: string;
  t2mLocked: boolean;
  input: SettingsFormInput;
}) {
  return (
    <ShowbuyForm
      mode="edit"
      showbuyId={showbuyId}
      t2mLocked={t2mLocked}
      initial={toInitial(input)}
    />
  );
}
