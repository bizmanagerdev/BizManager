"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";

type Stage = { day_offset: number; label: string; severity: string; enabled: boolean };

const SEVERITY_OPTIONS = [
  { value: "warning", label: "רגיל" },
  { value: "danger", label: "דחוף" },
  { value: "info", label: "מידע" },
];

const inputCls = "rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

// Editable dunning ladder — the staged collection-chase (day 0 / +7 / +14 …).
// Lives in the alert center; the collection_overdue rule reads these stages.
export default function DunningStagesEditor() {
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/dunning-stages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stages?: Stage[] } | null) => {
        if (!cancelled) setStages((d?.stages ?? []).map((s) => ({ day_offset: s.day_offset, label: s.label, severity: s.severity, enabled: s.enabled })));
      })
      .catch(() => setStages([]));
    return () => {
      cancelled = true;
    };
  }, []);

  function update(i: number, patch: Partial<Stage>) {
    setStages((prev) => prev?.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) ?? prev);
  }
  function remove(i: number) {
    setStages((prev) => prev?.filter((_, idx) => idx !== i) ?? prev);
  }
  function add() {
    setStages((prev) => [...(prev ?? []), { day_offset: 0, label: "", severity: "warning", enabled: true }]);
  }

  async function save() {
    if (!stages) return;
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/dunning-stages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages: [...stages].sort((a, b) => a.day_offset - b.day_offset) }),
      });
      if (!res.ok) throw new Error();
      toast.success("סולם הגבייה נשמר");
    } catch {
      toast.error("שמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  if (!stages) return <div className="text-xs text-muted-foreground">טוען…</div>;

  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="mb-1 text-xs font-semibold">סולם גבייה — מדרג תזכורות אוטומטי לפי ימי איחור</div>
      <div className="mb-2 text-[11px] text-muted-foreground">
        לכל חוב באיחור נוצרת תזכורת בשלב הנוכחי (השלב הגבוה ביותר שימי האיחור עברו אותו), עם הסלמה ככל שהחוב מזדקן.
      </div>

      <div className="space-y-1.5">
        {stages.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              יום
              <Input
                type="number"
                min={0}
                value={s.day_offset}
                onChange={(e) => update(i, { day_offset: Number(e.target.value) })}
                className={`${inputCls} w-16`}
              />
            </label>
            <Input value={s.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="שם השלב" className={`${inputCls} min-w-0 flex-1`} />
            <NativeSelect value={s.severity} onChange={(e) => update(i, { severity: e.target.value })}>
              {SEVERITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={s.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
              פעיל
            </label>
            <button type="button" onClick={() => remove(i)} className="rounded-lg border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive-soft" title="הסרה">
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={add}>
          + הוסף שלב
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "שומר…" : "שמור סולם"}
        </Button>
      </div>
    </div>
  );
}
