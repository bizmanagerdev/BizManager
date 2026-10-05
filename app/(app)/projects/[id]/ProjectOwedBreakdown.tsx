"use client";

import type { ReactNode } from "react";
import type { ProjectOwed } from "@/lib/projects/owed";
import { formatDate, formatIls, LtrInline } from "./ProjectTabsClient.helpers";

// "הוצאות שלא שולמו" on the project's money card: ONE number — what we still owe on
// this project — and under it what makes it up: each expense not fully paid
// (with how much of it was already paid), and the wages still owed. It is the
// mirror of the customer's balance, which the תשלום card states. Renders
// nothing when we owe nothing.
//
// Each line is "what — how much" with its details on a second, quieter line,
// so the narrow side column never breaks a sentence in the middle of a figure.
function OwedLine({ label, amount, details }: { label: string; amount: number; details: ReactNode }) {
  return (
    <li>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-medium">{label}</span>
        <span className="shrink-0 font-semibold">
          <LtrInline>{formatIls(amount)}</LtrInline>
        </span>
      </div>
      {details ? <div className="opacity-80">{details}</div> : null}
    </li>
  );
}

export default function ProjectOwedBreakdown({ owed }: { owed: ProjectOwed }) {
  if (!(owed.total > 0.009)) return null;
  return (
    <div className="mt-3 rounded-2xl border border-warning/40 bg-warning-soft/60 px-3 py-2.5 text-xs text-warning-soft-foreground">
      <div className="flex items-center justify-between gap-2 text-sm font-semibold">
        <span>הוצאות שלא שולמו</span>
        <LtrInline>{formatIls(owed.total)}</LtrInline>
      </div>
      <ul className="mt-2 space-y-1.5">
        {owed.expenses.map((expense) => (
          <OwedLine
            key={expense.expenseId}
            label={expense.label}
            amount={expense.open}
            details={
              <>
                {expense.date ? `${formatDate(expense.date)} · ` : ""}
                {expense.status === "partial" ? (
                  <>
                    {"שולם "}
                    <LtrInline>{formatIls(expense.paid)}</LtrInline>
                    {" מתוך "}
                    <LtrInline>{formatIls(expense.total)}</LtrInline>
                  </>
                ) : (
                  "לא שולם"
                )}
              </>
            }
          />
        ))}
        {owed.workersOwed > 0.009 ? (
          <OwedLine
            label="שכר עובדים"
            amount={owed.workersOwed}
            details={
              owed.workersPaid > 0.009 ? (
                <>
                  {"שולם "}
                  <LtrInline>{formatIls(owed.workersPaid)}</LtrInline>
                </>
              ) : null
            }
          />
        ) : null}
      </ul>
    </div>
  );
}
