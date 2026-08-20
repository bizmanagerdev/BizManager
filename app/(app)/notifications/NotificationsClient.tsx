"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatShortDateTime } from "@/lib/date";
import { NOTIF_BUCKETS } from "@/lib/notifications/categories";
import { refreshNotifications, type NotificationItem } from "@/lib/ui/notifications-store";
import type { Locale } from "@/lib/i18n/types";
import { t } from "@/lib/i18n/t";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import { notificationsDict } from "@/lib/i18n/dictionaries/notifications";

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(NOTIF_BUCKETS.map((b) => [b.key, b.label]));
const CATEGORY_ORDER = NOTIF_BUCKETS.map((b) => b.key);

export default function NotificationsClient({
  initialItems,
  initialHasMore,
  locale,
}: {
  initialItems: NotificationItem[];
  initialHasMore: boolean;
  locale: Locale;
}) {
  const [items, setItems] = useState<NotificationItem[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const unread = items.filter((n) => !n.read_at).length;

  // Group the loaded history by category bucket for a scannable view.
  const groups = useMemo(() => {
    const m = new Map<string, NotificationItem[]>();
    for (const n of items) {
      const c = n.category ?? "reminders";
      const arr = m.get(c) ?? [];
      arr.push(n);
      m.set(c, arr);
    }
    return [...m.entries()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0]);
      const bi = CATEGORY_ORDER.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [items]);

  async function loadMore() {
    if (loading || items.length === 0) return;
    setLoading(true);
    try {
      const before = items[items.length - 1].created_at;
      const res = await fetch(`/api/notifications/list?before=${encodeURIComponent(before)}&limit=50`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { items?: NotificationItem[]; hasMore?: boolean };
      if (res.ok && Array.isArray(json.items)) {
        setItems((prev) => [...prev, ...json.items!]);
        setHasMore(Boolean(json.hasMore));
      }
    } finally {
      setLoading(false);
    }
  }

  async function markAllRead() {
    setBusy(true);
    const nowIso = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: nowIso })));
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      refreshNotifications();
    } finally {
      setBusy(false);
    }
  }

  function markOne(id: string) {
    const nowIso = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: nowIso } : n)));
    void fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).then(() => refreshNotifications());
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
        {t(notificationsDict, locale, "emptyState")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {unread > 0 ? t(notificationsDict, locale, "unreadCount").replace("{n}", String(unread)) : t(notificationsDict, locale, "allRead")}
        </div>
        {unread > 0 ? (
          <Button variant="outline" size="sm" onClick={() => void markAllRead()} disabled={busy}>
            {t(notificationsDict, locale, "markAllRead")}
          </Button>
        ) : null}
      </div>

      <div className="space-y-3">
        {groups.map(([category, rows]) => (
          <div key={category}>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">
              {CATEGORY_LABEL[category] ?? category} <span className="text-[10px]">({rows.length})</span>
            </div>
            <ul className="divide-y rounded-xl border">
              {rows.map((n) => {
                const isUnread = !n.read_at;
                return (
                  <li key={n.id}>
                    <Link
                      href={n.url}
                      onClick={() => isUnread && markOne(n.id)}
                      className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30 ${isUnread ? "bg-primary/5" : ""}`}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isUnread ? "bg-primary" : "bg-transparent"}`} />
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm ${isUnread ? "font-semibold" : "font-medium text-muted-foreground"}`}>{n.title}</div>
                        {n.body ? <div className="text-xs text-muted-foreground">{n.body}</div> : null}
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{formatShortDateTime(n.created_at, "-")}</div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loading}>
            {loading ? t(commonDict, locale, "loading") : t(notificationsDict, locale, "loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
