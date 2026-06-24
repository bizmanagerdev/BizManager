"use client";

import { useState } from "react";
import { toHebrewError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { getOrderStatusLabel } from "@/lib/ui/status-colors";
import { paymentStatusLabel } from "@/lib/orders/paymentStatus";

type OrderMonthlySummary = {
  month: string;
  startDate: string;
  endDate: string;
  totalOrders: number;
  byStatus: Array<{ status: string; count: number }>;
  byPayment: Array<{ status: string; count: number }>;
  totals: {
    amount: number;
    paid: number;
    outstanding: number;
    credit: number;
    overdue: number;
    needsInvoice: number;
  };
};

function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function currentMonthIso() {
  return new Date().toISOString().slice(0, 7);
}

function orderStatusLabel(status: string) {
  return status === "unknown" ? "לא ידוע" : getOrderStatusLabel(status);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

export default function OrderMonthlySummaryButton() {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(currentMonthIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<OrderMonthlySummary | null>(null);

  async function loadMonthlySummary() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/orders/monthly-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      } & Partial<OrderMonthlySummary>;
      if (!res.ok) {
        setError(toHebrewError(json.error, "טעינת הסיכום נכשלה."));
        return;
      }
      setSummary(json as OrderMonthlySummary);
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setOpen(true);
          void loadMonthlySummary();
        }}
      >
        סיכום חודשי
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>סיכום הזמנות לפי חודש</DialogTitle>
            <DialogDescription>
              הזמנות שנפתחו בחודש זה (לפי תאריך הזמנה). &quot;שולם&quot; = הכסף שנגבה על
              ההזמנות האלה, גם אם נגבה בחודש אחר. זהו דוח הזמנות — לא תזרים המזומנים החודשי.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">חודש</label>
                <Input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void loadMonthlySummary()}
                  disabled={loading}
                >
                  {loading ? "טוען..." : "הצג סיכום"}
                </Button>
              </div>
            </AdaptiveGrid>

            {error ? <div className="text-sm text-destructive">{error}</div> : null}

            {summary ? (
              <div className="space-y-4">
                <AdaptiveGrid variant="customerStats">
                  <Stat label="מספר הזמנות" value={`${summary.totalOrders}`} />
                  <Stat label='סה"כ הזמנות' value={formatIls(summary.totals.amount)} />
                  <Stat label='סה"כ שולם' value={formatIls(summary.totals.paid)} />
                  <Stat label="יתרה לגבייה" value={formatIls(summary.totals.outstanding)} />
                  {summary.totals.credit > 0.009 ? (
                    <Stat label="עודף תשלום (זכות)" value={formatIls(summary.totals.credit)} />
                  ) : null}
                  <Stat label="באיחור" value={formatIls(summary.totals.overdue)} />
                  <Stat label="ממתינות לחשבונית" value={`${summary.totals.needsInvoice}`} />
                </AdaptiveGrid>

                {summary.totals.credit > 0.009 ? (
                  <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
                    מתוך {formatIls(summary.totals.paid)} שנגבו, {formatIls(summary.totals.credit)} הם
                    עודף תשלום (נגבה יותר מסכום ההזמנה). נטו על הזמנות החודש:{" "}
                    {formatIls(summary.totals.paid - summary.totals.credit)} שולם +{" "}
                    {formatIls(summary.totals.outstanding)} יתרה = {formatIls(summary.totals.amount)}.
                    כדאי לבדוק הזמנות עם תשלום כפול.
                  </div>
                ) : null}

                <AdaptiveGrid variant="formTwo">
                  <div className="space-y-2 rounded-md border bg-background p-3">
                    <div className="text-sm font-semibold">סטטוס</div>
                    {summary.byStatus.length === 0 ? (
                      <div className="text-sm text-muted-foreground">אין נתונים לחודש הזה.</div>
                    ) : (
                      summary.byStatus.map((item) => (
                        <div
                          key={item.status}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span>{orderStatusLabel(item.status)}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-2 rounded-md border bg-background p-3">
                    <div className="text-sm font-semibold">תשלום</div>
                    {summary.byPayment.length === 0 ? (
                      <div className="text-sm text-muted-foreground">אין נתונים לחודש הזה.</div>
                    ) : (
                      summary.byPayment.map((item) => (
                        <div
                          key={item.status}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span>{paymentStatusLabel(item.status)}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </AdaptiveGrid>
              </div>
            ) : null}
          </div>
        </AdaptiveDialog>
      </Dialog>
    </>
  );
}
