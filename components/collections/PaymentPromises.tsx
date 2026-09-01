"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Badge } from "@/components/ui/badge";
import { toHebrewError } from "@/lib/error-messages";
import { formatCurrency } from "@/lib/payroll";
import { updatePaymentPromise } from "@/lib/collections/paymentPromises";
import { promiseStatusLabel, type PaymentPromise } from "@/lib/promises";

function statusTone(status: string): "success" | "destructive" | "secondary" | "warning" {
  if (status === "kept") return "success";
  if (status === "broken") return "destructive";
  if (status === "cancelled") return "secondary";
  return "warning";
}

export default function PaymentPromises({ customerId, promises }: { customerId: string; promises: PaymentPromise[] }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (busy) return;
    if (!amount || Number(amount) <= 0) {
      toast.error("יש להזין סכום.");
      return;
    }
    if (!date) {
      toast.error("יש לבחור תאריך הבטחה.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/payment-promises/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, amount: Number(amount), promised_date: date, notes: notes.trim() || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      toast.success("ההבטחה נוספה.");
      setAmount("");
      setDate("");
      setNotes("");
      router.refresh();
    } catch (err) {
      toast.error(toHebrewError(err, "שמירה נכשלה."));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "kept" | "broken" | "cancelled") {
    setBusy(true);
    try {
      const result = await updatePaymentPromise(id, { status });
      if (!result.ok) throw new Error(result.error);
      toast.success("ההבטחה עודכנה.");
      router.refresh();
    } catch (err) {
      toast.error(toHebrewError(err, "עדכון נכשל."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
        <CurrencyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="סכום" />
        <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערה (אופציונלי)" />
        <Button onClick={add} disabled={busy}>
          הוספה
        </Button>
      </div>

      {promises.length === 0 ? (
        <div className="text-sm text-muted-foreground">אין הבטחות תשלום ללקוח זה.</div>
      ) : (
        <ul className="space-y-2">
          {promises.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{formatCurrency(p.amount)}</span>
                  <span className="text-sm text-muted-foreground">עד {p.promised_date}</span>
                  <Badge variant={statusTone(p.status)}>{promiseStatusLabel(p.status)}</Badge>
                </div>
                {p.notes ? <div className="text-xs text-muted-foreground">{p.notes}</div> : null}
              </div>
              {p.status === "pending" ? (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setStatus(p.id, "kept")} disabled={busy}>
                    קוימה
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setStatus(p.id, "broken")} disabled={busy}>
                    הופרה
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setStatus(p.id, "cancelled")} disabled={busy}>
                    ביטול
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
