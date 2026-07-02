"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatShortDateTime } from "@/lib/date";
import { groupAuditFeedItems, type AuditFeedItem } from "@/lib/audit";

// Tables that feed the digest — a relative realtime INSERT triggers a refetch
// (the server re-applies role + since-anchor + exclude-self filtering).
const DIGEST_TABLES = new Set([
  "orders",
  "projects",
  "customers",
  "payments",
  "expenses",
  "worker_payments",
  "attendance_sessions",
  "users",
  "accounts",
]);

/**
 * "מה קרה מאז שהיית כאן" — the dismissible digest bar at the top of the dashboard
 * (admin + office). Live-updates as other users create things; dismissing marks
 * it read (advances the server anchor) so it won't show those items again.
 */
export default function MissedDigestBar({ initialItems }: { initialItems: AuditFeedItem[] }) {
  const [items, setItems] = useState<AuditFeedItem[]>(initialItems);
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groups = useMemo(() => groupAuditFeedItems(items), [items]);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/digest", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { items?: AuditFeedItem[] };
      if (res.ok && Array.isArray(json.items)) setItems(json.items);
    } catch {
      // ignore transient errors
    }
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel("dashboard-digest")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_logs" }, (payload) => {
          const row = payload.new as { table_name?: string } | null;
          if (!row?.table_name || !DIGEST_TABLES.has(row.table_name)) return;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => void refetch(), 1500);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refetch]);

  async function dismiss() {
    setDismissed(true);
    try {
      await fetch("/api/dashboard/digest/dismiss", { method: "POST" });
    } catch {
      // best-effort
    }
  }

  if (dismissed || groups.length === 0) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            מה קרה מאז שהיית כאן ({groups.length})
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={dismiss} aria-label="סימון כנקרא" title="סימון כנקרא">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ul className="space-y-1.5">
          {groups.map((g) => {
            const it = g.header;
            const inner = (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/70 px-3 py-1.5 text-sm transition-colors hover:bg-background">
                <div className="min-w-0">
                  <div className="truncate">
                    <span className="font-medium">{it.summary}</span>
                    {it.title ? <span className="text-muted-foreground"> · {it.title}</span> : null}
                    {g.children.length > 0 ? <span className="text-xs text-muted-foreground"> (+{g.children.length})</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {it.actorName}
                    {it.createdAt ? ` · ${formatShortDateTime(it.createdAt, "-")}` : ""}
                  </div>
                </div>
              </div>
            );
            return <li key={it.id}>{it.href ? <Link href={it.href}>{inner}</Link> : inner}</li>;
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
