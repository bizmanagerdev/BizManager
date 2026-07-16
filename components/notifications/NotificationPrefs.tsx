"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NOTIF_BUCKETS } from "@/lib/notifications/categories";
import {
  DEFAULT_PREFS,
  DELIVERY_MODES,
  SUBSCRIBABLE_BUCKETS,
  type DeliveryMode,
  type NotificationPrefs as Prefs,
} from "@/lib/notifications/prefs";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Per-user notification preferences: how much reaches the phone, when the daily
// summary arrives, what extra (not-mine) topics to opt into, and what to mute.
export default function NotificationPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { prefs?: Prefs } | null) => {
        if (cancelled) return;
        if (d?.prefs) setPrefs(d.prefs);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleIn(key: keyof Pick<Prefs, "muted" | "subscribe">, value: string) {
    setPrefs((p) => {
      const list = new Set(p[key]);
      if (list.has(value)) list.delete(value);
      else list.add(value);
      return { ...p, [key]: [...list] };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs }),
      });
      const d = (await res.json().catch(() => ({}))) as { synced?: boolean };
      toast[d.synced === false ? "warning" : "success"](
        d.synced === false ? "נשמר מקומית אך טרם סונכרן" : "ההעדפות נשמרו"
      );
    } catch {
      toast.error("שמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="text-sm text-muted-foreground">טוען…</div>;

  return (
    <div className="space-y-4">
      {/* How much reaches the phone */}
      <section className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground">מה יגיע לנייד?</div>
        <div className="space-y-1.5">
          {DELIVERY_MODES.map((m) => (
            <label
              key={m.key}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                prefs.delivery === m.key ? "border-primary/50 bg-primary/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="delivery"
                className="mt-1"
                checked={prefs.delivery === m.key}
                onChange={() => setPrefs((p) => ({ ...p, delivery: m.key as DeliveryMode }))}
              />
              <span className="min-w-0">
                <span className="font-medium">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          תזכורת שקבעת בעצמך עם שעה — תמיד תתריע בזמן שקבעת, בכל מצב.
        </p>
      </section>

      {/* When the summary lands */}
      {prefs.delivery !== "all" ? (
        <section className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground">שעת הסיכום היומי</div>
          <select
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            value={String(prefs.summary_hour)}
            onChange={(e) => setPrefs((p) => ({ ...p, summary_hour: Number(e.target.value) }))}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </section>
      ) : null}

      {/* Opt-in to being PUSHED about things that aren't mine. */}
      <section className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground">התראות לנייד גם על דברים שאינם שלי</div>
        <p className="text-xs text-muted-foreground">
          כברירת מחדל רק דברים ששייכים לך מתריעים לנייד. סמן נושאים שתרצה לקבל עליהם התראה בנוסף.
          בכל מקרה הכול מופיע בתיבה — הסימון משפיע רק על ההתראה לנייד.
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SUBSCRIBABLE_BUCKETS.map((b) => (
            <label key={b.key} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={prefs.subscribe.includes(b.key)}
                onChange={() => toggleIn("subscribe", b.key)}
              />
              <span>{b.label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Mute — the one control that hides things from view, not just from the phone. */}
      <section className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground">מה להציג בתיבה</div>
        <p className="text-xs text-muted-foreground">
          נושא שיוסר מהסימון ייעלם לגמרי — לא בתיבה, לא בלוח ולא בנייד.
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {NOTIF_BUCKETS.map((b) => (
            <label key={b.key} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <input type="checkbox" checked={!prefs.muted.includes(b.key)} onChange={() => toggleIn("muted", b.key)} />
              <span className={prefs.muted.includes(b.key) ? "text-muted-foreground line-through" : ""}>{b.label}</span>
            </label>
          ))}
        </div>
      </section>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={prefs.push_paused}
          onChange={(e) => setPrefs((p) => ({ ...p, push_paused: e.target.checked }))}
        />
        השהה לגמרי התראות לנייד (הכול עדיין יופיע בתיבה)
      </label>

      <Button size="sm" onClick={() => void save()} disabled={saving}>
        {saving ? "שומר…" : "שמור העדפות"}
      </Button>
    </div>
  );
}
