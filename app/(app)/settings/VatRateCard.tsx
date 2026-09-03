"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleDeferredAction } from "@/lib/undo-engine";

/** Shows/edits the current VAT rate as a percentage (stored as a fraction). */
export default function VatRateCard({ initialRate }: { initialRate: number }) {
  const [percent, setPercent] = useState(String(Math.round(initialRate * 10000) / 100));
  const [savedPercent, setSavedPercent] = useState(String(Math.round(initialRate * 10000) / 100));

  const numeric = Number(percent);
  const invalid = !percent.trim() || !Number.isFinite(numeric) || numeric < 0 || numeric > 100;
  const dirty = percent.trim() !== savedPercent.trim();

  function save() {
    if (invalid || !dirty) return;
    const previousPercent = savedPercent;
    const nextPercent = percent;
    const targetNumeric = numeric;
    scheduleDeferredAction({
      key: "settings:vat-rate",
      message: "שיעור המע״מ עודכן",
      onApplyOptimistic: () => setSavedPercent(nextPercent),
      onRevert: () => {
        setSavedPercent(previousPercent);
        setPercent(previousPercent);
      },
      onCommit: async () => {
        const res = await fetch("/api/settings/vat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Send as a fraction; the API also tolerates a percentage.
          body: JSON.stringify({ vat_rate: targetNumeric / 100 }),
        });
        const json = (await res.json().catch(() => null)) as { vat_rate?: number; error?: string } | null;
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "שמירת שיעור המע״מ נכשלה.") };
        const next = typeof json?.vat_rate === "number" ? Math.round(json.vat_rate * 10000) / 100 : targetNumeric;
        setPercent(String(next));
        setSavedPercent(String(next));
        return { ok: true };
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>שיעור מע״מ</CardTitle>
        <CardDescription>
          שיעור המע״מ הנוכחי. משמש לחישוב החלק נטו בתשלומים רשמיים על פרויקטים. שינוי השיעור משפיע
          רק על תשלומים חדשים — תשלומים קיימים שומרים את השיעור שבו נרשמו.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1">
            <label className="text-sm font-medium">שיעור (%)</label>
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
          <Button type="submit" disabled={invalid || !dirty}>
            שמירה
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
