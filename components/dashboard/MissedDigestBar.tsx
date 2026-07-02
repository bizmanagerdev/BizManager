"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Sparkles, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

// Section label + display order per entity type.
const TYPE_LABEL: Record<string, string> = {
  orders: "הזמנות",
  projects: "פרויקטים",
  customers: "לקוחות",
  payments: "תשלומים",
  expenses: "הוצאות",
  attendance_sessions: "שעות עבודה",
  worker_payments: "תשלומי עובדים",
  accounts: "חשבונות",
  users: "משתמשים",
};
const TYPE_ORDER = [
  "orders",
  "projects",
  "customers",
  "payments",
  "expenses",
  "attendance_sessions",
  "worker_payments",
  "accounts",
  "users",
];

/**
 * "מה קרה מאז שהיית כאן" — a compact, type-grouped digest at the top of the
 * dashboard (admin + office). Live-updates as others create things; dismissing
 * marks it read (advances the server anchor) so those items won't return.
 */
export default function MissedDigestBar({ initialItems }: { initialItems: AuditFeedItem[] }) {
  const [items, setItems] = useState<AuditFeedItem[]>(initialItems);
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fold cascades (order + its items/payment → one row), then bucket by type.
  const typed = useMemo(() => {
    const byType = new Map<string, AuditFeedItem[]>();
    for (const g of groupAuditFeedItems(items)) {
      const t = g.header.tableName;
      const arr = byType.get(t) ?? [];
      arr.push(g.header);
      byType.set(t, arr);
    }
    return [...byType.entries()].sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a[0]);
      const bi = TYPE_ORDER.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [items]);

  const total = useMemo(() => typed.reduce((n, [, arr]) => n + arr.length, 0), [typed]);

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

  function toggle(type: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  if (dismissed || total === 0) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            מה קרה מאז שהיית כאן ({total})
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={dismiss} aria-label="סימון כנקרא" title="סימון כנקרא">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="divide-y divide-border/40">
          {typed.map(([type, rows]) => {
            const isCollapsed = collapsed.has(type);
            return (
              <div key={type} className="py-1">
                <button
                  type="button"
                  onClick={() => toggle(type)}
                  className="flex w-full items-center gap-1.5 py-0.5 text-right text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isCollapsed && "-rotate-90")} />
                  <span>{TYPE_LABEL[type] ?? type}</span>
                  <span className="rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{rows.length}</span>
                </button>

                {!isCollapsed ? (
                  <ul className="ps-5">
                    {rows.map((it) => {
                      const inner = (
                        <div className="flex items-baseline justify-between gap-2 truncate rounded px-1 py-0.5 text-sm hover:bg-background/70">
                          <span className="truncate">
                            {it.title || it.summary}
                            {it.actorName ? <span className="text-xs text-muted-foreground"> · {it.actorName}</span> : null}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {it.createdAt ? formatShortDateTime(it.createdAt, "-") : ""}
                          </span>
                        </div>
                      );
                      return <li key={it.id}>{it.href ? <Link href={it.href}>{inner}</Link> : inner}</li>;
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
