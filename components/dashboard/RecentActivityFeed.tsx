import Link from "next/link";
import {
  Activity,
  ShoppingCart,
  ReceiptText,
  FolderKanban,
  ListChecks,
  Bell,
  LogIn,
  Users,
  Package,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import type { AuditFeedItem } from "@/lib/audit";

const ENTITY_ICON: Record<string, LucideIcon> = {
  orders: ShoppingCart,
  expenses: ReceiptText,
  payments: ReceiptText,
  projects: FolderKanban,
  tasks: ListChecks,
  reminders: Bell,
  attendance_sessions: LogIn,
  customers: Users,
  products: Package,
  documents: FileText,
  auth: LogIn,
};

function timeAgo(value: string | null): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 1) return "הרגע";
  if (diffMin < 60) return `לפני ${diffMin} דקות`;
  const diffHrs = Math.round(diffMin / 60);
  if (diffHrs < 24) return `לפני ${diffHrs} שעות`;
  const diffDays = Math.round(diffHrs / 24);
  return `לפני ${diffDays} ימים`;
}

/** "פעילות אחרונה" — the latest audited changes across the business. Back-office only. */
export default function RecentActivityFeed({ items }: { items: AuditFeedItem[] }) {
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">פעילות אחרונה</CardTitle>
          </div>
          <Link href="/activity" className="text-sm text-secondary hover:underline">
            הצג הכול ›
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.map((item) => {
          const Icon = ENTITY_ICON[item.tableName] ?? Activity;
          return (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/40"
            >
              <InitialsAvatar name={item.actorName} />
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <span className="font-medium">{item.actorName || "משתמש"}</span>{" "}
                  <span className="text-muted-foreground">{item.summary}</span>
                </div>
                {item.details ? (
                  <div className="truncate text-xs text-muted-foreground">{item.details}</div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                <span className="whitespace-nowrap">{timeAgo(item.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
