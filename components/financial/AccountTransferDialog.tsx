"use client";

// "העברה בין חשבונות" — the one dialog for moving money between our OWN
// accounts. Three shapes of the same movement, picked with the mode control:
//
//   משיכה  — bank → cash box. Asks only WHICH BANK (the cash box is implied).
//   הפקדה  — cash box → bank. Asks only WHICH BANK.
//   העברה  — any account → any account (bank→bank, to cover a payment).
//
// The single-option rule from the account picker applies here too: when there is
// exactly one bank (or one cash box) it's filled in automatically and that step
// is skipped entirely, so משיכה really does come down to "how much, when".
//
// It is NOT an income and NOT an expense: nothing entered or left the business,
// so the P&L and the cash-flow report must not see it at all. It writes a single
// account_transfers row, which the accounts ledger reads as one OUT leg and one
// IN leg (see lib/accounts.ts).
//
// Rebuilt 2026-08-25 onto the same atomic step-wizard architecture as
// IncomeDialog/CollectPaymentDialog/ExpenseDialog (one question per screen,
// tap-a-card-to-advance) instead of a single-page FormDialog — part of
// converging every quick-action dialog onto one shared shape.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BankIcon, CardIcon, CashIcon, SpinnerIcon } from "@/components/ui/icons";
import { StepWizardDialog, useStepFlow } from "@/components/ui/step-wizard";
import { OptionRow, DateQuickPicks, StepHeading } from "@/components/ui/option-row";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { toHebrewError } from "@/lib/error-messages";
import { getAccountKindLabel, type Account, type AccountTransferRef } from "@/lib/accounts";
import { loadAccounts as loadActiveAccounts } from "@/components/financial/AccountSelect";
import { getTodayDate, normalizeDateOnly } from "@/app/(app)/dashboard/DashboardActions.helpers";
import { formatCurrency } from "@/lib/payroll";

/** משיכה = bank→cash, הפקדה = cash→bank, העברה = free choice on both sides. */
type TransferMode = "withdraw" | "deposit" | "between";

type TransferStepId = "mode" | "from" | "to" | "amount" | "date" | "notes" | "summary";

const STEP_LABEL: Record<TransferStepId, string> = {
  mode: "כיוון",
  from: "מחשבון",
  to: "לחשבון",
  amount: "סכום",
  date: "תאריך",
  notes: "הערות",
  summary: "סיכום",
};

const MODE_LABELS: Record<TransferMode, { label: string; hint: string }> = {
  withdraw: { label: "משיכה", hint: "מהבנק למזומן" },
  deposit: { label: "הפקדה", hint: "ממזומן לבנק" },
  between: { label: "העברה", hint: "בין חשבונות" },
};

function accountKindIcon(kind: string | null | undefined) {
  if (kind === "bank") return BankIcon;
  if (kind === "card") return CardIcon;
  return CashIcon;
}

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
  const modes: TransferMode[] = quickModesAvailable ? ["withdraw", "deposit", "between"] : ["between"];
  const notEnoughAccounts = !loading && accounts.length < 2;

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

  /** Which step a freshly-picked mode should land on — the first one that
   *  isn't already trivially resolved by `applyMode`'s auto-fill. */
  function firstStepAfterMode(next: TransferMode, list: Account[]): TransferStepId {
    if (next === "between") return "from";
    const banks = list.filter((a) => a.kind === "bank");
    const cash = list.filter((a) => a.kind === "cash");
    const fromList = next === "withdraw" ? banks : cash;
    if (fromList.length > 1) return "from";
    const toList = next === "withdraw" ? cash : banks;
    if (toList.length > 1) return "to";
    return "amount";
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
        setStepId("from");
      } else {
        // משיכה is the everyday case, so open on it when it's possible at all.
        const hasQuickModes = list.some((a) => a.kind === "bank") && list.some((a) => a.kind === "cash");
        const startMode: TransferMode = hasQuickModes ? "withdraw" : "between";
        applyMode(startMode, list);
        setStepId(hasQuickModes ? "mode" : firstStepAfterMode(startMode, list));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
    // transfer is read once per open — a parent re-render must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Dynamic step list ───────────────────────────────────────────────────
  const stepIds = useMemo<TransferStepId[]>(() => {
    const ids: TransferStepId[] = [];
    if (quickModesAvailable && !editing) ids.push("mode");
    if (editing) {
      ids.push("from", "to");
    } else if (mode === "between") {
      ids.push("from");
      const remaining = accounts.filter((a) => a.id !== fromAccountId);
      if (remaining.length > 1) ids.push("to");
    } else {
      const fromList = mode === "withdraw" ? bankAccounts : cashAccounts;
      const toList = mode === "withdraw" ? cashAccounts : bankAccounts;
      if (fromList.length > 1) ids.push("from");
      if (toList.length > 1) ids.push("to");
    }
    ids.push("amount", "date", "notes", "summary");
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickModesAvailable, editing, mode, accounts, fromAccountId, bankAccounts.length, cashAccounts.length]);
  const wizardSteps = useMemo(() => stepIds.map((id) => ({ n: id, label: STEP_LABEL[id] })), [stepIds]);

  /** The picker options for the "from"/"to" steps — which kind of account each
   *  one offers depends on the mode; "to" additionally drops whatever "from"
   *  already picked in the free-choice (`between`) mode. */
  function candidatesFor(which: "from" | "to"): Account[] {
    if (mode === "between") {
      return which === "from" ? accounts : accounts.filter((a) => a.id !== fromAccountId);
    }
    const isBankSide = (mode === "withdraw") === (which === "from");
    return isBankSide ? bankAccounts : cashAccounts;
  }

  function stepTitle(which: "from" | "to"): string {
    if (mode === "between") return which === "from" ? "מחשבון מקור" : "לאיזה חשבון יעד?";
    const isBankSide = (mode === "withdraw") === (which === "from");
    if (isBankSide) return mode === "withdraw" ? "מאיזה חשבון בנק?" : "לאיזה חשבון בנק?";
    return mode === "withdraw" ? "לאיזו קופת מזומן?" : "מאיזו קופת מזומן?";
  }

  function isSatisfied(id: TransferStepId): boolean {
    switch (id) {
      case "mode":
        return true;
      case "from":
        return Boolean(fromAccountId);
      case "to":
        return Boolean(toAccountId) && toAccountId !== fromAccountId;
      case "amount":
        return Number.isFinite(Number(amount)) && Number(amount) > 0;
      case "date":
        return Boolean(date);
      case "notes":
      case "summary":
        return true;
    }
  }

  const [stepId, setStepId] = useState<TransferStepId>("mode");
  const {
    stepIndex,
    isLastStep,
    canClickStep: canClickStepUnblocked,
    goToStep,
    goBack,
    goNext,
    advanceTo,
  } = useStepFlow<TransferStepId>({ stepId, setStepId, steps: stepIds, isSatisfied });
  // Nothing is clickable at all — not even backward — while accounts are still
  // loading or there aren't enough of them to do anything with.
  function canClickStep(id: TransferStepId) {
    if (loading || notEnoughAccounts) return false;
    return canClickStepUnblocked(id);
  }

  function pickMode(next: TransferMode) {
    applyMode(next, accounts);
    advanceTo(firstStepAfterMode(next, accounts));
  }

  function pickFrom(id: string) {
    setFromAccountId(id);
    if (mode === "between") {
      const remaining = accounts.filter((a) => a.id !== id);
      if (remaining.length === 1) {
        setToAccountId(remaining[0].id);
        advanceTo("amount");
        return;
      }
      if (toAccountId === id) setToAccountId("");
      advanceTo("to");
      return;
    }
    const toList = mode === "withdraw" ? cashAccounts : bankAccounts;
    advanceTo(toList.length > 1 ? "to" : "amount");
  }

  function resetForm() {
    setFromAccountId("");
    setToAccountId("");
    setAmount("");
    setDate(getTodayDate());
    setNotes("");
    setError(null);
    setStepId("mode");
  }

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return;
    onOpenChange(next);
    if (!next) resetForm();
  }

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
      handleOpenChange(false);
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

  const blocked = loading || notEnoughAccounts;

  return (
    <StepWizardDialog
      open={open}
      onOpenChange={handleOpenChange}
      dialogTitle={editing ? "עריכת העברה" : "העברה בין חשבונות"}
      dialogDescription={editing ? "עדכון פרטי ההעברה בין חשבונות" : "רישום העברה בין חשבונות"}
      size="formLg"
      fullScreen
      progressVariant="bar"
      steps={wizardSteps}
      current={stepId}
      canClickStep={canClickStep}
      onStepClick={goToStep}
      closeDisabled={submitting}
      onBack={!blocked && stepIndex(stepId) > 0 ? goBack : undefined}
      backDisabled={submitting}
      onNext={() => (isLastStep ? void save() : goNext())}
      nextLabel={isLastStep ? (submitting ? "שומר..." : editing ? "שמירת שינויים" : "שמירה") : undefined}
      nextDisabled={blocked || (isLastStep ? submitting : !isSatisfied(stepId))}
      isLastStep={isLastStep}
      submitOnEnter
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
      ) : stepId === "mode" ? (
        <>
          <StepHeading title="באיזה כיוון?" />
          <div className="grid gap-2">
            {modes.map((option) => (
              <OptionRow
                key={option}
                label={MODE_LABELS[option].label}
                sub={MODE_LABELS[option].hint}
                selected={mode === option}
                onClick={() => pickMode(option)}
              />
            ))}
          </div>
        </>
      ) : stepId === "from" ? (
        <>
          <StepHeading title={stepTitle("from")} />
          <div className="grid gap-2">
            {candidatesFor("from").map((a) => (
              <OptionRow
                key={a.id}
                icon={accountKindIcon(a.kind)}
                label={a.name}
                sub={getAccountKindLabel(a.kind)}
                selected={fromAccountId === a.id}
                onClick={() => pickFrom(a.id)}
              />
            ))}
          </div>
        </>
      ) : stepId === "to" ? (
        <>
          <StepHeading title={stepTitle("to")} />
          <div className="grid gap-2">
            {candidatesFor("to").map((a) => (
              <OptionRow
                key={a.id}
                icon={accountKindIcon(a.kind)}
                label={a.name}
                sub={getAccountKindLabel(a.kind)}
                selected={toAccountId === a.id}
                onClick={() => {
                  setToAccountId(a.id);
                  advanceTo("amount");
                }}
              />
            ))}
          </div>
        </>
      ) : stepId === "amount" ? (
        <>
          <StepHeading title="כמה כסף מועבר?" />
          <label className="space-y-2 text-sm">
            <CurrencyInput autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </>
      ) : stepId === "date" ? (
        <>
          <StepHeading title="מתי בוצעה ההעברה?" />
          <div>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            <DateQuickPicks
              onPick={(d) => {
                setDate(d);
                advanceTo(stepIds[stepIndex("date") + 1]);
              }}
            />
          </div>
        </>
      ) : stepId === "notes" ? (
        <>
          <StepHeading title="הערה?" sub="לא חובה" />
          <label className="space-y-2 text-sm">
            <div className="relative">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                autoFocus
                rows={2}
                className="pe-11"
              />
              <DictateButton
                onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
                className="absolute bottom-1 end-1 h-8 w-8"
              />
            </div>
          </label>
        </>
      ) : (
        <>
          <StepHeading title="לאשר ולשמור?" />
          <SummarySection title="פרטי ההעברה">
            <SummaryRow label="כיוון" value={MODE_LABELS[mode].label} />
            <SummaryRow label="מחשבון" value={fromAccount?.name ?? "—"} />
            <SummaryRow label="לחשבון" value={toAccount?.name ?? "—"} />
            <SummaryRow label="סכום" value={formatCurrency(Number(amount) || 0)} />
            <SummaryRow label="תאריך" value={normalizeDateOnly(date)} />
            {notes.trim() ? <SummaryRow label="הערה" value={notes} /> : null}
          </SummarySection>
        </>
      )}
    </StepWizardDialog>
  );
}

export default AccountTransferDialog;
