"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, DeleteIcon, EditIcon, MoreIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/ui/native-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AccountTransferDialog } from "@/components/financial/AccountTransferDialog";
import { useSetHeaderAction, useSetHeaderTrailingAction } from "@/components/layout/page-title-context";
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
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import { PaymentEditDialog } from "@/components/financial/PaymentEditDialog";
import { EditWorkerPaymentDialog } from "@/components/payroll/EditWorkerPaymentDialog";
import { EditPaidRepaymentDialog, LoanFormDialog } from "@/app/(app)/financial/loans/LoanDialogs";
import { deleteLoan, deleteRepayment } from "@/app/(app)/financial/loans/actions";
import type { Loan } from "@/lib/loans";
import { formatMoneyRounded } from "@/lib/money";

// Was a local Intl-currency-style formatter — exactly the anti-pattern
// lib/money.ts's own docstring warns about ("every hand-written
// Intl.NumberFormat(...,{style:'currency'}) in the app disagrees" with the
// canonical ₪-first shape). That's why this page mixed ₪-after-a-space,
// ₪-with-no-space and even different dash characters for negative amounts
// depending on which spot on the page you looked at (user, 2026-08-31:
// "Number formatting is inconsistent ... Pick one"). formatMoneyRounded is
// used everywhere below instead — money.ts's canonical ₪-first shape, but
// rounded to whole shekels like the old local formatter was (plain
// formatMoney allows up to 2 decimals, which briefly leaked ugly amounts
// like ₪128,006.4 onto this page after the first switch).

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
    // Corner/center/bottom layout (user, 2026-08-31): name + kind badge pinned
    // to their top corners, the balance centered in the middle of the card
    // (not just left-aligned under the header row), pending amounts pinned to
    // the bottom. h-full so every card in a flex-wrap row stretches to match
    // the tallest one, and the middle flex-1 row centers within whatever
    // height that leaves.
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-full w-full flex-col items-stretch gap-1.5 rounded-lg border bg-background p-3 text-right transition-colors",
        // Inverted — navy fill, white text — not just a border, after a
        // round of borders (white fill/secondary border, then a plain
        // thicker primary border) that a reviewer correctly called a "weak
        // selection signal": at 1px-3px a navy edge barely reads as
        // different from the card's own default border. Solid primary fill
        // is unmissable AND ties the selected account to the chrome, since
        // primary IS the chrome colour (2026-08-31 design review).
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "hover:border-foreground/30"
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0 flex-1 break-words text-sm font-medium">{account.name}</span>
        <span
          className={cn(
            "shrink-0 rounded-full border px-1.5 py-0 text-[10px]",
            selected ? "border-primary-foreground/30 text-primary-foreground/80" : "text-muted-foreground"
          )}
        >
          {getAccountKindLabel(account.kind)}
        </span>
      </span>
      <span className="flex flex-1 items-center justify-center">
        {/* Only the sign is red/green — the figure itself stays neutral text.
            Red/green on the WHOLE number would double as this card's only
            "danger" signal, but red already means danger everywhere else in
            the app (delete, destructive badges, errors) — a negative balance
            isn't that (user, 2026-08-31: "colour is overloaded... red means
            danger everywhere else"). */}
        <span dir="ltr" className="block text-xl font-semibold tabular-nums">
          <span className={account.currentBalance < 0 ? "text-destructive" : "text-success"}>
            {account.currentBalance < 0 ? "-" : "+"}
          </span>
          {formatMoneyRounded(Math.abs(account.currentBalance))}
        </span>
      </span>
      {/* Only the selected card's own pending amounts — every card showing its
          own צפוי line at once was noise (user, 2026-08-31). */}
      {selected && (account.pendingIn > 0 || account.pendingOut > 0) && (
        <span dir="ltr" className="flex flex-wrap justify-end gap-x-2 text-xs tabular-nums">
          {account.pendingIn > 0 && (
            <span>
              <span className="text-success">+</span>
              {formatMoneyRounded(account.pendingIn)} צפוי
            </span>
          )}
          {account.pendingOut > 0 && (
            <span>
              <span className="text-destructive">-</span>
              {formatMoneyRounded(account.pendingOut)} צפוי
            </span>
          )}
        </span>
      )}
    </button>
  );
}

export default function BankClient({
  accounts,
  loans,
  initialAccountId = "",
  projects = [],
  recurringProperties = [],
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
  /** For the expense-edit dialog's property picker — see ExpenseDialog's
   *  `recurringProperties` prop. */
  recurringProperties?: Array<{ id: string; label: string }>;
  merchantMemory?: MerchantMemory;
}) {
  const router = useRouter();
  const loansById = useMemo(() => new Map(loans.map((l) => [l.id, l] as const)), [loans]);
  // Total liquidity + "ניהול חשבונות" moved OUT of the page and split across
  // TWO top-bar slots, not moved together — the total stays near the back-
  // arrow/sidebar side (headerAction), the button moves near the search/
  // avatar cluster (trailingAction) (user, 2026-08-31: "leave the total
  // there and move the button to be near the icons"). Computed here (before
  // the accounts.length===0 early return below) so these hooks are always
  // called, never conditionally.
  const totalLiquidity = accounts.filter((a) => a.isActive).reduce((sum, a) => sum + a.currentBalance, 0);
  const headerAction = useMemo(
    () => (
      // mt-1.5: a little breathing room above the label — the 60px bar's
      // items-center was landing it almost flush with the top edge (user,
      // 2026-08-31: "a drop more space on top of the total and the button").
      <div className="hidden mt-1.5 text-right leading-tight sm:block">
        <div className="text-[10px] text-muted-foreground">סך נזילות</div>
        {/* Whole figure colored red/green here — a deliberate exception to
            the sign-only treatment on the account tiles (user, 2026-08-31:
            "the top number should be red or green reflecting the amount
            unlike the account totals"). */}
        <div
          dir="ltr"
          className={cn(
            "text-2xl font-semibold tabular-nums",
            totalLiquidity < 0 ? "text-destructive" : "text-success"
          )}
        >
          {formatMoneyRounded(totalLiquidity)}
        </div>
      </div>
    ),
    [totalLiquidity]
  );
  useSetHeaderAction(headerAction);
  const trailingAction = useMemo(
    () => (
      // Outline, not filled — a deliberate, confirmed exception to the usual
      // "buttons always get a fill" rule for this one button (user,
      // 2026-08-31: "i know i set the rule but i still want outline").
      // mt-1.5 matches the total's own nudge below the top edge.
      <Button asChild variant="outline" size="sm" className="mt-1.5">
        {/* ?tab=finance — SettingsTabs now reads this; it used to always land
            on the first (notifications) tab (user, 2026-08-31). */}
        <Link href="/settings?tab=finance">ניהול חשבונות</Link>
      </Button>
    ),
    []
  );
  useSetHeaderTrailingAction(trailingAction);
  const [selectedId, setSelectedId] = useState<string>(
    accounts.find((a) => a.id === initialAccountId)?.id ?? accounts[0]?.id ?? ""
  );

  // THIS month should be the first thing on screen when you land here or
  // switch accounts — not something you scroll past a year of future-dated
  // groups to find (user, 2026-08-31: "this month should be first ... scroll
  // up to see the months upcoming"). Registered here (before the
  // accounts.length===0 early return) so the hook itself is always called;
  // the effect body below just no-ops if that month's button never mounts
  // (e.g. filtered to a different month, or no accounts at all).
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthNodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // The register itself scrolls (max-h-[70vh] overflow-y-auto below), with
  // its own account-name/month-filter header pinned via sticky top-0 — NOT
  // the page (user, 2026-08-31: "the whole page jumps ... i dont want the
  // page to move just the table to be scrolled"). scrollIntoView would also
  // scroll the WINDOW to bring this container into view if it isn't already
  // fully on screen, so this sets registerScrollRef's own scrollTop directly
  // instead — that can only ever move this one container.
  const registerScrollRef = useRef<HTMLDivElement>(null);
  const registerHeaderRef = useRef<HTMLDivElement>(null);
  // QuickEntryRow's own page-level spacer only reserves room in NORMAL page
  // flow (below this whole register), which does nothing for a container
  // that scrolls in its own bounded box — the last rows were still landing
  // behind the fixed bar regardless (user, 2026-08-31: "the add bar still
  // covers rows ... padding-bottom on the list equal to the bar's height").
  // QuickEntryRow reports its live height here via onHeightChange, applied
  // below as the scroll container's own padding-bottom so the last real row
  // can always scroll fully clear of the bar.
  const [quickEntryHeight, setQuickEntryHeight] = useState(0);
  useLayoutEffect(() => {
    const container = registerScrollRef.current;
    const target = monthNodeRefs.current.get(currentMonth);
    if (!container || !target) return;
    const headerHeight = registerHeaderRef.current?.offsetHeight ?? 0;
    const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += offset - headerHeight;
  }, [selectedId, currentMonth]);

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
              <Link href="/settings?tab=finance">להגדרת חשבונות</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];

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
  // (`now`/`currentMonth` are computed above, before the early return.)
  const hasCurrentMonth = groups.some((g) => g.month === currentMonth);
  const isMonthOpen = (month: string, index: number) =>
    openMonths[month] ?? (hasCurrentMonth ? month === currentMonth : index === 0);

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {/* Total liquidity + "ניהול חשבונות" now live in the top bar's action
          slot (see headerAction above). The "העברה בין חשבונות" create button
          that used to sit here is gone too — creating a transfer is already
          covered by the + quick-create menu; only editing/deleting an
          existing one still happens inline in the register below. */}
      {/* A single scrollable row, not a wrapping grid — a fixed-column grid
          left a lopsided gap when there were fewer accounts than columns, and
          wrapping to more rows doesn't scale as accounts are added (user,
          2026-08-31: "i want the strip to scroll if there are more cards").
          shrink-0 on each card keeps it from being squeezed by the scroll
          container; no justify-center here — combined with overflow-x-auto
          that's a known way to clip the first/last card once the row
          actually overflows. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {accounts.map((account) => (
          <div key={account.id} className="w-36 shrink-0">
            <AccountSummaryCard
              account={account}
              selected={account.id === selected.id}
              onSelect={() => selectAccount(account.id)}
            />
          </div>
        ))}
      </div>

      {/* Register for the selected account. Scrolls WITHIN this bounded
          container (not the page) — see registerScrollRef above. */}
      <Card>
        <CardContent className="p-0">
          <div
            ref={registerScrollRef}
            className="max-h-[70vh] overflow-y-auto"
            style={{ paddingBottom: quickEntryHeight }}
          >
            {/* Sticky, solid background (not the old translucent one — a
                sticky header needs to actually occlude what scrolls under
                it): the account name + month filter stay pinned as the
                register scrolls (user, 2026-08-31: "i want the table header
                sticky - the account name and the month sticky"). */}
            <div
              ref={registerHeaderRef}
              className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-3 py-2"
            >
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
                  יתרת פתיחה {formatMoneyRounded(selected.openingBalance)} · נכון ל-
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
                      reports what moved that month. Registered in
                      monthNodeRefs so the register can scroll (its own
                      container's scrollTop — see registerScrollRef above) to
                      land the current month right under the sticky header on
                      open/account-switch. */}
                  <button
                    ref={(el) => {
                      if (el) monthNodeRefs.current.set(group.month, el);
                      else monthNodeRefs.current.delete(group.month);
                    }}
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
                          <span className="text-success">+{formatMoneyRounded(group.in)}</span>
                        )}
                        {group.out > 0 && (
                          <span className="text-destructive">-{formatMoneyRounded(group.out)}</span>
                        )}
                      </span>
                      {/* Where the account stood when the month ended. */}
                      <span className="hidden text-muted-foreground/70 sm:inline">יתרה</span>
                      <span dir="ltr" className="tabular-nums font-semibold text-foreground">
                        {formatMoneyRounded(group.closing)}
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
                            {row.type === "in" ? "+" : "-"}
                            {formatMoneyRounded(row.amount)}
                          </div>
                          {row.runningBalance !== null && (
                            <div dir="ltr" className="text-xs tabular-nums text-muted-foreground">
                              {formatMoneyRounded(row.runningBalance)}
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
                    const rowLabel = `${row.label} · ${formatMoneyRounded(row.amount)}`;
                    return (
                      <div
                        key={row.id}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
                      >
                        {content}
                        {/* A single "⋮" menu instead of separate edit/delete icon
                            buttons on every row (user, 2026-08-31) — same pattern
                            as ProjectMovements.tsx's RowActions. */}
                        {(row.editRef || row.deleteRef || transfer) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                                title="פעולות"
                                aria-label="פעולות"
                              >
                                <MoreIcon className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              {row.editRef && (
                                <DropdownMenuItem onClick={() => openEdit(row.editRef!)}>
                                  <EditIcon className="me-2 h-4 w-4" />
                                  עריכה
                                </DropdownMenuItem>
                              )}
                              {transfer && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setTransferToEdit(transfer);
                                    setTransferOpen(true);
                                  }}
                                >
                                  <EditIcon className="me-2 h-4 w-4" />
                                  עריכת העברה
                                </DropdownMenuItem>
                              )}
                              {row.deleteRef && (
                                <DropdownMenuItem
                                  onClick={() => setRowToDelete({ ref: row.deleteRef!, label: rowLabel })}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <DeleteIcon className="me-2 h-4 w-4" />
                                  מחיקה
                                </DropdownMenuItem>
                              )}
                              {transfer && (
                                <DropdownMenuItem
                                  onClick={() => setTransferToDelete({ id: transfer.id, label: rowLabel })}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <DeleteIcon className="me-2 h-4 w-4" />
                                  מחיקת העברה
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    );
                  })}
                </Fragment>
                );
              })}
            </div>
          )}
          </div>
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
        properties={recurringProperties}
        merchantMemory={merchantMemory}
        onSaved={() => router.refresh()}
        onHeightChange={setQuickEntryHeight}
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
        // NOT lockedPropertyId — see the same note in FinancialPageClient.tsx;
        // property_id is meant to be freely re-editable, unlike project/order.
        recurringProperties={recurringProperties}
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
