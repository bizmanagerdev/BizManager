"use client";

// "העברה בין חשבונות" — the one dialog for moving money between our OWN
// accounts. Three shapes of the same movement, picked with the mode control:
//
//   משיכה  — bank → cash box. Asks only WHICH BANK (the cash box is implied).
//   הפקדה  — cash box → bank. Asks only WHICH BANK.
//   העברה  — any account → any account (bank→bank, to cover a payment).
//
// The single-option rule from the account picker applies here too: when there is
// exactly one bank (or one cash box) it's filled in automatically, so משיכה
// really does come down to "how much, when".
//
// It is NOT an income and NOT an expense: nothing entered or left the business,
// so the P&L and the cash-flow report must not see it at all. It writes a single
// account_transfers row, which the accounts ledger reads as one OUT leg and one
// IN leg (see lib/accounts.ts).

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { SpinnerIcon } from "@/components/ui/icons";
import { FormDialog } from "@/components/ui/form-dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { toHebrewError } from "@/lib/error-messages";
import { getAccountKindLabel, type Account, type AccountTransferRef } from "@/lib/accounts";
import { loadAccounts as loadActiveAccounts } from "@/components/financial/AccountSelect";
import { getTodayDate } from "@/app/(app)/dashboard/DashboardActions.helpers";

/** משיכה = bank→cash, הפקדה = cash→bank, העברה = free choice on both sides. */
type TransferMode = "withdraw" | "deposit" | "between";

const MODE_LABELS: Record<TransferMode, { label: string; hint: string }> = {
  withdraw: { label: "משיכה", hint: "מהבנק למזומן" },
  deposit: { label: "הפקדה", hint: "ממזומן לבנק" },
  between: { label: "העברה", hint: "בין חשבונות" },
};

/** The only id in the list, or "" when there's nothing to auto-pick. */
function onlyId(accounts: Account[]) {
  return accounts.length === 1 ? accounts[0].id : "";
}

export function AccountTransferDialog({
  open,
  onOpenChange,
  onSaved,
  transfer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** Pass an existing transfer to edit it instead of creating a new one. */
  transfer?: AccountTransferRef | null;
}) {
  const editing = Boolean(transfer);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<TransferMode>("between");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayDate());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bankAccounts = accounts.filter((a) => a.kind === "bank");
  const cashAccounts = accounts.filter((a) => a.kind === "cash");
  // משיכה/הפקדה only mean something with both a bank and a cash box on file.
  const quickModesAvailable = bankAccounts.length > 0 && cashAccounts.length > 0;
  const modes: TransferMode[] = quickModesAvailable
    ? ["withdraw", "deposit", "between"]
    : ["between"];

  /** Set the mode and pre-fill whichever side the mode already decides. */
  function applyMode(next: TransferMode, list: Account[]) {
    const banks = list.filter((a) => a.kind === "bank");
    const cash = list.filter((a) => a.kind === "cash");
    setMode(next);
    setError(null);
    if (next === "withdraw") {
      setFromAccountId(onlyId(banks));
      setToAccountId(onlyId(cash));
    } else if (next === "deposit") {
      setFromAccountId(onlyId(cash));
      setToAccountId(onlyId(banks));
    } else {
      setFromAccountId("");
      setToAccountId("");
    }
  }

  // Fetch on every open (module-cached) so an account added meanwhile shows up.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void loadActiveAccounts().then((list) => {
      if (!active) return;
      setAccounts(list);
      if (transfer) {
        // Editing shows the stored row exactly as it is — both sides visible and
        // editable, no direction mode second-guessing what was recorded.
        setMode("between");
        setError(null);
        setFromAccountId(transfer.fromAccountId);
        setToAccountId(transfer.toAccountId);
        setAmount(String(transfer.amount));
        setDate(transfer.date);
        setNotes(transfer.notes ?? "");
      } else {
        // משיכה is the everyday case, so open on it when it's possible at all.
        const hasQuickModes =
          list.some((a) => a.kind === "bank") && list.some((a) => a.kind === "cash");
        applyMode(hasQuickModes ? "withdraw" : "between", list);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
    // transfer is read once per open — a parent re-render must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function resetForm() {
    setFromAccountId("");
    setToAccountId("");
    setAmount("");
    setDate(getTodayDate());
    setNotes("");
    setError(null);
  }

  const toOption = (account: Account) => ({
    value: account.id,
    label: account.name,
    hint: getAccountKindLabel(account.kind),
  });
  const allOptions = accounts.map(toOption);
  const bankOptions = bankAccounts.map(toOption);
  const cashOptions = cashAccounts.map(toOption);
  const notEnoughAccounts = !loading && accounts.length < 2;

  const fromAccount = accounts.find((a) => a.id === fromAccountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);

  async function save() {
    setError(null);
    if (mode === "withdraw") {
      if (!fromAccountId) return setError("יש לבחור מאיזה חשבון בנק למשוך.");
      if (!toAccountId) return setError("יש לבחור לאיזו קופת מזומן הכסף נכנס.");
    } else if (mode === "deposit") {
      if (!fromAccountId) return setError("יש לבחור מאיזו קופת מזומן הכסף יוצא.");
      if (!toAccountId) return setError("יש לבחור לאיזה חשבון בנק להפקיד.");
    } else {
      if (!fromAccountId) return setError("יש לבחור חשבון מקור.");
      if (!toAccountId) return setError("יש לבחור חשבון יעד.");
    }
    if (fromAccountId === toAccountId) return setError("לא ניתן להעביר לאותו חשבון.");
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) return setError("יש להזין סכום תקין.");
    if (!date) return setError("יש לבחור תאריך.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/financial/transfers", {
        method: transfer ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(transfer ? { id: transfer.id } : null),
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          amount: amountValue,
          transfer_date: date,
          notes: notes.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(toHebrewError(json.error, transfer ? "עדכון ההעברה נכשל." : "שמירת ההעברה נכשלה."));
        return;
      }
      onOpenChange(false);
      resetForm();
      onSaved?.();
      toast.success(
        transfer
          ? "ההעברה עודכנה."
          : mode === "withdraw"
            ? "המשיכה נרשמה."
            : mode === "deposit"
              ? "ההפקדה נרשמה."
              : "ההעברה נרשמה."
      );
    } catch (err: unknown) {
      setError(toHebrewError(err, transfer ? "עדכון ההעברה נכשל." : "שמירת ההעברה נכשלה."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
      title={editing ? "עריכת העברה" : "העברה בין חשבונות"}
      description={
        editing
          ? "עדכון ההעברה — השינוי חל על שני החשבונות יחד."
          : "משיכת מזומן, הפקדה או העברה מחשבון לחשבון. לא נרשמת כהכנסה או כהוצאה."
      }
      size="formLg"
      onSubmit={() => void save()}
      submitLabel={editing ? "שמירת שינויים" : "שמירה"}
      busyLabel="שומר..."
      busy={submitting}
      // Nothing is actionable until the accounts are in hand.
      submitDisabled={loading || notEnoughAccounts}
      error={error || undefined}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <SpinnerIcon className="h-5 w-5 animate-spin" />
          <span>טוען חשבונות...</span>
        </div>
      ) : notEnoughAccounts ? (
        <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
          <p>כדי לרשום העברה צריך לפחות שני חשבונות פעילים (למשל חשבון בנק וקופת מזומן).</p>
          <Link href="/settings" className="text-secondary underline underline-offset-4">
            להגדרת חשבונות
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {/* One control decides the direction; the fields below only ask for
              what that direction leaves open. Hidden when משיכה/הפקדה are
              impossible (no cash box or no bank account on file), and while
              editing — there the stored row is shown as-is. */}
          {modes.length > 1 && !editing ? (
            <div className="flex gap-1 rounded-lg border bg-secondary/40 p-1">
              {modes.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => applyMode(option, accounts)}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    mode === option ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="block">{MODE_LABELS[option].label}</span>
                  <span className="block text-[0.7rem] font-normal opacity-80">
                    {MODE_LABELS[option].hint}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {mode === "between" ? (
            <AdaptiveGrid variant="formTwoLoose">
              <label className="space-y-2 text-sm">
                <span>מחשבון *</span>
                <SearchableSelect
                  ariaLabel="חשבון מקור"
                  value={fromAccountId}
                  onChange={(next) => {
                    setFromAccountId(next);
                    // Same account on both sides is meaningless — drop the other side.
                    if (next && next === toAccountId) setToAccountId("");
                  }}
                  options={allOptions}
                  placeholder="בחירת חשבון"
                />
              </label>

              <label className="space-y-2 text-sm">
                <span>לחשבון *</span>
                <SearchableSelect
                  ariaLabel="חשבון יעד"
                  value={toAccountId}
                  onChange={setToAccountId}
                  options={allOptions.filter((option) => option.value !== fromAccountId)}
                  placeholder="בחירת חשבון"
                />
              </label>
            </AdaptiveGrid>
          ) : (
            <AdaptiveGrid variant="formTwoLoose">
              {/* The bank side is the question; the cash side is only asked when
                  there's more than one cash box to choose between. */}
              <label className="space-y-2 text-sm">
                <span>{mode === "withdraw" ? "מאיזה חשבון בנק *" : "לאיזה חשבון בנק *"}</span>
                <SearchableSelect
                  ariaLabel="חשבון בנק"
                  value={mode === "withdraw" ? fromAccountId : toAccountId}
                  onChange={mode === "withdraw" ? setFromAccountId : setToAccountId}
                  options={bankOptions}
                  placeholder="בחירת חשבון"
                />
              </label>

              {cashAccounts.length > 1 ? (
                <label className="space-y-2 text-sm">
                  <span>{mode === "withdraw" ? "לאיזו קופה *" : "מאיזו קופה *"}</span>
                  <SearchableSelect
                    ariaLabel="קופת מזומן"
                    value={mode === "withdraw" ? toAccountId : fromAccountId}
                    onChange={mode === "withdraw" ? setToAccountId : setFromAccountId}
                    options={cashOptions}
                    placeholder="בחירת קופה"
                  />
                </label>
              ) : null}
            </AdaptiveGrid>
          )}

          <AdaptiveGrid variant="formTwoLoose">
            <label className="space-y-2 text-sm">
              <span>סכום *</span>
              <CurrencyInput
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>

            <label className="space-y-2 text-sm">
              <span>תאריך *</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </AdaptiveGrid>

          {/* Spell the direction out — with an auto-filled side the user never
              picked, "which way does this go" has to be answerable at a glance. */}
          {fromAccount && toAccount ? (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              הכסף יוצא מ<span className="font-medium">{fromAccount.name}</span> ונכנס ל
              <span className="font-medium">{toAccount.name}</span>.
            </div>
          ) : null}

          <label className="space-y-2 text-sm">
            <span>הערה</span>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
        </div>
      )}
    </FormDialog>
  );
}

export default AccountTransferDialog;
