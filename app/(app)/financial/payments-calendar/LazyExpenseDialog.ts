"use client";

import dynamic from "next/dynamic";

// The shared expense dialog, loaded on demand — it's the heaviest piece of the
// board and only opens on an action.
export const ExpenseDialog = dynamic(
  () => import("@/components/expenses/ExpenseDialog").then((mod) => mod.ExpenseDialog),
  { loading: () => null }
);
