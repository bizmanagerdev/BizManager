"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronDownIcon, DeleteIcon, EditIcon, MoreIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/ui/native-select";
import { SEGMENT, SEGMENTED_GROUP, TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SwipeActions, type SwipeAction } from "@/components/ui/swipe-actions";
import { AccountTransferDialog } from "@/components/financial/AccountTransferDialog";
import { useSetHeaderAction, useSetHeaderTrailingAction } from "@/components/layout/page-title-context";
import type { MerchantMemory } from "@/lib/financial/cardImport";
import { toast } from "sonner";
import QuickEntryRow from "./QuickEntryRow";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import {
  getAccountKindLabel,
  ledgerDay,
  ledgerSignedAmount,
  type AccountDeleteRef,
  type AccountEditRef,
  type AccountLedgerEntry,
  type AccountTransferRef,
  type AccountWithLedger,
} from "@/lib/accounts";
import { PaymentEditDialog } from "@/components/financial/PaymentEditDialog";
import { EditWorkerPaymentDialog } from "@/components/payroll/EditWorkerPaymentDialog";
import { EditPaidRepaymentDialog, LoanFormDialog } from "@/app/(app)/financial/loans/LoanDialogs";
import { deleteLoan, deleteRepayment } from "@/app/(app)/financial/loans/actions";
import { deleteCardCharge } from "@/lib/financial/cardChargesClient";
import { deleteAccountTransfer } from "@/lib/financial/transfersClient";
import type { Loan } from "@/lib/loans";
import { formatMoneyRounded } from "@/lib/money";
import { formatEnteredLabel, formatShortDate } from "@/lib/date";
import { scheduleDeferredAction } from "@/lib/undo-engine";

const ExpenseDialog = dynamic(
  () => import("@/components/expenses/ExpenseDialog").then((mod) => mod.ExpenseDialog),
  { loading: () => null }
);

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

// Dates go through lib/date's formatShortDate: a register day is a calendar
// day, and `new Date("2026-10-14")` read on the device's clock showed 13/10 on
// a phone set to US time.

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year.slice(-2)}`;
}

// Which register rows to show, by their "נבדק מול הבנק" tick.
type CheckFilter = "all" | "unchecked" | "checked";
// A cash box has no statement to compare with, so it has no ticks at all — no
// checkbox, count or filter (owner, 2026-10-18: "we have no way to compare the
// cash account"). Bank and card accounts keep them.
const hasBankChecks = (account: Pick<AccountWithLedger, "kind">) => account.kind !== "cash";

const CHECK_FILTERS: Array<{ value: CheckFilter; label: string }> = [
  { value: "all", label: "הכל" },
  { value: "unchecked", label: "לא נבדקו" },
  { value: "checked", label: "נבדקו" },
];

function AccountSummaryCard({
  account,
  selected,
  onSelect,
  uncheckedCount,
  showingUnchecked,
  onToggleUnchecked,
}: {
  account: AccountWithLedger;
  selected: boolean;
  onSelect: () => void;
  /** Rows on its register not yet ticked "נבדק מול הבנק". */
  uncheckedCount: number;
  /** This account is open with only its unchecked rows showing. */
  showingUnchecked: boolean;
  onToggleUnchecked: () => void;
}) {
  const kindLabel = getAccountKindLabel(account.kind);
  const hasRows = account.ledger.some((row) => row.posted);
  return (
    // The card selects the account; its "N לא נבדקו" line below opens it on
    // just the rows not yet compared with the bank, and again shows them all
    // (owner, 2026-10-18). Two buttons in one frame — a button can't hold
    // another. הכנסה / הוצאה moved onto the tab bar
    // below, where they act on the account that's actually open — one place to
    // record money instead of a pair of glyphs on every card.
    // Corner/center/bottom layout (user, 2026-08-31): name + kind badge pinned
    // to their top corners, the balance centered in the middle of the card
    // (not just left-aligned under the header row), pending amounts pinned to
    // the bottom. h-full so every card in a flex-wrap row stretches to match
    // the tallest one, and the middle flex-1 row centers within whatever
    // height that leaves.
    <div
      className={cn(
        "flex h-full w-full flex-col items-stretch rounded-lg border bg-background text-right transition-colors",
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
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex flex-1 flex-col items-stretch gap-1.5 p-3 pb-2 text-right"
      >
        <span className="flex w-full items-start justify-between gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{account.name}</span>
            {/* The bank's number for it, as set in ניהול חשבונות (owner,
                2026-10-18). */}
            {account.accountNumber && (
              <span
                dir="ltr"
                className={cn(
                  "block text-right text-[0.688rem] tabular-nums",
                  selected ? "text-primary-foreground/75" : "text-muted-foreground"
                )}
              >
                {account.accountNumber}
              </span>
            )}
          </span>
          {/* Hidden when it just repeats the name — e.g. a cash account named
              "מזומן" showing a "מזומן" kind badge says nothing a bank account's
              "בנק" badge (distinct from ITS name) actually does (2026-08-31
              design review: "the type badge is the odd one out ... Hide the
              badge when it duplicates the name"). */}
          {kindLabel.trim() !== account.name.trim() && (
            <span
              className={cn(
                "shrink-0 rounded-full border px-1.5 py-0 text-[0.588rem]",
                selected ? "border-primary-foreground/30 text-primary-foreground/80" : "text-muted-foreground"
              )}
            >
              {kindLabel}
            </span>
          )}
        </span>
        <span className="flex flex-1 items-center justify-center">
          {/* Only the sign is red/green — the figure itself stays neutral text.
              Red/green on the WHOLE number would double as this card's only
              "danger" signal, but red already means danger everywhere else in
              the app (delete, destructive badges, errors) — a negative balance
              isn't that (user, 2026-08-31: "colour is overloaded... red means
              danger everywhere else"). */}
          <span dir="ltr" className="block text-xl font-semibold tabular-nums">
            {/* Bigger than the digits — at the same size a bare "-"/"+" glyph
                is visually thin/short next to full-height digits and barely
                registers (user, 2026-08-31: "the minus and plus need to be
                bigger"). */}
            <span
              className={cn(
                "text-2xl",
                account.currentBalance < 0 ? "text-destructive" : "text-success"
              )}
            >
              {account.currentBalance < 0 ? "-" : "+"}
            </span>
            {formatMoneyRounded(Math.abs(account.currentBalance))}
          </span>
        </span>
        {/* No expected amounts here any more. An account shows what actually
            moved and where it stands now; money that is still expected lives on
            צפי תזרים, where it can be seen by day and in both directions
            (user, 2026-09-17). */}
      </button>
      {hasRows &&
        hasBankChecks(account) &&
        (uncheckedCount > 0 ? (
          <button
            type="button"
            onClick={onToggleUnchecked}
            aria-pressed={showingUnchecked}
            title={showingUnchecked ? "הצגת כל התנועות" : "הצגת התנועות שעוד לא נבדקו מול הבנק"}
            className={cn(
              "mx-2 mb-2 self-center rounded-full border px-2 py-0.5 text-[0.688rem] font-medium tabular-nums transition-colors",
              showingUnchecked
                ? cn(TOGGLE_ON, "border-secondary")
                : selected
                  ? "border-primary-foreground/30 text-primary-foreground/90 hover:bg-primary-foreground/10"
                  : "text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            )}
          >
            {uncheckedCount} לא נבדקו
          </button>
        ) : (
          <span
            className={cn(
              "mx-2 mb-2 flex items-center justify-center gap-1 py-0.5 text-[0.688rem] font-medium",
              selected ? "text-primary-foreground/90" : "text-success"
            )}
          >
            <CheckIcon className="h-3 w-3" aria-hidden="true" />
            הכל נבדק
          </span>
        ))}
    </div>
  );
}

// Last item in the account strip, not another account — the strip is
// already "all my accounts," so a total belongs at its end (design review,
// 2026-08-31: "same logic as the footer row on your properties table").
// Reached by scrolling, not shouting at you on every page load. Visually
// distinct from the plain-white/selected-navy account tiles via the
// secondary tint, and wider (w-48 vs w-36) since it holds three figures —
// net, חיובי, שלילי — not one.
function AccountTotalsCard({
  total,
  positive,
  negative,
}: {
  total: number;
  positive: number;
  negative: number;
}) {
  return (
    <div className="flex h-full w-48 shrink-0 flex-col items-stretch justify-center gap-1.5 rounded-lg border border-secondary/40 bg-secondary/5 p-3 text-right">
      <span className="text-sm font-medium text-secondary">סך נזילות</span>
      {/* Whole figure colored, like the top-bar total this restates — not
          sign-only like the account tiles, which is part of what makes this
          card read as a different KIND of thing, not just another account. */}
      <span
        dir="ltr"
        className={cn(
          "block text-xl font-semibold tabular-nums",
          total < 0 ? "text-destructive" : "text-success"
        )}
      >
        {formatMoneyRounded(total)}
      </span>
      {/* dir="ltr" on the NUMBER only, not the whole line — Hebrew text
          ("חיובי"/"שלילי") forced into an ltr context next to an ltr number
          is exactly the bidi mix that had every figure reordering itself
          differently (user, 2026-08-31: "each number is displaying in
          different directions"). Same fix already used elsewhere in this
          file for "יתרת פתיחה … <span dir=ltr>{date}</span>". */}
      <span className="flex flex-col gap-0.5 text-xs tabular-nums">
        <span className="text-success">
          חיובי <span dir="ltr">+{formatMoneyRounded(positive)}</span>
        </span>
        {/* negative is already ≤ 0, so formatMoneyRounded's own embedded
            minus sign is the "-" here — no extra one needed. */}
        <span className="text-destructive">
          שלילי <span dir="ltr">{formatMoneyRounded(negative)}</span>
        </span>
      </span>
    </div>
  );
}

export default function BankClient({
  accounts,
  loans,
  initialAccountId = "",
  projects = [],
  recurringProperties = [],
  merchantMemory = {},
  dataIncomplete = false,
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
  /** True when at least one money table failed to scan for these balances
   *  (see lib/accounts.ts's scanAccountActivity) — the figures below are
   *  understated, not just "no activity". Reported to Sentry already; this
   *  is the visible half of that same fix. */
  dataIncomplete?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const loansById = useMemo(() => new Map(loans.map((l) => [l.id, l] as const)), [loans]);
  // Total liquidity + "ניהול חשבונות" moved OUT of the page and split across
  // TWO top-bar slots, not moved together — the total stays near the back-
  // arrow/sidebar side (headerAction), the button moves near the search/
  // avatar cluster (trailingAction) (user, 2026-08-31: "leave the total
  // there and move the button to be near the icons"). Computed here (before
  // the accounts.length===0 early return below) so these hooks are always
  // called, never conditionally.
  const totalLiquidity = accounts.filter((a) => a.isActive).reduce((sum, a) => sum + a.currentBalance, 0);
  // חיובי/שלילי split for the summary card at the end of the account strip
  // (design review, 2026-08-31: "it has room for the split I keep
  // suggesting"). Positive and negative balances summed separately —
  // together with totalLiquidity above they always foot: positive + negative
  // === totalLiquidity.
  const positiveLiquidity = accounts
    .filter((a) => a.isActive && a.currentBalance > 0)
    .reduce((sum, a) => sum + a.currentBalance, 0);
  const negativeLiquidity = accounts
    .filter((a) => a.isActive && a.currentBalance < 0)
    .reduce((sum, a) => sum + a.currentBalance, 0);
  const headerAction = useMemo(
    () => (
      // mt-1.5: a little breathing room above the label — the 60px bar's
      // items-center was landing it almost flush with the top edge (user,
      // 2026-08-31: "a drop more space on top of the total and the button").
      <div className="hidden mt-1.5 text-right leading-tight sm:block">
        <div className="text-[0.588rem] text-muted-foreground">סך נזילות</div>
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
      // mt-1.5 matches the total's own nudge below the top edge. Desktop
      // only — hidden on mobile, where the top bar has no room to spare for
      // it (user, 2026-08-31: "remove the ניהול חשבונות button on mobile").
      <Button asChild variant="outline" size="sm" className="mt-1.5 hidden md:inline-flex">
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
  // The register's "נבדק מול הבנק" filter — kept when switching accounts: a
  // reconciliation goes account by account looking at what's left.
  const [checkFilter, setCheckFilter] = useState<CheckFilter>("all");

  // The account strip scrolls horizontally now (see below) — on a phone, the
  // selected card can land anywhere in it, off to one side, depending on
  // where it happens to sit in the list (user, 2026-08-31: "the selected
  // accounts card should be centered on the mobile screen"). block:"nearest"
  // (not "start"/"center") deliberately avoids the page-jumping mistake from
  // the register's own scroll-to-current-month fix — it only ever moves this
  // one horizontal scrollbar, not the page, since the strip is normally
  // already vertically in view.
  const selectedCardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    selectedCardRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selectedId]);

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
  // Tracks the sticky account/filter header's live height so every month
  // group's own header can stick right below it (not on top of it) — see the
  // month button's `style` below. Kept as ongoing state (ResizeObserver, not
  // a one-off measurement) because the header's own height changes at the md
  // breakpoint (opening balance moves in/out of it) and whenever the name or
  // month-select wraps differently (user, 2026-08-31: "when i scroll in the
  // table i need the month header to stay sticky so if i want to close it at
  // any point i could").
  const [registerHeaderHeight, setRegisterHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const el = registerHeaderRef.current;
    if (!el) return;
    const update = () => setRegisterHeaderHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
    if (!container) return;
    const target = monthNodeRefs.current.get(currentMonth);
    // This month has nothing to show (filtered out, or nothing in it): start
    // at the top rather than wherever the last account or filter left it.
    if (!target) {
      container.scrollTop = 0;
      return;
    }
    const headerHeight = registerHeaderRef.current?.offsetHeight ?? 0;
    const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += offset - headerHeight;
  }, [selectedId, currentMonth, checkFilter]);

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
  // rowId is the ledger entry's own id (see AccountLedgerEntry.id), used to hide
  // this exact row optimistically — it isn't necessarily the same string as the
  // raw account_transfers id used to actually delete it.
  const [transferToDelete, setTransferToDelete] = useState<{ id: string; label: string; rowId: string } | null>(
    null
  );

  // Ledger rows hidden during their undo grace window — a lighter, purely local
  // stand-in for useUndoOverlay: the register is a single merged view across 6+
  // source tables (payment/expense/worker_payment/loan/loan_repayment/card_charge/
  // transfer) with server-computed running balances, so there's no safe way to
  // reconstruct an EDITED row's derived label/sublabel/amount client-side — only
  // hiding a deleted row (which needs no reconstruction at all) is done here.
  const [hiddenLedgerRowIds, setHiddenLedgerRowIds] = useState<Set<string>>(new Set());

  // ── "נבדק מול הבנק" ticks (owner, 2026-10-18: "then I always know what's
  // not worked on yet"). A tick shows at once and saves in the background; it
  // moves no money, so nothing else on the page reloads. The server keeps it
  // with the row's amount and date, and an edited row comes back unticked —
  // the local copy is keyed the same way, so it can't outlive an edit either.
  const [localChecks, setLocalChecks] = useState<Map<string, boolean>>(() => new Map());
  // One save at a time per row, in click order: a quick tick-untick has to end
  // unticked, whichever request the network happens to finish first.
  const checkQueue = useRef(new Map<string, Promise<void>>());
  const localCheckKey = (accountId: string, row: AccountLedgerEntry) =>
    `${accountId}|${row.id}|${ledgerSignedAmount(row.type, row.amount)}|${row.date}`;
  const isRowChecked = (accountId: string, row: AccountLedgerEntry) =>
    localChecks.get(localCheckKey(accountId, row)) ?? row.bankChecked;
  const uncheckedCount = (account: AccountWithLedger) =>
    account.ledger.filter((row) => row.posted && !hiddenLedgerRowIds.has(row.id) && !isRowChecked(account.id, row))
      .length;

  function setRowChecked(accountId: string, row: AccountLedgerEntry, checked: boolean) {
    const key = localCheckKey(accountId, row);
    const previous = isRowChecked(accountId, row);
    setLocalChecks((prev) => new Map(prev).set(key, checked));
    const queueKey = `${accountId}|${row.id}`;
    const save = (checkQueue.current.get(queueKey) ?? Promise.resolve()).then(async () => {
      try {
        const res = await fetch("/api/accounts/ledger-checks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            entry_key: row.id,
            amount: ledgerSignedAmount(row.type, row.amount),
            date: ledgerDay(row.date),
            checked,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error || "שמירת הסימון נכשלה.");
      } catch (error: unknown) {
        setLocalChecks((prev) => new Map(prev).set(key, previous));
        toast.error(toHebrewError(error, "שמירת הסימון נכשלה."));
      }
    });
    checkQueue.current.set(queueKey, save);
  }

  // The card's "N לא נבדקו": opens that account on just those rows; on the
  // account already showing them, back to all of them.
  function toggleUncheckedFor(accountId: string) {
    const openId = accounts.some((a) => a.id === selectedId) ? selectedId : accounts[0]?.id;
    if (accountId === openId && checkFilter === "unchecked") {
      setCheckFilter("all");
      return;
    }
    if (accountId !== openId) selectAccount(accountId);
    setCheckFilter("unchecked");
  }

  function confirmDeleteTransfer() {
    if (!transferToDelete) return;
    const { id, rowId } = transferToDelete;
    setTransferToDelete(null);
    scheduleDeferredAction({
      key: `bank-row:delete:${rowId}`,
      message: "ההעברה נמחקה.",
      onApplyOptimistic: () => setHiddenLedgerRowIds((prev) => new Set(prev).add(rowId)),
      onRevert: () =>
        setHiddenLedgerRowIds((prev) => {
          const next = new Set(prev);
          next.delete(rowId);
          return next;
        }),
      onCommit: async () => {
        try {
          const result = await deleteAccountTransfer(id);
          if (!result.ok) return { ok: false, error: toHebrewError(result.error, "מחיקת ההעברה נכשלה.") };
          startTransition(() => { router.refresh(); });
          return { ok: true };
        } catch (error: unknown) {
          return { ok: false, error: toHebrewError(error, "מחיקת ההעברה נכשלה.") };
        }
      },
    });
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
  const [rowToDelete, setRowToDelete] = useState<{ ref: AccountDeleteRef; label: string; rowId: string } | null>(
    null
  );
  // One row's swipe-revealed actions open at a time, like every other swipe
  // list in this app (see ProjectMovements.tsx) — mobile-only; desktop keeps
  // the "⋮" menu (user, 2026-08-31: "put the actions in a row swipe instead
  // of 3 dots on mobile").
  const [swipedRowId, setSwipedRowId] = useState<string | null>(null);
  // An "אשראי משולם (גרואו)" Grow batch row expands in place to show every
  // payment folded into it — no separate summary card elsewhere on the page
  // (user, 2026-09-03: "the accounts page should just be the in and outs of
  // the account... all the payments that went towards grow should be listed
  // there [on the row itself]").
  const [expandedBreakdownIds, setExpandedBreakdownIds] = useState<Set<string>>(new Set());

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

  function deleteRow() {
    if (!rowToDelete) return;
    const { ref, rowId } = rowToDelete;
    setRowToDelete(null);
    scheduleDeferredAction({
      key: `bank-row:delete:${rowId}`,
      message: "הרשומה נמחקה.",
      onApplyOptimistic: () => setHiddenLedgerRowIds((prev) => new Set(prev).add(rowId)),
      onRevert: () =>
        setHiddenLedgerRowIds((prev) => {
          const next = new Set(prev);
          next.delete(rowId);
          return next;
        }),
      onCommit: async () => {
        try {
          if (ref.kind === "loan") {
            const result = await deleteLoan(ref.id);
            if (!result.ok) return { ok: false, error: result.error };
          } else if (ref.kind === "loan_repayment") {
            const result = await deleteRepayment(ref.id, ref.loanId);
            if (!result.ok) return { ok: false, error: result.error };
          } else if (ref.kind === "card_charge") {
            const result = await deleteCardCharge(ref.id);
            if (!result.ok) return { ok: false, error: toHebrewError(result.error, "המחיקה נכשלה.") };
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
                  : {
                      url: "/api/payroll/worker-payments",
                      body: { payment_id: ref.id, user_id: ref.userId || undefined },
                    };
            const res = await fetch(request.url, {
              method: ref.kind === "worker_payment" ? "DELETE" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(request.body),
            });
            const json = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) return { ok: false, error: toHebrewError(json.error, "המחיקה נכשלה.") };
          }
          startTransition(() => { router.refresh(); });
          return { ok: true };
        } catch (error: unknown) {
          return { ok: false, error: toHebrewError(error, "המחיקה נכשלה.") };
        }
      },
    });
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
  // An account's register is what actually went in and out. Expected rows (a
  // check not yet cleared, a bill not yet paid, a card settlement not yet
  // deposited) belong to צפי תזרים now — showing them here too answered the
  // same question in two places, with two different totals. Filtered here, once,
  // so the rows, the month dropdown, the monthly totals and the empty state all
  // agree. The balance was already posted-only, so it doesn't move.
  const actualLedger = selected.ledger.filter((row) => row.posted);

  // Group the selected account's ledger (already newest-first) by month, and
  // total each month so a folded header still says what happened in it.
  const allGroups: Array<{
    month: string;
    items: typeof actualLedger;
    in: number;
    out: number;
    closing: number; // balance at the end of that month
    unchecked: number; // rows not yet ticked "נבדק מול הבנק"
  }> = [];
  for (const row of actualLedger) {
    const month = row.date.slice(0, 7);
    const last = allGroups[allGroups.length - 1];
    const group =
      last && last.month === month
        ? last
        : (allGroups[
            allGroups.push({ month, items: [], in: 0, out: 0, closing: 0, unchecked: 0 }) - 1
          ] as (typeof allGroups)[number]);
    group.items.push(row);
    if (row.type === "in") group.in += row.amount;
    else group.out += row.amount;
    if (!hiddenLedgerRowIds.has(row.id) && !isRowChecked(selected.id, row)) group.unchecked += 1;
  }
  // End-of-month balance: the running balance of that month's last row. Walk
  // oldest→newest (the list is newest-first) carrying the last known figure
  // forward.
  let carriedBalance = selected.openingBalance;
  for (let i = allGroups.length - 1; i >= 0; i -= 1) {
    const group = allGroups[i];
    // Items are newest-first inside the group, so the first posted one is the
    // month's closing row.
    const lastPosted = group.items.find((row) => row.runningBalance !== null);
    if (lastPosted) carriedBalance = lastPosted.runningBalance as number;
    group.closing = carriedBalance;
  }
  // The rows the "נבדק מול הבנק" filter lets through. A month's totals and
  // closing balance stay the whole month's (the filter only picks rows), and a
  // month with no such rows drops out while filtering.
  // A cash box shows every row: it has no ticks to filter by.
  const checksOn = hasBankChecks(selected);
  const activeFilter: CheckFilter = checksOn ? checkFilter : "all";
  const showRow = (row: AccountLedgerEntry) =>
    !hiddenLedgerRowIds.has(row.id) &&
    (activeFilter === "all" || isRowChecked(selected.id, row) === (activeFilter === "checked"));
  const groups = allGroups.filter(
    (g) => (!monthFilter || g.month === monthFilter) && (activeFilter === "all" || g.items.some(showRow))
  );
  // THIS calendar month open by default, older (and any newer — a post-dated
  // check can group under next month) ones folded, until the reader says
  // otherwise. Local date parts, not UTC, so this doesn't slip a day/month
  // around midnight. Falls back to the newest group when nothing's posted yet
  // this month, so the register isn't just all-collapsed. With a month
  // filtered there's exactly one group, and it always opens.
  // (`now`/`currentMonth` are computed above, before the early return.)
  const hasCurrentMonth = groups.some((g) => g.month === currentMonth);
  // Filtered by the tick, every month that's left opens: it's a list to work
  // through, not a history to browse.
  const isMonthOpen = (month: string, index: number) =>
    openMonths[month] ?? (activeFilter !== "all" || (hasCurrentMonth ? month === currentMonth : index === 0));

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {dataIncomplete ? (
        <div className="rounded-lg border border-warning/40 bg-warning/15 px-4 py-3 text-sm text-warning-strong">
          חלק מנתוני התנועות לא נטענו כרגע — היתרות המוצגות למטה עשויות להיות
          חסרות. נשלחה התראה לצוות הפיתוח; רעננו את הדף בעוד כמה דקות.
        </div>
      ) : null}
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
          <div
            key={account.id}
            ref={account.id === selected.id ? selectedCardRef : undefined}
            className="w-36 shrink-0"
          >
            <AccountSummaryCard
              account={account}
              selected={account.id === selected.id}
              onSelect={() => selectAccount(account.id)}
              uncheckedCount={uncheckedCount(account)}
              showingUnchecked={account.id === selected.id && checkFilter === "unchecked"}
              onToggleUnchecked={() => toggleUncheckedFor(account.id)}
            />
          </div>
        ))}
        <AccountTotalsCard total={totalLiquidity} positive={positiveLiquidity} negative={negativeLiquidity} />
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
              className="sticky top-0 z-10 space-y-1 border-b bg-muted px-3 py-2"
            >
              {/* Name + month dropdown share ONE row — on mobile the dropdown
                  sits inline at the left corner, next to the name, instead of
                  wrapping to a row of its own (user, 2026-08-31: "the month
                  dropdown should move to be inline with the name of the
                  account on the left corner"). Opening balance is its own
                  line below regardless of width — it was the extra width
                  THAT was pushing the dropdown off onto its own line. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{selected.name}</div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Rows by their "נבדק מול הבנק" tick (owner, 2026-10-18). */}
                  {checksOn && actualLedger.length > 0 && (
                    <div
                      role="group"
                      aria-label="סינון לפי בדיקה מול הבנק"
                      className={cn(SEGMENTED_GROUP, "h-9 rounded-lg p-0.5 shadow-none")}
                    >
                      {CHECK_FILTERS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={checkFilter === option.value}
                          onClick={() => setCheckFilter(option.value)}
                          className={cn(
                            SEGMENT,
                            "flex items-center rounded-md px-2.5 py-0 text-xs",
                            checkFilter === option.value ? TOGGLE_ON : TOGGLE_OFF
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {allGroups.length > 0 && (
                    // No "חודש" label — the dropdown's own options (כל החודשים /
                    // a specific month) already say what it filters (user,
                    // 2026-08-31: "it's clear what the dropdown is").
                    <NativeSelect
                      dense
                      className="w-auto max-w-full"
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
                  )}
                </div>
              </div>
            </div>

            {actualLedger.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                אין תנועות משויכות לחשבון זה עדיין. תנועות יופיעו כאן ברגע שתשייך תקבולים והוצאות
                לחשבון.
              </div>
            ) : groups.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {activeFilter === "unchecked"
                  ? "כל התנועות כאן נבדקו מול הבנק."
                  : "עדיין לא סומנו כאן תנועות כנבדקות מול הבנק."}
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
                      open/account-switch.
                      Sticky (stacked right below the account/filter header,
                      via registerHeaderHeight) so the collapse toggle stays
                      reachable while scrolling through a long month instead
                      of scrolling back up to find it (user, 2026-08-31: "i
                      need the month header to stay sticky so if i want to
                      close it at any point i could"). Every month's header
                      gets this, not just the open one — stacked sticky
                      elements at the same `top` hand off from one to the
                      next as you scroll past each section, which is what
                      makes ONLY the current one visible without any JS
                      beyond the height tracking above. z-[5], under the
                      account header's z-10, so that one always wins. */}
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
                    style={{ top: registerHeaderHeight }}
                    // Solid bg-muted, not the old translucent bg-muted/30 —
                    // no backdrop-blur here (this app's own APK had ghosting
                    // on a scrolling backdrop-blur overlay before; a plain
                    // opaque fill is what actually occludes rows scrolling
                    // underneath a sticky element, blur or not).
                    className="sticky z-[5] flex w-full items-center gap-2 bg-muted px-3 py-2 text-right text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60"
                  >
                    <ChevronDownIcon
                      className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
                    />
                    <span dir="ltr" className="tabular-nums">
                      {monthLabel(group.month)}
                    </span>
                    <span className="text-muted-foreground/70">({group.items.length})</span>
                    {/* What's left to compare with the bank in this month. */}
                    {!checksOn ? null : group.unchecked > 0 ? (
                      <span className="whitespace-nowrap rounded-full bg-background px-1.5 py-px text-[0.688rem] font-medium tabular-nums text-foreground/80">
                        {group.unchecked} לא נבדקו
                      </span>
                    ) : (
                      <span className="flex items-center text-success" title="כל התנועות בחודש נבדקו מול הבנק">
                        <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">כל התנועות בחודש נבדקו מול הבנק</span>
                      </span>
                    )}
                    <span className="ms-auto flex items-center gap-2">
                      {/* Hidden on the smallest screens, not just squeezed —
                          at phone width this row was cramming chevron/month/
                          count/in/out/יתרה/closing into one line with no
                          wrap room, so the browser was breaking a figure's
                          "+"/"-" sign onto its own line above the number
                          (user, 2026-08-31: "this needs to be normalized for
                          mobile"). whitespace-nowrap on each figure is the
                          real fix for that; hiding the breakdown below sm is
                          decluttering so the row reliably fits at all. */}
                      <span dir="ltr" className="hidden items-center gap-2 tabular-nums sm:flex">
                        {group.in > 0 && (
                          <span className="whitespace-nowrap text-success">
                            +{formatMoneyRounded(group.in)}
                          </span>
                        )}
                        {group.out > 0 && (
                          <span className="whitespace-nowrap text-destructive">
                            -{formatMoneyRounded(group.out)}
                          </span>
                        )}
                      </span>
                      {/* Where the account stood when the month ended. */}
                      <span className="hidden text-muted-foreground/70 sm:inline">יתרה</span>
                      <span dir="ltr" className="whitespace-nowrap tabular-nums font-semibold text-foreground">
                        {formatMoneyRounded(group.closing)}
                      </span>
                    </span>
                  </button>
                  {open &&
                  group.items
                    .filter(showRow)
                    .map((row) => {
                    const hasBreakdown = Boolean(row.breakdown && row.breakdown.length > 0);
                    const breakdownOpen = expandedBreakdownIds.has(row.id);
                    const enteredLabel = formatEnteredLabel(row.enteredByName, row.enteredAt);
                    const inner = (
                      <>
                        {/* flex-1 so the amount (and the delete button on a
                            transfer row) stay pinned to the end of the row. */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{row.label}</span>
                            {hasBreakdown && (
                              <ChevronDownIcon
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                                  breakdownOpen && "rotate-180"
                                )}
                              />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <span dir="ltr">{formatShortDate(row.date)}</span>
                            {row.sublabel && <span> · {row.sublabel}</span>}
                          </div>
                          {/* When it was typed in, and by whom — the day above
                              is when the money moved (owner, 2026-10-15). */}
                          {enteredLabel && (
                            <div className="text-[11px] text-muted-foreground/70">{enteredLabel}</div>
                          )}
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
                    const toggleBreakdown = () =>
                      setExpandedBreakdownIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      });
                    const content = row.href ? (
                      <Link href={row.href} className="flex min-w-0 flex-1 items-center gap-3">
                        {inner}
                      </Link>
                    ) : hasBreakdown ? (
                      <button
                        type="button"
                        onClick={toggleBreakdown}
                        className="flex min-w-0 flex-1 items-center gap-3 text-right"
                      >
                        {inner}
                      </button>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-3">{inner}</div>
                    );
                    const rowLabel = `${row.label} · ${formatMoneyRounded(row.amount)}`;
                    const hasActions = Boolean(row.editRef || row.deleteRef || transfer);
                    // Same edit/delete pair either way — just two different
                    // surfaces for it (desktop "⋮" menu vs mobile swipe strip).
                    const swipeActions: SwipeAction[] = [
                      ...(row.editRef
                        ? [
                            {
                              key: "edit",
                              label: "עריכה",
                              icon: <EditIcon className="h-4 w-4" />,
                              onSelect: () => openEdit(row.editRef!),
                              className: "bg-secondary text-secondary-foreground",
                            },
                          ]
                        : transfer
                          ? [
                              {
                                key: "edit-transfer",
                                label: "עריכת העברה",
                                icon: <EditIcon className="h-4 w-4" />,
                                onSelect: () => {
                                  setTransferToEdit(transfer);
                                  setTransferOpen(true);
                                },
                                className: "bg-secondary text-secondary-foreground",
                              },
                            ]
                          : []),
                      ...(row.deleteRef
                        ? [
                            {
                              key: "delete",
                              label: "מחיקה",
                              icon: <DeleteIcon className="h-4 w-4" />,
                              onSelect: () => setRowToDelete({ ref: row.deleteRef!, label: rowLabel, rowId: row.id }),
                              className: "bg-destructive text-destructive-foreground",
                            },
                          ]
                        : transfer
                          ? [
                              {
                                key: "delete-transfer",
                                label: "מחיקת העברה",
                                icon: <DeleteIcon className="h-4 w-4" />,
                                onSelect: () => setTransferToDelete({ id: transfer.id, label: rowLabel, rowId: row.id }),
                                className: "bg-destructive text-destructive-foreground",
                              },
                            ]
                          : []),
                    ];
                    const rowChecked = isRowChecked(selected.id, row);
                    const rowContent = (
                      <div
                        data-focus-id={transfer?.id}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
                      >
                        {/* "נבדק מול הבנק": ticked once this row was found on
                            the bank statement (owner, 2026-10-18). The label
                            round it makes a finger-sized target. */}
                        {checksOn && (
                          <label
                            className="-my-1.5 -ms-1.5 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center"
                            title={rowChecked ? "נבדק מול הבנק" : "לסמן: נבדק מול הבנק"}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-secondary"
                              checked={rowChecked}
                              onChange={(e) => setRowChecked(selected.id, row, e.target.checked)}
                              aria-label={`נבדק מול הבנק: ${rowLabel}`}
                            />
                          </label>
                        )}
                        {content}
                        {/* Desktop: a single "⋮" menu instead of separate
                            edit/delete icon buttons (user, 2026-08-31) — same
                            pattern as ProjectMovements.tsx's RowActions. */}
                        {hasActions && (
                          <DropdownMenu>
                            {/* rowContent is shared by BOTH the desktop wrapper
                                and the mobile SwipeActions wrapper below — hide
                                the trigger itself on mobile so the "⋮" doesn't
                                also show up floating inside a swipe row. */}
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="hidden h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground md:inline-flex"
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
                                  onClick={() => setRowToDelete({ ref: row.deleteRef!, label: rowLabel, rowId: row.id })}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <DeleteIcon className="me-2 h-4 w-4" />
                                  מחיקה
                                </DropdownMenuItem>
                              )}
                              {transfer && (
                                <DropdownMenuItem
                                  onClick={() => setTransferToDelete({ id: transfer.id, label: rowLabel, rowId: row.id })}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <DeleteIcon className="me-2 h-4 w-4" />
                                  מחיקת העברה
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {/* A row with no actions (a "מול מזומן" cash entry, undone from its
                            statement) keeps the ⋮'s room, so its amount lines up with the rest. */}
                        {!hasActions && <span aria-hidden="true" className="hidden h-8 w-8 shrink-0 md:inline-block" />}
                      </div>
                    );
                    // Mobile: swipe the row to reveal edit/delete instead of the
                    // "⋮" menu (user, 2026-08-31: "put the actions in a row
                    // swipe instead of 3 dots on mobile") — same SwipeActions
                    // component ProjectMovements.tsx uses, one row open at a
                    // time. Two full copies of the row (one per breakpoint,
                    // toggled via `hidden`), not one row conditionally wrapped —
                    // matching ProjectMovements' own desktop-table/mobile-list
                    // split, and it keeps a desktop mouse-drag from ever
                    // reaching the swipe gesture at all.
                    return (
                      <div key={row.id}>
                        <div className="hidden md:block">{rowContent}</div>
                        <div className="md:hidden">
                          {hasActions ? (
                            <SwipeActions
                              className="rounded-none"
                              open={swipedRowId === row.id}
                              onOpenChange={(next) => setSwipedRowId(next ? row.id : null)}
                              actions={swipeActions}
                            >
                              {rowContent}
                            </SwipeActions>
                          ) : (
                            rowContent
                          )}
                        </div>
                        {/* Every payment folded into an "אשראי משולם (גרואו)"
                            Grow batch row — expanded in place instead of a
                            separate summary card elsewhere on the page. */}
                        {hasBreakdown && breakdownOpen && (
                          <div className="space-y-1 border-t bg-muted/20 px-3 py-2 ps-8">
                            {row.breakdown!.map((payment) => {
                              const paymentEntered = formatEnteredLabel(payment.enteredByName, payment.enteredAt);
                              const paymentInner = (
                                <>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm">{payment.label}</div>
                                    <div className="text-xs text-muted-foreground">
                                      <span dir="ltr">{formatShortDate(payment.date)}</span>
                                      {payment.sublabel && <span> · {payment.sublabel}</span>}
                                    </div>
                                    {paymentEntered && (
                                      <div className="text-[11px] text-muted-foreground/70">{paymentEntered}</div>
                                    )}
                                  </div>
                                  <div dir="ltr" className="shrink-0 text-sm font-medium tabular-nums text-success">
                                    +{formatMoneyRounded(payment.amount)}
                                  </div>
                                </>
                              );
                              return payment.href ? (
                                <Link
                                  key={payment.id}
                                  href={payment.href}
                                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background"
                                >
                                  {paymentInner}
                                </Link>
                              ) : (
                                <div key={payment.id} className="flex items-center gap-2 px-1.5 py-1">
                                  {paymentInner}
                                </div>
                              );
                            })}
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
          {/* Last, not first, and now on every width — this started mobile-
              only (desktop kept it up in the sticky header), then the user
              asked for the same footnote placement on desktop too
              (2026-08-31: "we moved this to the bottom row in the table on
              mobile i want to do that on desktop too"). After the
              transactions, like a footnote, instead of being the first thing
              you scroll past or permanent sticky-header real estate. */}
          <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
            יתרת פתיחה {formatMoneyRounded(selected.openingBalance)} · נכון ל-
            <span dir="ltr">{formatShortDate(selected.openingDate)}</span>
          </div>
          </div>
        </CardContent>
      </Card>


      <p className="text-xs text-muted-foreground">
        היתרה מחושבת מיתרת הפתיחה ועוד התקבולים, הלוואות שהתקבלו והחזרים שנגבו, פחות ההוצאות,
        תשלומי השכר, הלוואות שניתנו והחזרי הלוואות ששויכו לחשבון. מוצגות רק תנועות שקרו בפועל —
        צ׳קים שטרם נפרעו והוצאות שטרם שולמו נמצאים בצפי תזרים. העברה בין חשבונות מופיעה
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
        onSaved={() => startTransition(() => { router.refresh(); })}
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
        onSaved={() => startTransition(() => { router.refresh(); })}
      />

      <ConfirmDialog
        open={transferToDelete !== null}
        onOpenChange={(open) => !open && setTransferToDelete(null)}
        title="מחיקת העברה"
        description="ההעברה תימחק משני החשבונות והיתרות יחזרו למצבן הקודם."
        confirmLabel="מחיקה"
        destructive
        onConfirm={confirmDeleteTransfer}
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
          startTransition(() => { router.refresh(); });
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
          startTransition(() => { router.refresh(); });
        }}
      />

      <EditWorkerPaymentDialog
        paymentId={editingWorkerPaymentId}
        onOpenChange={(open) => {
          if (!open) setEditingWorkerPaymentId(null);
        }}
        onSaved={() => {
          setEditingWorkerPaymentId(null);
          startTransition(() => { router.refresh(); });
        }}
      />

      <ConfirmDialog
        open={rowToDelete !== null}
        onOpenChange={(open) => !open && setRowToDelete(null)}
        title="מחיקת תנועה"
        description={rowToDelete ? deleteRowLabel(rowToDelete.ref) : ""}
        confirmLabel="מחיקה"
        destructive
        onConfirm={deleteRow}
      >
        {rowToDelete ? <div className="text-sm font-medium">{rowToDelete.label}</div> : null}
      </ConfirmDialog>
    </div>
  );
}
