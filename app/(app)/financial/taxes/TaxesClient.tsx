"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import AccountSelect from "@/components/financial/AccountSelect";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { EXPENSE_TAX_CATEGORY } from "@/lib/expenses";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import type { TaxToPay } from "@/lib/financial/taxes";

function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function formatDate(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: "owed" | "in" | "out" }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        dir="ltr"
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "owed" ? "text-destructive" : tone === "in" ? "text-success" : ""
        )}
      >
        {value}
      </div>
    </div>
  );
}

export default function TaxesClient({ data }: { data: TaxToPay }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState("bank_transfer");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const ratePct = Math.round(data.vatRate * 10000) / 100;

  function openDialog() {
    // Default the amount to what's currently owed — the usual case.
    setAmount(data.owed > 0 ? String(Math.round(data.owed * 100) / 100) : "");
    setDate(todayIso());
    setMethod("bank_transfer");
    setNotes("");
    setOpen(true);
  }

  async function payTax() {
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      toast.error("יש להזין סכום תקין");
      return;
    }
    if (!date) {
      toast.error("יש לבחור תאריך");
      return;
    }
    if (accountsList.length > 0 && !accountId) {
      toast.error("יש לבחור חשבון לתנועה.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/expenses/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: "general_business",
          category: EXPENSE_TAX_CATEGORY,
          amount: amountNumber,
          expense_date: date,
          description: "תשלום מע״מ / מסים",
          notes: notes.trim() || null,
          payment_status: "paid",
          payment_method: method,
          account_id: accountId || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(toHebrewError(json?.error, "רישום תשלום המס נכשל."));
        return;
      }
      toast.success("תשלום המס נרשם");
      setOpen(false);
      router.refresh();
    } catch (e: unknown) {
      toast.error(toHebrewError(e, "רישום תשלום המס נכשל."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">מע״מ ומסים</h1>
          <p className="text-xs text-muted-foreground">מס שנגבה וטרם הועבר — לפי שיעור {ratePct}%.</p>
        </div>
        <Button type="button" onClick={openDialog}>
          רישום תשלום מס
        </Button>
      </div>

      {/* The headline: what you owe right now. */}
      <Card>
        <CardContent className="py-6 text-center">
          <div className="text-xs text-muted-foreground">לתשלום עכשיו (מע״מ על הכנסה רשמית פחות ששולם)</div>
          <div dir="ltr" className="mt-1 text-4xl font-bold tabular-nums text-destructive">
            {formatIls(data.owed)}
          </div>
        </CardContent>
      </Card>

      <AdaptiveGrid variant="customerStats">
        <StatBox label="מע״מ על מכירות (עם חשבונית)" value={formatIls(data.vatOnSales)} tone="in" />
        <StatBox label="מע״מ על פרויקטים רשמיים" value={formatIls(data.vatOnOfficial)} tone="in" />
        <StatBox label="סך מע״מ על הכנסה רשמית" value={formatIls(data.totalVat)} tone="in" />
        <StatBox label="שולם עד כה" value={formatIls(data.paid)} tone="out" />
      </AdaptiveGrid>

      <p className="text-xs text-muted-foreground">
        המע״מ מחושב על כל ההכנסה הרשמית שהוצאת לה חשבונית — גם אם הכסף עדיין לא התקבל (בסיס חשבונית,
        לא בסיס מזומן). ההכנסה עצמה נספרת במלואה ואינה מנוכה. תשלום מס נרשם כהוצאה בקטגוריית
        ״{EXPENSE_TAX_CATEGORY}״ ומקטין את הסכום לתשלום.
      </p>

      {/* Payment history */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">תשלומי מס שנרשמו</div>
          {data.payments.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">עדיין לא נרשמו תשלומי מס.</div>
          ) : (
            <div className="divide-y divide-border/60">
              {data.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.notes?.trim() || "תשלום מע״מ / מסים"}</div>
                    <div className="text-xs text-muted-foreground">
                      <span dir="ltr">{formatDate(p.date)}</span>
                    </div>
                  </div>
                  <div dir="ltr" className="shrink-0 font-semibold tabular-nums text-destructive">
                    −{formatIls(p.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pay-tax dialog */}
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>רישום תשלום מס</DialogTitle>
            <DialogDescription>
              נרשם כהוצאה בקטגוריית ״{EXPENSE_TAX_CATEGORY}״ ומקטין את הסכום לתשלום.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void payTax();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">סכום</label>
                <CurrencyInput value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך</label>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">אמצעי תשלום</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={method}
                onChange={(e) => {
                  const m = e.target.value;
                  setMethod(m);
                  setAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                }}
              >
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <AccountSelect
              required
              value={accountId}
              onChange={setAccountId}
              onLoaded={(list) => {
                setAccountsList(list);
                setAccountId((prev) => prev || defaultAccountForMethod(list, method));
              }}
            />

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <DialogFooter className="mt-2">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "שומר..." : "רישום תשלום"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
