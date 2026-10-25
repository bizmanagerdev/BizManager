"use client";

// The review step for a US card's statement (Chase Sapphire, Capital One
// Venture X — owner, 2026-10-25: "each US card its own account"). The statement
// was read by lib/financial/usCardStatement.ts; here it is checked against its
// own summary, given its card account, and saved. Its lines become expenses on
// that account on the statement page — there is no bank date to choose: a US
// card has no monthly charge to a bank, its payments are transfers.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { PanelTitle, STATUS_CHIP as chip, formatStatementAmount } from "@/components/financial/statement-ui";
import { formatShortDate } from "@/lib/date";
import type { CurrencyCode } from "@/lib/fx/currencies";
import {
  checkUsStatement,
  type UsStatement,
  type UsStatementLine,
} from "@/lib/financial/usCardStatement";

export type CardAccountOption = {
  id: string;
  name: string;
  currency: CurrencyCode;
  accountNumber: string | null;
};

export type ExistingUsStatement = {
  id: string;
  cardAccountId: string;
  periodEnd: string | null;
  fileName: string;
};

export type UsSaveLine = UsStatementLine & { notes: string | null };

const KIND_CHIP: Record<string, { label: string; tone: keyof typeof chip }> = {
  payment: { label: "תשלום לכרטיס", tone: "info" },
  cash_advance: { label: "משיכת מזומן", tone: "info" },
  refund: { label: "זיכוי", tone: "ok" },
  fees: { label: "עמלה", tone: "plain" },
  interest: { label: "ריבית", tone: "warn" },
};

function lineChip(l: UsStatementLine) {
  if (l.kind === "payment") return KIND_CHIP.payment;
  if (l.kind === "cash_advance") return KIND_CHIP.cash_advance;
  if (l.amount < 0) return KIND_CHIP.refund;
  if (l.section === "fees") return KIND_CHIP.fees;
  if (l.section === "interest") return KIND_CHIP.interest;
  return null;
}

/** The card account a statement is most likely for: one whose number or name
 *  holds the card's last 4 digits. */
export function guessCardAccount(accounts: CardAccountOption[], last4: string | null): string {
  if (!last4) return accounts.length === 1 ? accounts[0].id : "";
  const hit = accounts.find((a) => (a.accountNumber ?? "").includes(last4) || a.name.includes(last4));
  return hit?.id ?? "";
}

/** A line's note: its purchase day when it differs, another cardholder's card,
 *  and what the statement prints under it. */
export function usLineNotes(line: UsStatementLine, statementLast4: string | null): string | null {
  const parts: string[] = [];
  if (line.txnDate && line.txnDate !== line.postDate) parts.push(`תאריך עסקה: ${formatShortDate(line.txnDate, line.txnDate)}`);
  if (line.cardLast4 && statementLast4 && line.cardLast4 !== statementLast4) {
    parts.push(`כרטיס ${line.cardLast4}${line.cardholder ? ` (${line.cardholder})` : ""}`);
  }
  if (line.detail) parts.push(line.detail);
  const note = parts.join(" · ").trim();
  return note ? note.slice(0, 500) : null;
}

export default function UsStatementReview({
  statement,
  cardAccounts,
  existing,
  saving,
  saveError,
  onSave,
}: {
  statement: UsStatement;
  cardAccounts: CardAccountOption[];
  existing: ExistingUsStatement[];
  saving: boolean;
  saveError: string | null;
  onSave: (input: { cardAccountId: string; cardLabel: string; lines: UsSaveLine[] }) => void;
}) {
  const sameCurrency = cardAccounts.filter((a) => a.currency === "USD");
  const [accountId, setAccountId] = useState(() => guessCardAccount(sameCurrency, statement.cardLast4));
  const check = useMemo(() => checkUsStatement(statement), [statement]);
  const money = (n: number | null) => (n == null ? "—" : formatStatementAmount(n, "USD"));
  const cardLabel = [statement.cardName, statement.cardLast4].filter(Boolean).join(" ");

  const duplicate = existing.find(
    (s) => s.cardAccountId === accountId && statement.periodEnd && s.periodEnd === statement.periodEnd
  );
  const counts = useMemo(() => {
    let purchases = 0;
    let payments = 0;
    let other = 0;
    for (const l of statement.lines) {
      if (l.kind === "payment") payments += 1;
      else if (l.kind === "charge" && l.amount > 0) purchases += 1;
      else other += 1;
    }
    return { purchases, payments, other };
  }, [statement]);

  const canSave = Boolean(accountId) && !duplicate && statement.lines.length > 0 && !saving;

  return (
    <div className="space-y-3">
      <PanelTitle
        title="בדיקה ושמירה"
        hint="כרטיס אמריקאי: כל שורה נרשמת על חשבון הכרטיס עצמו. תשלום לכרטיס הוא העברה מ־Chase או מ־Capital One — לא הוצאה."
      />

      <div className="flex flex-wrap gap-2 text-sm">
        <span className={chip.plain}>{cardLabel}</span>
        {statement.periodStart && statement.periodEnd ? (
          <span className={chip.plain}>
            {formatShortDate(statement.periodStart, "")} – {formatShortDate(statement.periodEnd, "")}
          </span>
        ) : null}
        <span className={chip.info}>{counts.purchases} קניות</span>
        {counts.payments > 0 ? <span className={chip.info}>{counts.payments} תשלומים לכרטיס</span> : null}
        {counts.other > 0 ? <span className={chip.plain}>{counts.other} אחרות</span> : null}
        {check.available ? (
          check.ok ? (
            <span className={chip.ok}>תואם לפירוט עד הסנט</span>
          ) : (
            <span className={chip.warn}>לא תואם לפירוט</span>
          )
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="חשבון הכרטיס" required size="xs">
          <NativeSelect dense value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="חשבון הכרטיס">
            <option value="">— בחר/י —</option>
            {sameCurrency.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber ? `${a.name} · ${a.accountNumber}` : a.name}
              </option>
            ))}
          </NativeSelect>
          {sameCurrency.length === 0 ? (
            <p className="text-xs text-destructive">
              אין חשבון כרטיס בדולרים. אפשר להוסיף בהגדרות → חשבונות (סוג: כרטיס אשראי, מטבע: דולר).
            </p>
          ) : null}
        </Field>
        {check.available ? (
          <div className="rounded-md border px-3 py-2 text-xs">
            <div className="flex flex-wrap justify-between gap-2">
              <span>יתרה קודמת {money(statement.previousBalance)}</span>
              <span className="font-medium">יתרה חדשה {money(statement.newBalance)}</span>
            </div>
            {statement.dueDate ? (
              <div className="text-muted-foreground">לתשלום עד {formatShortDate(statement.dueDate, "")}</div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            בקובץ CSV אין סיכום. אחרי השמירה, בעמוד הפירוט, יתרת הכרטיס נבדקת מול היתרה בפירוט.
          </p>
        )}
      </div>

      {check.available && !check.ok ? (
        <div className="rounded-md border border-warning-soft-foreground/40 bg-warning-soft/30 px-3 py-2 text-xs">
          <p>
            השורות שנקראו לא מגיעות ליתרה החדשה בפירוט — חסר {money(Math.abs(check.difference))}. כנראה שורה לא נקראה.
          </p>
          <ul className="mt-1 space-y-0.5">
            {check.rows
              .filter((r) => !r.ok)
              .map((r) => (
                <li key={r.label}>
                  {r.label}: בפירוט {money(r.printed)}, נקרא {money(r.read)}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {duplicate ? (
        <p className="rounded-md border border-warning-soft-foreground/40 bg-warning-soft/30 px-3 py-2 text-xs">
          הפירוט של התקופה הזאת לכרטיס הזה כבר הועלה ({duplicate.fileName}).{" "}
          <Link href={`/financial/statements/${duplicate.id}`} className="underline">
            לפירוט הקיים
          </Link>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-right font-medium">תאריך</th>
              <th className="px-2 py-1.5 text-right font-medium">תיאור</th>
              <th className="px-2 py-1.5 text-left font-medium">סכום</th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.map((l, i) => {
              const tag = lineChip(l);
              const note = usLineNotes(l, statement.cardLast4);
              return (
                <tr key={i} className="border-t align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{formatShortDate(l.postDate, l.postDate)}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span dir="ltr">{l.description}</span>
                      {tag ? <span className={chip[tag.tone]}>{tag.label}</span> : null}
                    </div>
                    {note ? (
                      <div className="text-xs text-muted-foreground" dir="auto">
                        {note}
                      </div>
                    ) : null}
                  </td>
                  <td
                    className={`whitespace-nowrap px-2 py-1.5 text-left tabular-nums ${l.amount < 0 ? "text-success-soft-foreground" : ""}`}
                    dir="ltr"
                  >
                    {money(l.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-xs text-muted-foreground">
          {accountId ? "" : "יש לבחור את חשבון הכרטיס."}
        </span>
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() =>
            onSave({
              cardAccountId: accountId,
              cardLabel,
              lines: statement.lines.map((l) => ({ ...l, notes: usLineNotes(l, statement.cardLast4) })),
            })
          }
        >
          {saving ? "שומר..." : "שמירת הפירוט"}
        </Button>
      </div>
    </div>
  );
}
