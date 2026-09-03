"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleDeferredAction } from "@/lib/undo-engine";

/**
 * Admin switch for the global audit log (Settings → System).
 * Turning it off disables the per-table `log_changes` triggers + app-side
 * logging, so saves are faster — useful for measuring the audit overhead.
 */
export default function AuditLoggingCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);

  function toggle() {
    const previous = enabled;
    const next = !enabled;
    scheduleDeferredAction({
      key: "settings:audit-logging",
      message: next ? "תיעוד הפעולות הופעל" : "תיעוד הפעולות כובה",
      onApplyOptimistic: () => setEnabled(next),
      onRevert: () => setEnabled(previous),
      onCommit: async () => {
        const res = await fetch("/api/settings/audit-logging", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        });
        const json = (await res.json().catch(() => null)) as { enabled?: boolean; error?: string } | null;
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "עדכון מצב התיעוד נכשל.") };
        setEnabled(typeof json?.enabled === "boolean" ? json.enabled : next);
        return { ok: true };
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>תיעוד פעולות (יומן פעילות)</CardTitle>
        <CardDescription>
          המערכת מתעדת כל יצירה, עדכון ומחיקה בכל הטבלאות ליומן הפעילות. התיעוד מכפיל בקירוב את
          עלות כל שמירה. ניתן לכבות אותו זמנית כדי לבדוק את מהירות השמירה — בזמן שהוא כבוי לא יירשמו
          רשומות חדשות ביומן הפעילות.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            מצב נוכחי:{" "}
            <span className={enabled ? "font-semibold text-emerald-600" : "font-semibold text-amber-600"}>
              {enabled ? "פעיל" : "כבוי"}
            </span>
          </div>
          <Button type="button" variant={enabled ? "secondary" : "default"} onClick={toggle}>
            {enabled ? "כיבוי תיעוד" : "הפעלת תיעוד"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
