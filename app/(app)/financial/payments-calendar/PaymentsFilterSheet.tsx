"use client";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Account } from "@/lib/accounts";

// ────────────────────────────────────────────────────────────────────────────
// The calendar's three filters, on one sheet — PHONE only.
//
// On a phone the account dropdown and the two chips wrapped onto their own two
// rows of the header and, with the rest of it, pushed the calendar half a
// screen down. Here they're the same choices behind one "סינון" button that
// says how many are on (the same pattern as the documents archive's sheet).
// Desktop keeps them inline in the header.
// ────────────────────────────────────────────────────────────────────────────

function Choice({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm transition-colors ${
        on ? "border-secondary bg-secondary/10 text-secondary" : "border-border bg-background text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

export default function PaymentsFilterSheet({
  open,
  onOpenChange,
  accounts,
  accountFilter,
  onAccountFilter,
  showRecurringOnly,
  recurringOnly,
  onToggleRecurringOnly,
  showPaid,
  onToggleShowPaid,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  accountFilter: string;
  onAccountFilter: (accountId: string) => void;
  /** The "רק קבועות" choice — absent in נכנס, where there are no recurring rows. */
  showRecurringOnly: boolean;
  recurringOnly: boolean;
  onToggleRecurringOnly: () => void;
  showPaid: boolean;
  onToggleShowPaid: () => void;
  onClear: () => void;
}) {
  const hasActive = Boolean(accountFilter) || (showRecurringOnly && recurringOnly) || showPaid;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 rounded-t-2xl p-0">
        <SheetHeader className="shrink-0 border-b px-4 py-3 text-start">
          <SheetTitle>סינון</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {accounts.length > 0 ? (
            <section className="space-y-1.5">
              <h3 className="text-xs text-[rgb(var(--primary-6))]">חשבון</h3>
              <div className="flex flex-wrap gap-1.5">
                <Choice on={!accountFilter} label="כל החשבונות" onClick={() => onAccountFilter("")} />
                {accounts.map((account) => (
                  <Choice
                    key={account.id}
                    on={accountFilter === account.id}
                    label={account.name}
                    onClick={() => onAccountFilter(account.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}
          <section className="space-y-1.5">
            <h3 className="text-xs text-[rgb(var(--primary-6))]">תצוגה</h3>
            <div className="flex flex-wrap gap-1.5">
              {showRecurringOnly ? (
                <Choice on={recurringOnly} label="רק קבועות" onClick={onToggleRecurringOnly} />
              ) : null}
              <Choice on={showPaid} label="הצג ששולמו" onClick={onToggleShowPaid} />
            </div>
          </section>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
          <Button type="button" className="flex-1" onClick={() => onOpenChange(false)}>
            סגירה
          </Button>
          {hasActive ? (
            <Button type="button" variant="link" className="h-auto p-0" onClick={onClear}>
              נקה הכל
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
