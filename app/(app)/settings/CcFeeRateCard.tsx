"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toHebrewError } from "@/lib/error-messages";

/** Shows/edits the credit-card clearing company's (e.g. Grow) fee rate as a
 *  percentage (stored as a fraction) — netted out of a settlement batch on
 *  the account ledger. */
export default function CcFeeRateCard({ initialRate }: { initialRate: number }) {
  const [percent, setPercent] = useState(String(Math.round(initialRate * 10000) / 100));
  const [savedPercent, setSavedPercent] = useState(String(Math.round(initialRate * 10000) / 100));
  const [saving, setSaving] = useState(false);

  const numeric = Number(percent);
  const invalid = !percent.trim() || !Number.isFinite(numeric) || numeric < 0 || numeric > 100;
  const dirty = percent.trim() !== savedPercent.trim();

  async function save() {
    if (invalid || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/cc-fee", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Send as a fraction; the API also tolerates a percentage.
        body: JSON.stringify({ cc_fee_rate: numeric / 100 }),
      });
      const json = (await res.json().catch(() => null)) as { cc_fee_rate?: number; error?: string } | null;
      if (!res.ok) {
        toast.error(toHebrewError(json?.error, "שמירת שיעור העמלה נכשלה."));
        return;
      }
      const next = typeof json?.cc_fee_rate === "number" ? Math.round(json.cc_fee_rate * 10000) / 100 : numeric;
      setPercent(String(next));
      setSavedPercent(String(next));
      toast.success("שיעור עמלת הסליקה עודכן");
    } catch (e: unknown) {
      toast.error(toHebrewError(e, "שמירת שיעור העמלה נכשלה."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>עמלת סליקת אשראי</CardTitle>
        <CardDescription>
          השיעור שחברת הסליקה (למשל גרואו) מנכה לפני הפקדת התשלומים בחשבון. משמש לחישוב הסכום נטו
          שמוצג בחשבון עבור תשלומים שסומנו כמגיעים דרך סליקה — ההזמנה עצמה ממשיכה להירשם לפי הסכום
          המלא שהלקוח שילם.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="space-y-1">
            <label className="text-sm font-medium">שיעור עמלה (%)</label>
            <div className="flex items-center gap-1">
              <Input
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                aria-invalid={invalid}
                className={`w-28 ${invalid ? "border-destructive focus-visible:ring-destructive" : ""}`}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            {invalid ? (
              <div className="text-xs text-destructive">יש להזין מספר בין 0 ל-100.</div>
            ) : null}
          </div>
          <Button type="submit" disabled={invalid || saving || !dirty}>
            {saving ? "שומר..." : "שמירה"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
