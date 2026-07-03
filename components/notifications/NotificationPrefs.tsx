"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NOTIF_BUCKETS } from "@/lib/notifications/categories";

// Per-user notification preferences: pause phone push + mute categories.
export default function NotificationPrefs() {
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [pushPaused, setPushPaused] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { prefs?: { muted?: string[]; push_paused?: boolean } | null } | null) => {
        if (cancelled) return;
        setMuted(new Set(d?.prefs?.muted ?? []));
        setPushPaused(d?.prefs?.push_paused === true);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(key: string) {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: { muted: [...muted], push_paused: pushPaused } }),
      });
      const d = (await res.json().catch(() => ({}))) as { synced?: boolean };
      toast[d.synced === false ? "warning" : "success"](d.synced === false ? "נשמר מקומית אך טרם סונכרן" : "ההעדפות נשמרו");
    } catch {
      toast.error("שמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="text-sm text-muted-foreground">טוען…</div>;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pushPaused} onChange={(e) => setPushPaused(e.target.checked)} />
        השהה התראות לנייד (עדיין יופיעו במרכז ההתראות)
      </label>

      <div>
        <div className="mb-1 text-xs font-semibold text-muted-foreground">השתקת סוגי התראות</div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {NOTIF_BUCKETS.map((b) => (
            <label key={b.key} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <input type="checkbox" checked={!muted.has(b.key)} onChange={() => toggle(b.key)} />
              <span className={muted.has(b.key) ? "text-muted-foreground line-through" : ""}>{b.label}</span>
            </label>
          ))}
        </div>
      </div>

      <Button size="sm" onClick={() => void save()} disabled={saving}>
        {saving ? "שומר…" : "שמור העדפות"}
      </Button>
    </div>
  );
}
