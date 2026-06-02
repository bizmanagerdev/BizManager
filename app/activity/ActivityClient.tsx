"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildAuditFeedItem,
  resolveUserDisplayNamesForValues,
  type AuditFeedItem,
  type AuditLogRow,
} from "@/lib/audit";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import OnlineUsersCard from "./OnlineUsersCard";

function formatRelativeTime(isoString: string | null) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "עכשיו";
  if (diffMin < 60) return `לפני ${diffMin} דק'`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `לפני ${diffHrs} שע'`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `לפני ${diffDays} ימים`;
  return date.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

function formatFullDate(isoString: string | null) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("he-IL", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function actionColor(action: string) {
  const a = action.toLowerCase();
  // Morning.co integration events (morning_customer_linked, morning_*_failed, …)
  if (a.startsWith("morning")) return "bg-warning-soft text-warning-soft-foreground";
  switch (a) {
    case "create":
    case "insert":
    case "login":
      return "bg-success-soft text-success-soft-foreground"; // green — נוצר / התחבר
    case "update":
    case "status_changed":
      return "bg-info-soft text-info-soft-foreground"; // blue — עודכן
    case "priority_changed":
      return "bg-warning-soft text-warning-soft-foreground"; // amber
    case "delete":
      return "bg-destructive-soft text-destructive-soft-foreground"; // red — נמחק
    case "upload":
      return "bg-accent text-accent-foreground";
    case "logout":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

type Props = {
  items: AuditFeedItem[];
  totalCount: number;
  page: number;
  totalPages: number;
  error: string | null;
  tableOptions: readonly { value: string; label: string }[];
  actionOptions: readonly { value: string; label: string }[];
  currentTable: string;
  currentAction: string;
};

export default function ActivityClient({
  items,
  page,
  totalPages,
  error,
  tableOptions,
  actionOptions,
  currentTable,
  currentAction,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Live feed: rows that arrived via realtime since this view mounted (newest
  // first). The parent remounts this component (via `key`) whenever the filter
  // or page changes, so this state resets cleanly — no re-sync effect needed.
  const [extraItems, setExtraItems] = useState<AuditFeedItem[]>([]);

  // Realtime: only prepend on the first page so pagination stays coherent.
  useEffect(() => {
    if (page !== 1) return;
    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel("activity-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_logs" },
        async (payload) => {
          const row = payload.new as AuditLogRow;
          if (!row?.id) return;
          // Respect the active filters.
          if (currentTable && row.table_name !== currentTable) return;
          if (currentAction && row.action !== currentAction) return;

          let actorName: string | null = null;
          if (row.changed_by) {
            const names = await resolveUserDisplayNamesForValues(supabase, [row.changed_by]);
            actorName = names[row.changed_by] ?? null;
          }
          const item = buildAuditFeedItem(row, actorName);

          setExtraItems((prev) => {
            if (prev.some((existing) => existing.id === item.id)) return prev;
            return [item, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [page, currentTable, currentAction]);

  // Merge realtime rows ahead of the server page, dropping any the server
  // already included (avoids a flash of duplicates after navigation).
  const existingIds = new Set(items.map((i) => i.id));
  const displayItems = [...extraItems.filter((i) => !existingIds.has(i.id)), ...items];
  const liveCount = displayItems.length - items.length;

  function updateParams(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(p));
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <OnlineUsersCard />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={currentTable}
            onChange={(e) => updateParams({ table: e.target.value })}
            disabled={isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {tableOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={currentAction}
            onChange={(e) => updateParams({ action: e.target.value })}
            disabled={isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {actionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-soft-foreground/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success-soft-foreground" />
            </span>
            עדכון חי
          </span>
          {liveCount > 0 && (
            <Badge variant="secondary" className="text-xs">{`${liveCount} חדש`}</Badge>
          )}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{`שגיאה בטעינת הפעילות: ${error}`}</CardContent>
        </Card>
      )}

      {!error && displayItems.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            אין פעילות להצגה
          </CardContent>
        </Card>
      )}

      {!error && displayItems.length > 0 && (
        <div className="space-y-2">
          {displayItems.map((item) => (
            <Card key={item.id} className={isPending ? "opacity-60 transition-opacity" : ""}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${actionColor(item.action)}`}
                    >
                      {item.actionLabel}
                    </span>
                    <div className="min-w-0">
                      <div>
                        <span className="text-sm font-medium">{item.entityLabel}</span>
                        <span className="text-muted-foreground text-sm"> · </span>
                        <span className="text-sm text-muted-foreground">{item.actorName}</span>
                        {item.actorRole && (
                          <Badge variant="outline" className="mr-2 text-xs py-0">
                            {item.actorRole}
                          </Badge>
                        )}
                      </div>
                      {item.details && (
                        <div className="mt-0.5 truncate text-xs text-foreground/70">{item.details}</div>
                      )}
                    </div>
                  </div>
                  <time
                    className="shrink-0 text-xs text-muted-foreground whitespace-nowrap"
                    title={formatFullDate(item.createdAt)}
                  >
                    {formatRelativeTime(item.createdAt)}
                  </time>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isPending}
            onClick={() => goToPage(page - 1)}
          >
            הקודם
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isPending}
            onClick={() => goToPage(page + 1)}
          >
            הבא
          </Button>
        </div>
      )}
    </div>
  );
}
