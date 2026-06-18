"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toHebrewError } from "@/lib/error-messages";

/** Shows/edits the current VAT rate as a percentage (stored as a fraction). */
export default function VatRateCard({ initialRate }: { initialRate: number }) {
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
      const res = await fetch("/api/settings/vat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Send as a fraction; the API also tolerates a percentage.
        body: JSON.stringify({ vat_rate: numeric / 100 }),
      });
      const json = (await res.json().catch(() => null)) as { vat_rate?: number; error?: string } | null;
      if (!res.ok) {
        toast.error(toHebrewError(json?.error, "שמירת שיעור המע״מ נכשלה."));
        return;
      }
      const next = typeof json?.vat_rate === "number" ? Math.round(json.vat_rate * 10000) / 100 : numeric;
      setPercent(String(next));
      setSavedPercent(String(next));
      toast.success("שיעור המע״מ עודכן");
    } catch (e: unknown) {
      toast.error(toHebrewError(e, "שמירת שיעור המע״מ נכשלה."));
    } finally {
      setSaving(false);
    }
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
            void save();
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
          <Button type="submit" disabled={invalid || saving || !dirty}>
            {saving ? "שומר..." : "שמירה"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
