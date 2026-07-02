import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  Boxes,
  ChevronLeft,
  Clock,
  FileText,
  Flag,
  ReceiptText,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WorklistGroup, WorklistSeverity } from "@/lib/reminders/worklist";

const numberFormatter = new Intl.NumberFormat("he-IL");

// Per-group icon + reason line, keyed by the worklist rule key.
const ALERT_META: Record<string, { icon: LucideIcon; desc?: string }> = {
  task_overdue: { icon: Clock, desc: "דורשות טיפול מיידי כדי לא לפגוע בלוחות הזמנים" },
  task_due_soon: { icon: Clock, desc: "מועד היעד היום או מחר" },
  project_deadline: { icon: Flag, desc: "צפויים להסתיים תוך 3 ימי עבודה" },
  project_starting: { icon: Flag, desc: "מתחילים בימים הקרובים" },
  low_stock: { icon: Boxes, desc: "מתחת לסף ההזמנה המוגדר במלאי" },
  unprocessed_items: { icon: ReceiptText, desc: "ממתינות לסיווג ואישור בארכיון" },
  collection_overdue: { icon: Wallet, desc: "חובות שעברו את מועד התשלום וממתינים לגבייה" },
  payment_due_today: { icon: Wallet, desc: "תשלומים מתוכננים לגבייה היום" },
  check_deposit_due: { icon: Wallet, desc: "צ׳קים שהגיע מועד הפקדתם" },
  recurring_expense_confirm: { icon: ReceiptText, desc: "הוצאות קבועות שממתינות לאישור תשלום" },
  reminders: { icon: Bell, desc: "תזכורות שממתינות לטיפול" },
  unpaid_invoices: { icon: FileText, desc: "חשבוניות פתוחות שטרם נפרעו" },
  invoice_unpaid: { icon: FileText, desc: "חשבוניות פתוחות שטרם נפרעו" },
  wage_overdue: { icon: Wallet, desc: "תלושי שכר שטרם שולמו לעובדים" },
  vehicle_expiry: { icon: Users, desc: "רכבים עם טסט/ביטוח/רישוי שמתקרב או חלף" },
};

const SEVERITY: Record<WorklistSeverity, { icon: string; badge: "destructive" | "warning" | "info" }> = {
  danger: { icon: "text-destructive", badge: "destructive" },
  warning: { icon: "text-warning", badge: "warning" },
  info: { icon: "text-info", badge: "info" },
};

const SEVERITY_RANK: Record<WorklistSeverity, number> = { danger: 0, warning: 1, info: 2 };

function stripCurrency(text: string): string {
  return text.replace(/\s*\([^)]*₪[^)]*\)/g, "").replace(/[‎‏]/g, "").trim();
}

/**
 * "מרכז התראות" — a compact alerts list using the app's standard Card + Badge, so it
 * reads like the rest of the project. Each row: severity-tinted icon, title + reason,
 * a count badge, and a chevron into the relevant tab. Currency is stripped everywhere.
 */
export default function AlertCenter({ alerts }: { alerts: WorklistGroup[] }) {
  const items = alerts
    .filter((alert) => alert.count > 0)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  if (items.length === 0) return null;

  const total = items.reduce((sum, alert) => sum + alert.count, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <CardTitle className="text-lg">מרכז התראות</CardTitle>
            <Badge variant="neutral">{numberFormatter.format(total)}</Badge>
          </div>
          <Link href="/alerts" className="text-sm text-secondary hover:underline">
            לכל ההתראות ›
          </Link>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((alert) => {
          const meta = ALERT_META[alert.id] ?? { icon: AlertTriangle };
          const severity = SEVERITY[alert.severity];
          const Icon = meta.icon;
          const description = meta.desc ?? stripCurrency(alert.description);
          return (
            <Link
              key={alert.id}
              href={alert.href}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Icon className={cn("h-5 w-5 shrink-0", severity.icon)} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{alert.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{description}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={severity.badge}>{numberFormatter.format(alert.count)}</Badge>
                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
