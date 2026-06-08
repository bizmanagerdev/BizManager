import Link from "next/link";
import { Wallet, CalendarClock, HandCoins, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const numberFormatter = new Intl.NumberFormat("he-IL");

type FinanceStat = {
  label: string;
  value: number;
  href: string;
  icon: LucideIcon;
  urgent?: boolean;
};

/**
 * Slim, ₪-free finance heads-up: open collections, payments due today, and (admin
 * only) workers owed — counts only, per the dashboard finance-discretion rule.
 * Pass `payrollOwed = null` to hide the payroll stat for non-admins.
 */
export default function CompactFinanceStrip({
  openCollections,
  dueToday,
  payrollOwed,
}: {
  openCollections: number;
  dueToday: number;
  payrollOwed: number | null;
}) {
  const stats: FinanceStat[] = [
    { label: "גבייה פתוחה", value: openCollections, href: "/collections", icon: Wallet },
    {
      label: "לפירעון היום",
      value: dueToday,
      href: "/collections",
      icon: CalendarClock,
      urgent: dueToday > 0,
    },
  ];
  if (payrollOwed !== null) {
    stats.push({
      label: "שכר לתשלום",
      value: payrollOwed,
      href: "/payroll",
      icon: HandCoins,
      urgent: payrollOwed > 0,
    });
  }

  // Only surface what actually needs attention — hide zero stats, and the whole
  // strip when nothing is pending (no misleading "0 / 0 / 0").
  const visibleStats = stats.filter((stat) => stat.value > 0);
  if (visibleStats.length === 0) return null;

  return (
    <Card>
      <CardContent className="flex flex-wrap gap-3 p-3">
        {visibleStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="flex flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-muted/40 min-w-[180px]"
            >
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4" />
                {stat.label}
              </span>
              <span className={cn("text-lg font-bold", stat.urgent ? "text-destructive" : "text-foreground")}>
                {numberFormatter.format(stat.value)}
              </span>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
