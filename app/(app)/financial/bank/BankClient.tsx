"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, TransferIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AccountTransferDialog } from "@/components/financial/AccountTransferDialog";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import type { MerchantMemory } from "@/lib/financial/cardImport";
import QuickEntryRow from "./QuickEntryRow";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import {
  getAccountKindLabel,
  type AccountDeleteRef,
  type AccountEditRef,
  type AccountTransferRef,
  type AccountWithLedger,
} from "@/lib/accounts";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import { PaymentEditDialog } from "@/components/financial/PaymentEditDialog";
import { EditWorkerPaymentDialog } from "@/components/payroll/EditWorkerPaymentDialog";
import { EditPaidRepaymentDialog, LoanFormDialog } from "@/app/(app)/financial/loans/LoanDialogs";
import { deleteLoan, deleteRepayment } from "@/app/(app)/financial/loans/actions";
import type { Loan } from "@/lib/loans";

function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year.slice(-2)}`;
}

function AccountSummaryCard({
  account,
  selected,
  onSelect,
}: {
  account: AccountWithLedger;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    // The whole card selects the account. הכנסה / הוצאה moved onto the tab bar
    // below, where they act on the account that's actually open — one place to
    // record money instead of a pair of glyphs on every card.
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start justify-between gap-2 rounded-lg border bg-background p-3 text-right transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-foreground/30"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium break-words">{account.name}</span>
        {/* Money colour: in the black is green, in the red is red. */}
        <span
          dir="ltr"
          className={cn(
            "mt-1 block text-2xl font-semibold tabular-nums",
            account.currentBalance < 0 ? "text-destructive" : "text-success"
          )}
        >
          {formatIls(account.currentBalance)}
        </span>
        {(account.pendingIn > 0 || account.pendingOut > 0) && (
          <span dir="ltr" className="mt-1 flex flex-wrap justify-end gap-x-3 text-xs tabular-nums">
            {account.pendingIn > 0 && (
              <span className="text-success">+{formatIls(account.pendingIn)} צפוי</span>
            )}
            {account.pendingOut > 0 && (
              <span className="text-destructive">−{formatIls(account.pendingOut)} צפוי</span>
            )}
          </span>
        )}
      </span>

      <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
        {getAccountKindLabel(account.kind)}
      </span>
    </button>
  );
}

export default function BankClient({
  accounts,
  loans,
  initialAccountId = "",
  projects = [],
  merchantMemory = {},
}: {
  accounts: AccountWithLedger[];
  /** For a loan/loan_repayment row's inline edit — the full computed shape
   *  LoanFormDialog/EditPaidRepaymentDialog need, not just the ledger scan's
   *  display fields. */
  loans: Loan[];
  /** From ?account= — so a link can open straight on one account. */
  initialAccountId?: string;
  /** For the quick-entry row above the register. */
  projects?: Array<{ id: string; name: string }>;
  merchantMemory?: MerchantMemory;
}) {
  const router = useRouter();
  const loansById = useMemo(() => new Map(loans.map((l) => [l.id, l] as const)), [loans]);
  const [selectedId, setSelectedId] = useState<string>(
    accounts.find((a) => a.id === initialAccountId)?.id ?? accounts[0]?.id ?? ""
  );

  function selectAccount(accountId: string) {
    setSelectedId(accountId);
    setMonthFilter("");
    setOpenMonths({});
    // Keep the address bar honest without asking the server for the page again.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/financial/bank?account=${accountId}`);
    }
  }

  // "" = כל החודשים. Reset when switching accounts — a month that exists in one
  // account's register often doesn't in another's.
  const [monthFilter, setMonthFilter] = useState("");
  // Per-month open/closed, keyed by "YYYY-MM". Absent = follow the default.
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [transferOpen, setTransferOpen] = useState(false);
  // The transfer being edited from the register; null = the dialog is creating.
  const [transferToEdit, setTransferToEdit] = useState<AccountTransferRef | null>(null);
  // A transfer row the user asked to delete — both its legs go together.
  const [transferToDelete, setTransferToDelete] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);

  async function deleteTransfer(id: string) {
    setDeleting(true);
    setDeleteError(undefined);
    try {
      const res = await fetch(`/api/financial/transfers?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeleteError(toHebrewError(json.error, "מחיקת ההעברה נכשלה."));
        return;
      }
      setTransferToDelete(null);
      router.refresh();
      toast.success("ההעברה נמחקה.");
    } catch (error: unknown) {
      setDeleteError(toHebrewError(error, "מחיקת ההעברה נכשלה."));
    } finally {
      setDeleting(false);
    }
  }

  // ── Inline edit/delete for every OTHER row kind (payment, expense, worker
  // payment, loan, loan repayment). Every kind gets both now. Expense/loan/
  // loan_repayment already carry what their dialog needs right on the row;
  // payment and worker_payment fetch their own context on click instead (see
  // PaymentEditDialog / EditWorkerPaymentDialog) — too expensive, and in the
  // worker_payment case too *risky* (existing session/payslip allocations
  // must round-trip untouched), to preload for every ledger row.
  const [editingExpenseRef, setEditingExpenseRef] = useState<Extract<AccountEditRef, { kind: "expense" }> | null>(null);
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [editingRepaymentRef, setEditingRepaymentRef] = useState<Extract<AccountEditRef, { kind: "loan_repayment" }> | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingWorkerPaymentId, setEditingWorkerPaymentId] = useState<string | null>(null);
  const [rowToDelete, setRowToDelete] = useState<{ ref: AccountDeleteRef; label: string } | null>(null);
  const [rowDeleting, setRowDeleting] = useState(false);
  const [rowDeleteError, setRowDeleteError] = useState<string | undefined>(undefined);

  function openEdit(ref: AccountEditRef) {
    if (ref.kind === "expense") setEditingExpenseRef(ref);
    else if (ref.kind === "loan") setEditingLoanId(ref.loanId);
    else if (ref.kind === "loan_repayment") setEditingRepaymentRef(ref);
    else if (ref.kind === "payment") setEditingPaymentId(ref.id);
    else setEditingWorkerPaymentId(ref.id);
  }

  function deleteRowLabel(ref: AccountDeleteRef): string {
    if (ref.kind === "loan") {
      return "מחיקת ההלוואה תמחק גם את כל החזרי ההלוואה שנרשמו עבורה (כולל תשלומים מתוכננים).";
    }
    if (ref.kind === "loan_repayment") return "יתרת ההלוואה תחושב מחדש בהתאם.";
    if (ref.kind === "expense") return "ההוצאה תימחק מהתזרים ומהקישור שלה למקור, אם קיים.";
    if (ref.kind === "worker_payment") return "התשלום יימחק, כולל השיוכים שלו למשמרות/תלושים.";
    if (ref.kind === "card_charge") return "החיוב יימחק מהתזרים. השורות בפירוט האשראי עצמו לא יימחקו.";
    return "התנועה תימחק מהתזרים.";
  }

  async function deleteRow() {
    if (!rowToDelete) return;
    const { ref } = rowToDelete;
    setRowDeleting(true);
    setRowDeleteError(undefined);
    try {
      if (ref.kind === "loan") {
        const result = await deleteLoan(ref.id);
        if (!result.ok) {
          setRowDeleteError(result.error);
          return;
        }
      } else if (ref.kind === "loan_repayment") {
        const result = await deleteRepayment(ref.id, ref.loanId);
        if (!result.ok) {
          setRowDeleteError(result.error);
          return;
        }
      } else if (ref.kind === "card_charge") {
        const res = await fetch(`/api/financial/card-charges?id=${encodeURIComponent(ref.id)}`, {
          method: "DELETE",
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setRowDeleteError(toHebrewError(json.error, "המחיקה נכשלה."));
          return;
        }
      } else {
        const request =
          ref.kind === "payment"
            ? ref.orderId
              ? { url: "/api/orders/payments/delete", body: { id: ref.id, order_id: ref.orderId } }
              : { url: "/api/payments/delete", body: { id: ref.id, project_id: ref.projectId || undefined } }
            : ref.kind === "expense"
              ? {
                  url: "/api/expenses/delete",
                  body: {
                    id: ref.id,
                    project_id: ref.projectId || undefined,
                    order_id: ref.orderId || undefined,
                    property_id: ref.propertyId || undefined,
                  },
                }
              : { url: "/api/payroll/worker-payments", body: { payment_id: ref.id, user_id: ref.userId || undefined } };
        const res = await fetch(request.url, {
          method: ref.kind === "worker_payment" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setRowDeleteError(toHebrewError(json.error, "המחיקה נכשלה."));
          return;
        }
      }
      setRowToDelete(null);
      router.refresh();
      toast.success("הרשומה נמחקה.");
    } catch (error: unknown) {
      setRowDeleteError(toHebrewError(error, "המחיקה נכשלה."));
    } finally {
      setRowDeleting(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="space-y-4 text-right" dir="rtl">
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              עדיין לא הוגדרו חשבונות. הגדר חשבונות בנק וקופות מזומן עם יתרת פתיחה כדי לראות כאן את
              היתרה העדכנית של כל אחד.
            </p>
            <Button asChild>
              <Link href="/settings">להגדרת חשבונות</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];
  const totalLiquidity = accounts
    .filter((a) => a.isActive)
    .reduce((sum, a) => sum + a.currentBalance, 0);

  // Group the selected account's ledger (already newest-first) by month, and
  // total each month so a folded header still says what happened in it.
  const allGroups: Array<{
    month: string;
    items: typeof selected.ledger;
    in: number;
    out: number;
    closing: number; // balance at the end of that month
  }> = [];
  for (const row of selected.ledger) {
    const month = row.date.slice(0, 7);
    const last = allGroups[allGroups.length - 1];
    const group =
      last && last.month === month
        ? last
        : (allGroups[
            allGroups.push({ month, items: [], in: 0, out: 0, closing: 0 }) - 1
          ] as (typeof allGroups)[number]);
    group.items.push(row);
    if (row.posted) {
      if (row.type === "in") group.in += row.amount;
      else group.out += row.amount;
    }
  }
  // End-of-month balance: the running balance of that month's LAST posted row.
  // Walk oldest→newest (the list is newest-first) carrying the last known figure
  // forward, so a month with only pending rows closes where the month before it
  // did rather than showing nothing.
  let carriedBalance = selected.openingBalance;
  for (let i = allGroups.length - 1; i >= 0; i -= 1) {
    const group = allGroups[i];
    // Items are newest-first inside the group, so the first posted one is the
    // month's closing row.
    const lastPosted = group.items.find((row) => row.runningBalance !== null);
    if (lastPosted) carriedBalance = lastPosted.runningBalance as number;
    group.closing = carriedBalance;
  }
  const groups = monthFilter ? allGroups.filter((g) => g.month === monthFilter) : allGroups;
  // THIS calendar month open by default, older (and any newer — a post-dated
  // check can group under next month) ones folded, until the reader says
  // otherwise. Local date parts, not UTC, so this doesn't slip a day/month
  // around midnight. Falls back to the newest group when nothing's posted yet
  // this month, so the register isn't just all-collapsed. With a month
  // filtered there's exactly one group, and it always opens.
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const hasCurrentMonth = groups.some((g) => g.month === currentMonth);
  const isMonthOpen = (month: string, index: number) =>
    openMonths[month] ?? (hasCurrentMonth ? month === currentMonth : index === 0);

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">סך נזילות (חשבונות פעילים)</div>
            <div
              dir="ltr"
              className={cn(
                "text-2xl font-semibold tabular-nums",
                totalLiquidity < 0 ? "text-destructive" : "text-success"
              )}
            >
              {formatIls(totalLiquidity)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setTransferToEdit(null);
                setTransferOpen(true);
              }}
            >
              <TransferIcon className="h-4 w-4" />
              העברה בין חשבונות
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/settings">ניהול חשבונות</Link>
            </Button>
          </div>
        </div>

      <AdaptiveGrid variant="customerStats">
        {accounts.map((account) => (
          <AccountSummaryCard
            key={account.id}
            account={account}
            selected={account.id === selected.id}
            onSelect={() => selectAccount(account.id)}
          />
        ))}
      </AdaptiveGrid>

      {/* Register for the selected account */}
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <div className="font-medium">{selected.name}</div>
            <div className="flex flex-wrap items-center gap-3">
              {allGroups.length > 0 ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>חודש</span>
                  <NativeSelect
                    className="h-9 w-auto"
                    aria-label="סינון לפי חודש"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                  >
                    <option value="">כל החודשים</option>
                    {allGroups.map((group) => (
                      <option key={group.month} value={group.month}>
                        {monthLabel(group.month)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
              <div className="text-xs text-muted-foreground">
                יתרת פתיחה {formatIls(selected.openingBalance)} · נכון ל-
                <span dir="ltr">{formatDate(selected.openingDate)}</span>
              </div>
            </div>
          </div>

          {selected.ledger.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              אין תנועות משויכות לחשבון זה עדיין. תנועות יופיעו כאן ברגע שתשייך תקבולים והוצאות
              לחשבון.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {groups.map((group, groupIndex) => {
                const open = isMonthOpen(group.month, groupIndex);
                return (
                <Fragment key={group.month}>
                  {/* The month header folds its rows away and, closed, still
                      reports what moved that month. */}
                  <button
                    type="button"
                    onClick={() =>
                      setOpenMonths((prev) => ({ ...prev, [group.month]: !open }))
                    }
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 bg-muted/30 px-3 py-2 text-right text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60"
                  >
                    <ChevronDownIcon
                      className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
                    />
                    <span dir="ltr" className="tabular-nums">
                      {monthLabel(group.month)}
                    </span>
                    <span className="text-muted-foreground/70">({group.items.length})</span>
                    <span className="ms-auto flex items-center gap-2">
                      <span dir="ltr" className="flex items-center gap-2 tabular-nums">
                        {group.in > 0 && (
                          <span className="text-success">+{formatIls(group.in)}</span>
                        )}
                        {group.out > 0 && (
                          <span className="text-destructive">−{formatIls(group.out)}</span>
                        )}
                      </span>
                      {/* Where the account stood when the month ended. */}
                      <span className="hidden text-muted-foreground/70 sm:inline">יתרה</span>
                      <span dir="ltr" className="tabular-nums font-semibold text-foreground">
                        {formatIls(group.closing)}
                      </span>
                    </span>
                  </button>
                  {open &&
                  group.items.map((row) => {
                    const inner = (
                      <>
                        {/* flex-1 so the amount (and the delete button on a
                            transfer row) stay pinned to the end of the row. */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium break-words">{row.label}</span>
                            {!row.posted && (
                              <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                                צפוי
                              </span>
                            )}
                          </div>
                          <div className="text-xs break-words text-muted-foreground">
                            <span dir="ltr">{formatDate(row.date)}</span>
                            {row.sublabel && <span> · {row.sublabel}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          <div
                            dir="ltr"
                            className={cn(
                              "font-semibold tabular-nums",
                              row.type === "in" ? "text-success" : "text-destructive"
                            )}
                          >
                            {row.type === "in" ? "+" : "−"}
                            {formatIls(row.amount)}
                          </div>
                          {row.runningBalance !== null && (
                            <div dir="ltr" className="text-xs tabular-nums text-muted-foreground">
                              {formatIls(row.runningBalance)}
                            </div>
                          )}
                        </div>
                      </>
                    );
                    // The label/amount block links to the source record when
                    // there is one (order/project/loan/worker payroll) — click
                    // anywhere on it to open that. A transfer has none (it's the
                    // one ledger row that lives ONLY here), and either way the
                    // edit/delete cluster sits OUTSIDE this link so the buttons
                    // stay their own click target, not nested inside an <a>.
                    const transfer = row.transfer;
                    const content = row.href ? (
                      <Link href={row.href} className="flex min-w-0 flex-1 items-center gap-3">
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-3">{inner}</div>
                    );
                    const rowLabel = `${row.label} · ${formatIls(row.amount)}`;
                    return (
                      <div
                        key={row.id}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
                      >
                        {content}
                        {(row.editRef || row.deleteRef || transfer) && (
                          <div className="flex shrink-0 items-center gap-0.5">
                            {row.editRef && (
                              <EditButton label="עריכה" onClick={() => openEdit(row.editRef!)} />
                            )}
                            {transfer && (
                              <EditButton
                                label="עריכת העברה"
                                onClick={() => {
                                  setTransferToEdit(transfer);
                                  setTransferOpen(true);
                                }}
                              />
                            )}
                            {row.deleteRef && (
                              <DeleteButton
                                label="מחיקה"
                                onClick={() => setRowToDelete({ ref: row.deleteRef!, label: rowLabel })}
                              />
                            )}
                            {transfer && (
                              <DeleteButton
                                label="מחיקת העברה"
                                onClick={() => setTransferToDelete({ id: transfer.id, label: rowLabel })}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Fragment>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>


      <p className="text-xs text-muted-foreground">
        היתרה מחושבת מיתרת הפתיחה ועוד התקבולים, הלוואות שהתקבלו והחזרים שנגבו, פחות ההוצאות,
        תשלומי השכר, הלוואות שניתנו והחזרי הלוואות ששויכו לחשבון. תנועות מסומנות כ״צפוי״ (צ׳קים
        שטרם נפרעו, הוצאות שטרם שולמו) מוצגות אך אינן נכללות ביתרה. העברה בין חשבונות מופיעה
        בשני החשבונות — יציאה מאחד וכניסה לשני — ואינה נרשמת כהכנסה או כהוצאה.
      </p>

      {/* Reading the bank's own site beside this one: type the line, hit
          הכנסה / הוצאה, move on. Last in the flow and pinned to the bottom of
          the window, so it's under the register and under your hands. */}
      <QuickEntryRow
        account={selected}
        projects={projects}
        merchantMemory={merchantMemory}
        onSaved={() => router.refresh()}
      />

      <AccountTransferDialog
        open={transferOpen}
        onOpenChange={(next) => {
          setTransferOpen(next);
          // Drop the edit target on close so the next "העברה בין חשבונות"
          // click opens a blank form, not the row that was last edited.
          if (!next) setTransferToEdit(null);
        }}
        transfer={transferToEdit}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={transferToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTransferToDelete(null);
            setDeleteError(undefined);
          }
        }}
        title="מחיקת העברה"
        description="ההעברה תימחק משני החשבונות והיתרות יחזרו למצבן הקודם."
        confirmLabel="מחיקה"
        destructive
        loading={deleting}
        error={deleteError}
        onConfirm={() => {
          if (transferToDelete) void deleteTransfer(transferToDelete.id);
        }}
      >
        {transferToDelete ? (
          <div className="text-sm font-medium">{transferToDelete.label}</div>
        ) : null}
      </ConfirmDialog>

      <ExpenseDialog
        open={editingExpenseRef !== null}
        onOpenChange={(open) => {
          if (!open) setEditingExpenseRef(null);
        }}
        editingExpense={editingExpenseRef?.data}
        lockedProjectId={editingExpenseRef?.data.project_id}
        lockedOrderId={editingExpenseRef?.data.order_id}
        lockedPropertyId={editingExpenseRef?.data.property_id}
        onSaved={() => {
          setEditingExpenseRef(null);
          router.refresh();
        }}
      />

      <LoanFormDialog
        open={editingLoanId !== null}
        loan={editingLoanId ? (loansById.get(editingLoanId) ?? null) : null}
        onOpenChange={(open) => {
          if (!open) setEditingLoanId(null);
        }}
      />

      {editingRepaymentRef && loansById.get(editingRepaymentRef.loanId) && (
        <EditPaidRepaymentDialog
          loan={loansById.get(editingRepaymentRef.loanId)!}
          repayment={editingRepaymentRef.repayment}
          onOpenChange={(open) => {
            if (!open) setEditingRepaymentRef(null);
          }}
        />
      )}

      <PaymentEditDialog
        paymentId={editingPaymentId}
        onOpenChange={(open) => {
          if (!open) setEditingPaymentId(null);
        }}
        onSaved={() => {
          setEditingPaymentId(null);
          router.refresh();
        }}
      />

      <EditWorkerPaymentDialog
        paymentId={editingWorkerPaymentId}
        onOpenChange={(open) => {
          if (!open) setEditingWorkerPaymentId(null);
        }}
        onSaved={() => {
          setEditingWorkerPaymentId(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={rowToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRowToDelete(null);
            setRowDeleteError(undefined);
          }
        }}
        title="מחיקת תנועה"
        description={rowToDelete ? deleteRowLabel(rowToDelete.ref) : ""}
        confirmLabel="מחיקה"
        destructive
        loading={rowDeleting}
        error={rowDeleteError}
        onConfirm={() => void deleteRow()}
      >
        {rowToDelete ? <div className="text-sm font-medium">{rowToDelete.label}</div> : null}
      </ConfirmDialog>
    </div>
  );
}
