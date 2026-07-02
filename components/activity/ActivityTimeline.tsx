"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Phone } from "lucide-react";
import { toHebrewError } from "@/lib/error-messages";
import { Badge } from "@/components/ui/badge";
import { directionBadgeVariant, directionLabel } from "@/lib/communications";
import type { ActivityEntry, ActivityEntityType } from "@/lib/activity";

const TOPIC_LABEL: Record<string, string> = {
  collection: "גבייה",
  sales: "מכירה",
  service: "שירות",
  delivery: "משלוח",
  general: "כללי",
  order: "הזמנה",
  task: "משימה",
  vehicle: "רכב",
  expense: "הוצאה",
};

function fmt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

/**
 * One chronological feed of calls + reminders for any entity. `refreshKey`: bump
 * it (e.g. from a parent after logging a call) to re-fetch.
 */
export default function ActivityTimeline({
  entityType,
  entityId,
  refreshKey = 0,
}: {
  entityType: ActivityEntityType;
  entityId: string;
  refreshKey?: number;
}) {
  const [items, setItems] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/activity/entity?type=${entityType}&id=${encodeURIComponent(entityId)}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { items?: ActivityEntry[]; error?: string };
      if (!res.ok) throw new Error(json.error);
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      setError(toHebrewError(err, "טעינת הפעילות נכשלה."));
      setItems([]);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (items === null) return <div className="py-4 text-sm text-muted-foreground">טוען פעילות…</div>;
  if (error) return <div className="py-4 text-sm text-destructive">{error}</div>;
  if (items.length === 0) return <div className="py-4 text-sm text-muted-foreground">אין פעילות מתועדת עדיין.</div>;

  return (
    <ol className="space-y-2">
      {items.map((e) => {
        const Icon = e.kind === "reminder" ? Bell : Phone;
        return (
          <li key={`${e.kind}-${e.id}`} className="flex items-start gap-3 rounded-xl border border-border/60 p-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                {e.kind === "comm" && e.direction ? (
                  <Badge variant={directionBadgeVariant(e.direction)}>{directionLabel(e.direction)}</Badge>
                ) : null}
                <span className="text-sm font-medium">{e.title}</span>
                {e.topic ? <Badge variant="secondary">{TOPIC_LABEL[e.topic] ?? e.topic}</Badge> : null}
                {e.status ? <Badge variant="outline">{e.status}</Badge> : null}
              </div>
              {e.content ? <div className="text-sm text-muted-foreground">{e.content}</div> : null}
              <div className="text-xs text-muted-foreground">
                {fmt(e.at)}
                {e.actorName ? ` · ${e.actorName}` : ""}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
