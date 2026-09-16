"use client";

import dynamic from "next/dynamic";

// The shared income dialog, loaded on demand — same reasoning as the expense
// one: it only opens on an action, and it is not small.
export const IncomeDialog = dynamic(
  () => import("@/components/financial/IncomeDialog").then((mod) => mod.IncomeDialog),
  { loading: () => null }
);
