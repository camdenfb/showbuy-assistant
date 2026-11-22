"use client";

import dynamic from "next/dynamic";
import { defaultShowbuyFormValues } from "../showbuy-form";

const ShowbuyForm = dynamic(
  () => import("../showbuy-form").then((mod) => mod.ShowbuyForm),
  {
    ssr: false,
    loading: () => (
      <div className="mt-6 max-w-lg text-sm text-zinc-600">Loading form…</div>
    ),
  },
);

export function NewShowbuyForm() {
  return <ShowbuyForm mode="create" initial={defaultShowbuyFormValues()} />;
}
