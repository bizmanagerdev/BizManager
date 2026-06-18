"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toHebrewError } from "@/lib/error-messages";

/**
 * Admin switch for the global audit log (Settings → System).
 * Turning it off disables the per-table `log_changes` triggers + app-side
 * logging, so saves are faster — useful for measuring the audit overhead.
 */
export default function AuditLoggingCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (saving) return;
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic
    try {
      const res = await fetch("/api/settings/audit-logging", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const json = (await res.json().catch(() => null)) as { enabled?: boolean; error?: string } | null;
      if (!res.ok) {
        setEnabled(!next); // rollback
        toast.error(toHebrewError(json?.error, "עדכון מצב התיעוד נכשל."));
        return;
      }
      setEnabled(typeof json?.enabled === "boolean" ? json.enabled : next);
      toast.success(next ? "תיעוד הפעולות הופעל" : "תיעוד הפעולות כובה");
    } catch (e: unknown) {
      setEnabled(!next); // rollback
      toast.error(toHebrewError(e, "עדכון מצב התיעוד נכשל."));
    } finally {
      setSaving(false);
    }
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
          <Button
            type="button"
            variant={enabled ? "secondary" : "default"}
            onClick={() => void toggle()}
            disabled={saving}
          >
            {saving ? "מעדכן..." : enabled ? "כיבוי תיעוד" : "הפעלת תיעוד"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
