"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { DomainSelect } from "@/components/financial/DomainSelect";
import {
  DEFAULT_EXPENSE_CATEGORY,
  EXPENSE_CATEGORY_OPTIONS,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";

type Recurrence = "one_time" | "monthly";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: string; // YYYY-MM-DD
  onSaved: () => void;
};

export function PaymentDialog({ open, onOpenChange, defaultDate, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain>("general_business");
  const [category, setCategory] = useState<string>(DEFAULT_EXPENSE_CATEGORY);
  const [date, setDate] = useState(defaultDate);
  const [notes, setNotes] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("one_time");

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setPayee("");
    setBusinessDomain("general_business");
    setCategory(DEFAULT_EXPENSE_CATEGORY);
    setDate(defaultDate);
    setNotes("");
    setRecurrence("one_time");
    setError("");
  }, [open, defaultDate]);

  async function submit() {
    setError("");
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("יש להזין סכום תקין (גדול מאפס).");
      return;
    }
    if (!date) {
      setError("יש לבחור תאריך.");
      return;
    }
    if (!category.trim()) {
      setError("יש לבחור קטגוריה.");
      return;
    }
    const description = payee.trim() || null;

    setSaving(true);
    try {
      if (recurrence === "monthly") {
        const dayOfMonth = Number(date.slice(8, 10)) || 1;
        const res = await fetch("/api/recurring-expenses/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            template_name: description || category,
            category,
            amount: amountNumber,
            description_template: description,
            notes_template: notes.trim() || null,
            business_domain: businessDomain,
            frequency: "monthly",
            create_day_of_month: dayOfMonth,
            expense_day_of_month: dayOfMonth,
            start_date: date,
            is_active: true,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          const msg = toHebrewError(json.error, "שמירת התשלום החוזר נכשלה.");
          setError(msg);
          toast.error(msg);
          return;
        }
        toast.success("התשלום החוזר נשמר ויופיע בכל חודש");
        onSaved();
        return;
      }

      // One-time planned payment → an unpaid expense on the chosen day.
      const result = await offlineFetch(
        "/api/expenses/create",
        {
          business_domain: businessDomain,
          amount: amountNumber,
          category,
          expense_date: date,
          description,
          notes: notes.trim() || null,
          payment_status: "not_paid",
        },
        "תשלום מתוכנן",
        { idempotent: true }
      );
      if (result.queued) {
        toast.success("התשלום יישמר כשהחיבור יחזור");
        onSaved();
        return;
      }
      if (!result.ok) {
        const msg = toHebrewError(result.error, "הוספת התשלום נכשלה.");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("התשלום נוסף ליומן");
      onSaved();
    } catch (err) {
      const msg = toHebrewError(err, "הוספת התשלום נכשלה.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <AdaptiveDialog size="formMd">
        <DialogHeader>
          <DialogTitle>הוספת תשלום</DialogTitle>
          <DialogDescription>תשלום שצריך לצאת — יופיע ביומן עד שיסומן כשולם.</DialogDescription>
        </DialogHeader>

        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">סכום *</div>
              <CurrencyInput type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך *</div>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">למי / עבור מה</div>
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">תחום עסקי *</div>
              <DomainSelect value={businessDomain} onChange={(v) => setBusinessDomain(v as ExpenseBusinessDomain)} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">קטגוריה *</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {EXPENSE_CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Recurrence */}
          <div className="space-y-1">
            <div className="text-sm font-medium">תדירות</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "one_time" as const, label: "חד-פעמי" },
                { key: "monthly" as const, label: "חוזר חודשי" },
              ]).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setRecurrence(option.key)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                    recurrence === option.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {recurrence === "monthly" ? (
              <p className="text-xs text-muted-foreground">
                ייווצר תשלום כזה בכל חודש ביום {Number(date.slice(8, 10)) || 1} לחודש.
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">הערות</div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error ? (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {error}
            </div>
          ) : null}

          <DialogFooter className="mt-6">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              ביטול
            </Button>
            <Button type="submit" disabled={saving || amount.trim() === "" || !date}>
              {saving ? (<><Loader2 className="ml-2 h-4 w-4 animate-spin" />שומר...</>) : "שמירה"}
            </Button>
          </DialogFooter>
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}
