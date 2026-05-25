"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AuditFeedItem } from "@/lib/audit";

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
  switch (action) {
    case "create": return "bg-success-soft text-success-soft-foreground";
    case "delete": return "bg-destructive text-destructive-foreground";
    case "status_changed": return "bg-info-soft text-info-soft-foreground";
    case "upload": return "bg-accent text-accent-foreground";
    default: return "bg-background text-muted-foreground";
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
  totalCount,
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
      </div>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{`שגיאה בטעינת הפעילות: ${error}`}</CardContent>
        </Card>
      )}

      {!error && items.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            אין פעילות להצגה
          </CardContent>
        </Card>
      )}

      {!error && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
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
