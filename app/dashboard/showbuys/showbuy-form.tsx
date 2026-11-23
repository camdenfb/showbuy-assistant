"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  createShowbuy,
  updateShowbuy,
  type ShowbuyFormState,
} from "./actions";
import { extractT2mShowIdFromEventUrl } from "@/lib/rules/showbuy";

function numberDefault(value: number | ""): number | undefined {
  return value === "" ? undefined : value;
}

export type ShowbuyFormValues = {
  name: string;
  eventUrl: string;
  t2mShowId: string;
  startsAtManila: string;
  hasBackendAccess: boolean;
  coverage: "full" | "partial";
  feePercent: number | "";
  capitalPesos: number | "";
  otherExpenses: { label: string; amountPesos: number | "" }[];
  claimCodeTemplate: string;
  deductCardRebates: boolean;
  syncIntervalMinutes: number | "";
};

type Props =
  | {
      mode: "create";
      initial: ShowbuyFormValues;
    }
  | {
      mode: "edit";
      showbuyId: string;
      initial: ShowbuyFormValues;
      t2mLocked: boolean;
    };

const DEFAULT_TEMPLATE =
  "{section}{order}-{first_seat}-{qty}{discount}{random}";

export function defaultShowbuyFormValues(
  overrides: Partial<ShowbuyFormValues> = {},
): ShowbuyFormValues {
  return {
    name: "",
    eventUrl: "",
    t2mShowId: "",
    startsAtManila: "",
    hasBackendAccess: false,
    coverage: "full",
    feePercent: "",
    capitalPesos: "",
    otherExpenses: [{ label: "", amountPesos: "" }],
    claimCodeTemplate: DEFAULT_TEMPLATE,
    deductCardRebates: false,
    syncIntervalMinutes: 60,
    ...overrides,
  };
}

export function ShowbuyForm(props: Props) {
  const action =
    props.mode === "create"
      ? createShowbuy
      : updateShowbuy.bind(null, props.showbuyId);
  const [state, formAction, pending] = useActionState<ShowbuyFormState | null, FormData>(
    action,
    null,
  );
  const locked = props.mode === "edit" ? props.t2mLocked : false;
  const [eventUrl, setEventUrl] = useState(props.initial.eventUrl);
  const [showId, setShowId] = useState(props.initial.t2mShowId);
  const [showIdTouched, setShowIdTouched] = useState(props.mode === "edit");
  const [expenses, setExpenses] = useState(props.initial.otherExpenses);

  const prefillHint = useMemo(() => {
    const extracted = extractT2mShowIdFromEventUrl(eventUrl);
    return extracted;
  }, [eventUrl]);

  return (
    <form action={formAction} className="mt-6 max-w-lg space-y-3">
      {state?.ok ? (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {state.message}
        </p>
      ) : null}
      {state && !state.ok ? (
        <p className="text-sm text-red-700">{state.reason}</p>
      ) : null}

      <label className="block text-sm">
        Name
        <input
          name="name"
          required
          defaultValue={props.initial.name}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
        />
      </label>

      <label className="block text-sm">
        Ticket2Me event URL
        <input
          name="eventUrl"
          type="url"
          required
          value={eventUrl}
          disabled={locked}
          onChange={(event) => {
            const next = event.target.value;
            setEventUrl(next);
            if (!locked && !showIdTouched) {
              const extracted = extractT2mShowIdFromEventUrl(next);
              if (extracted) setShowId(extracted);
            }
          }}
          placeholder="https://ticket2me.net/event/23167/show/29225"
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 disabled:bg-zinc-100"
        />
      </label>
      {locked ? (
        <input type="hidden" name="eventUrl" value={eventUrl} />
      ) : null}
      {locked && props.mode === "edit" ? (
        <p className="text-sm text-zinc-600">
          Event URL and show ID are locked after import.{" "}
          <Link className="underline" href={`/dashboard/showbuys/${props.showbuyId}/import`}>
            Re-import seat map
          </Link>{" "}
          instead.
        </p>
      ) : prefillHint && showId === prefillHint ? (
        <p className="text-xs text-zinc-500">Show ID filled from URL (`/show/…`).</p>
      ) : null}

      <label className="block text-sm">
        Ticket2Me show ID
        <input
          name="t2mShowId"
          required
          value={showId}
          disabled={locked}
          onChange={(event) => {
            setShowIdTouched(true);
            setShowId(event.target.value);
          }}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 disabled:bg-zinc-100"
        />
      </label>
      {locked ? <input type="hidden" name="t2mShowId" value={showId} /> : null}

      <label className="block text-sm">
        Date and time (Manila)
        <input
          name="startsAtManila"
          type="datetime-local"
          required
          defaultValue={props.initial.startsAtManila}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="hasBackendAccess"
          defaultChecked={props.initial.hasBackendAccess}
          className="size-4"
        />
        Backend access
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Coverage</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="coverage"
            value="full"
            defaultChecked={props.initial.coverage === "full"}
          />
          Full — every section is for sale
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="coverage"
            value="partial"
            defaultChecked={props.initial.coverage === "partial"}
          />
          Partial — choose for-sale sections on import
        </label>
      </fieldset>

      <label className="block text-sm">
        Ticket2Me fee %
        <input
          name="feePercent"
          type="number"
          min={0}
          max={100}
          step={0.01}
          required
          defaultValue={numberDefault(props.initial.feePercent)}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
        />
      </label>

      <label className="block text-sm">
        Capital investment (₱)
        <input
          name="capitalPesos"
          type="number"
          min={0}
          step={1}
          required
          defaultValue={numberDefault(props.initial.capitalPesos)}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Other expenses</legend>
        {expenses.map((row, index) => (
          <div key={index} className="flex gap-2">
            <input
              name="expenseLabel"
              placeholder="Label"
              defaultValue={row.label || undefined}
              className="w-1/2 rounded border border-zinc-300 bg-white px-2 py-2 text-sm"
            />
            <input
              name="expensePesos"
              type="number"
              min={0}
              step={1}
              placeholder="₱"
              defaultValue={numberDefault(row.amountPesos)}
              className="w-1/2 rounded border border-zinc-300 bg-white px-2 py-2 text-sm"
            />
          </div>
        ))}
        <div className="flex gap-3 text-sm">
          <button
            type="button"
            className="underline"
            onClick={() =>
              setExpenses((prev) => [...prev, { label: "", amountPesos: "" }])
            }
          >
            Add expense
          </button>
          {expenses.length > 1 ? (
            <button
              type="button"
              className="underline"
              onClick={() => setExpenses((prev) => prev.slice(0, -1))}
            >
              Remove last
            </button>
          ) : null}
        </div>
      </fieldset>

      <label className="block text-sm">
        Claim code template
        <input
          name="claimCodeTemplate"
          required
          defaultValue={props.initial.claimCodeTemplate}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 font-mono text-sm"
        />
        <span className="mt-1 block text-xs text-zinc-500">
          Placeholders: {"{section}"} {"{order}"} {"{first_seat}"} {"{seat}"} {"{qty}"}{" "}
          {"{discount}"} {"{random}"}. {"{order}"} is 01, 02, … per showbuy.{" "}
          {"{discount}"} is PW (PWD), SR (senior), or NO. Must include {"{order}"} and{" "}
          {"{random}"} (3 digits).
        </span>
      </label>

      <label className="block text-sm">
        Reconcile interval (minutes)
        <input
          name="syncIntervalMinutes"
          type="number"
          min={1}
          max={1440}
          step={1}
          required
          defaultValue={numberDefault(props.initial.syncIntervalMinutes)}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
        />
        <span className="mt-1 block text-xs text-zinc-500">
          Cron runs hourly; each showbuy only syncs when this many minutes have passed since
          the last check. Order page loads always sync.
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="deductCardRebates"
          defaultChecked={props.initial.deductCardRebates}
          className="size-4"
        />
        Deduct PWD/senior rebates from profit
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending
          ? "Saving…"
          : props.mode === "create"
            ? "Create showbuy"
            : "Save settings"}
      </button>
    </form>
  );
}
