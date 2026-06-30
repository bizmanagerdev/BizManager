"use client";

// Cleanly-separable presentational dialogs lifted out of DashboardActions. Only
// dialogs with a small, self-contained prop surface live here — the Expense /
// Income dialogs stay inline because they are coupled to ~40-70 pieces of form
// state and can't be prop-threaded safely without a larger state refactor.

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { formatCurrency } from "@/lib/payroll";
import type { CalendarEntry } from "@/lib/projectSchedule";
import type { WeekDayBucket } from "@/lib/dashboard/week";
import { HEBREW } from "@/app/(app)/dashboard/DashboardActions.constants";
import {
  WEEK_PALETTE,
  formatWeekRangeLabel,
  shortWeekDay,
} from "@/app/(app)/dashboard/DashboardActions.helpers";

const fieldClass =
  "h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-sm shadow-sm outline-none transition-all focus:border-destructive/40 focus:ring-2 focus:ring-ring";

// "מה יש השבוע" — read-only 7-day calendar built from the shared weekView.
export function WeekOverviewDialog({
  open,
  onOpenChange,
  weekStart,
  weekEnd,
  weeklyEntryCount,
  weeklyGeneralEntries,
  weeklyBuckets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekStart: Date;
  weekEnd: Date;
  weeklyEntryCount: number;
  weeklyGeneralEntries: CalendarEntry[];
  weeklyBuckets: WeekDayBucket[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="form2xl">
        <DialogHeader className="text-right">
          <DialogTitle>{HEBREW.thisWeek}</DialogTitle>
          <DialogDescription>{`${formatWeekRangeLabel(weekStart, weekEnd)} • ${weeklyEntryCount} פריטים השבוע`}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Ongoing projects legend */}
          {weeklyGeneralEntries.length > 0 && (
            <div className="space-y-2 text-right">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">פרויקטים שוטפים השבוע</div>
              <div className="flex flex-wrap justify-end gap-2">
                {weeklyGeneralEntries.map((entry, i) => {
                  const color = WEEK_PALETTE[i % WEEK_PALETTE.length];
                  return (
                    <Link
                      key={entry.id}
                      href={entry.href}
                      onClick={() => onOpenChange(false)}
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition hover:opacity-80 ${color.chip}`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${color.bar}`} />
                      <span>{entry.title}</span>
                      {entry.subtitle ? <span className="opacity-60">· {entry.subtitle}</span> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* 7-day calendar grid */}
          <div className="overflow-x-auto rounded-xl border">
            <div className="flex min-w-[500px]">
              {weeklyBuckets.map(({ day, entries, isToday }) => {
                return (
                  <div
                    key={day.toISOString()}
                    className={`flex flex-1 flex-col border-r last:border-r-0 ${isToday ? "bg-primary/5" : "bg-background"}`}
                  >
                    {/* Day header */}
                    <div className={`border-b px-1 py-2 text-center ${isToday ? "bg-primary/10" : ""}`}>
                      <div className="text-xs text-muted-foreground">{shortWeekDay(day)}</div>
                      <div
                        className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${
                          isToday ? "bg-primary text-primary-foreground" : ""
                        }`}
                      >
                        {day.getDate()}
                      </div>
                    </div>

                    {/* Ongoing project color bars */}
                    {weeklyGeneralEntries.length > 0 && (
                      <div className="flex flex-col gap-px px-1 pt-1.5">
                        {weeklyGeneralEntries.map((entry, i) => (
                          <div
                            key={entry.id}
                            title={entry.title}
                            className={`h-1.5 rounded-sm opacity-75 ${WEEK_PALETTE[i % WEEK_PALETTE.length].bar}`}
                          />
                        ))}
                      </div>
                    )}

                    {/* Day-specific entries */}
                    <div className="flex flex-1 flex-col gap-1 p-1 pt-1.5">
                      {entries.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center py-2">
                          <span className="text-[10px] text-muted-foreground/40">—</span>
                        </div>
                      ) : (
                        entries.map((entry) => (
                          <Link
                            key={entry.id}
                            href={entry.href}
                            onClick={() => onOpenChange(false)}
                            className={`block rounded-md border px-1.5 py-1 text-[11px] leading-tight transition hover:border-primary/40 hover:bg-primary/5 ${
                              entry.kind === "task" ? "border-warning/40 bg-warning-soft" : "bg-background"
                            }`}
                          >
                            <div className="truncate font-medium" title={entry.title}>{entry.title}</div>
                            {entry.subtitle ? (
                              <div className="truncate text-muted-foreground" title={entry.subtitle}>{entry.subtitle}</div>
                            ) : null}
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </AdaptiveDialog>
    </Dialog>
  );
}

// Worker payment (תשלום לעובד) — records a payment that nets against open debt.
// The validation + allocation math lives in DashboardActions.forms (tested); this
// is the form shell that collects input and calls back.
export function WorkerPaymentDialog({
  open,
  onOpenChange,
  submitting,
  payableWorkers,
  workerPaymentUserId,
  onSelectWorker,
  debtLoading,
  openOwed,
  debtItemCount,
  amount,
  onAmountChange,
  date,
  onDateChange,
  method,
  onMethodChange,
  accountId,
  onAccountIdChange,
  accountsList,
  onAccountsLoaded,
  reference,
  onReferenceChange,
  notes,
  onNotesChange,
  error,
  onSave,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  payableWorkers: { id: string; label: string }[];
  workerPaymentUserId: string;
  onSelectWorker: (userId: string) => void;
  debtLoading: boolean;
  openOwed: number;
  debtItemCount: number;
  amount: string;
  onAmountChange: (value: string) => void;
  date: string;
  onDateChange: (value: string) => void;
  method: string;
  onMethodChange: (value: string) => void;
  accountId: string;
  onAccountIdChange: (value: string) => void;
  accountsList: Account[];
  onAccountsLoaded: (list: Account[]) => void;
  reference: string;
  onReferenceChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="form2xl">
        <DialogHeader className="text-right">
          <DialogTitle>{"תשלום לעובד"}</DialogTitle>
          <DialogDescription>{"רישום תשלום לעובד שעתי / חודשי / קבלן. התשלום יקוזז מהיתרה הפתוחה (תלושים / משמרות)."}</DialogDescription>
        </DialogHeader>

        <fieldset disabled={submitting} className="contents">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2 text-right text-sm md:col-span-2">
              <span className="font-medium">{"עובד *"}</span>
              <SearchableSelect
                ariaLabel="בחירת עובד"
                placeholder="בחרו עובד"
                searchPlaceholder="חיפוש עובד..."
                options={payableWorkers.map((user) => ({ value: user.id, label: user.label }))}
                value={workerPaymentUserId}
                onChange={onSelectWorker}
              />
            </label>

            {workerPaymentUserId ? (
              <div className="md:col-span-2 rounded-xl border bg-muted/30 p-3 text-right text-sm">
                {debtLoading ? (
                  <span className="text-muted-foreground">{"טוען יתרה..."}</span>
                ) : openOwed > 0 ? (
                  <span>
                    {"יתרה פתוחה: "}
                    <span className="font-semibold">{formatCurrency(openOwed)}</span>
                    <span className="text-muted-foreground">{` • ${debtItemCount} פריטים פתוחים`}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {"אין יתרה פתוחה לעובד זה. תשלום שיירשם יישמר כמקדמה ללא קיזוז."}
                  </span>
                )}
              </div>
            ) : null}

            <label className="space-y-2 text-right text-sm">
              <span className="font-medium">{"סכום *"}</span>
              <CurrencyInput value={amount} onChange={(e) => onAmountChange(e.target.value)} />
            </label>

            <label className="space-y-2 text-right text-sm">
              <span className="font-medium">{"תאריך תשלום *"}</span>
              <DateInput value={date} onChange={(e) => onDateChange(e.target.value)} />
            </label>

            <label className="space-y-2 text-right text-sm">
              <span className="font-medium">{HEBREW.paymentMethod}</span>
              <select
                className={`${fieldClass} text-right`}
                value={method}
                onChange={(e) => {
                  const m = e.target.value;
                  onMethodChange(m);
                  if (!accountId) onAccountIdChange(defaultAccountForMethod(accountsList, m));
                }}
              >
                <option value=""></option>
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <AccountSelect
              required
              value={accountId}
              onChange={onAccountIdChange}
              onLoaded={(list) => {
                onAccountsLoaded(list);
                if (!accountId) onAccountIdChange(defaultAccountForMethod(list, method));
              }}
            />

            <label className="space-y-2 text-right text-sm">
              <span className="font-medium">{"אסמכתא"}</span>
              <Input value={reference} onChange={(e) => onReferenceChange(e.target.value)} />
            </label>

            <label className="space-y-2 text-right text-sm md:col-span-2">
              <span className="font-medium">{HEBREW.notes}</span>
              <Textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={2} />
            </label>
          </div>
        </fieldset>

        {error ? <p className="text-right text-sm text-destructive">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            {HEBREW.cancel}
          </Button>
          <Button type="button" onClick={onSave} disabled={submitting || debtLoading}>
            {submitting ? HEBREW.saving : "שמירת תשלום"}
          </Button>
        </div>
      </AdaptiveDialog>
    </Dialog>
  );
}
