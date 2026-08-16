import Link from "next/link";
import { AlarmIcon, LoginIcon, ScheduleIcon, UsersIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WorkforceOverview as WorkforceOverviewData } from "@/lib/dashboard/workforce";

const numberFormatter = new Intl.NumberFormat("he-IL");

/** "מבט על כוח האדם" — four live attendance stats. */
export default function WorkforceOverview({ data }: { data: WorkforceOverviewData }) {
  if (
    data.activeToday === 0 &&
    data.clockedInNow === 0 &&
    data.missingClockOuts === 0 &&
    data.sessionsToday === 0
  ) {
    return null;
  }

  const cards: { label: string; value: number; icon: IconComponent; urgent?: boolean; note?: string }[] = [
    { label: "עובדים פעילים היום", value: data.activeToday, icon: UsersIcon },
    { label: "במשמרת כעת", value: data.clockedInNow, icon: LoginIcon, note: "פתוחות כרגע" },
    {
      label: "דיווחי יציאה חסרים",
      value: data.missingClockOuts,
      icon: AlarmIcon,
      urgent: data.missingClockOuts > 0,
    },
    { label: "משמרות היום", value: data.sessionsToday, icon: ScheduleIcon },
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">מבט על כוח האדם</h2>
        </div>
        <Link href="/payroll" className="text-sm text-secondary hover:underline">
          לניהול שעות ›
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.label} href="/payroll" className="block">
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardContent className="p-4 text-right">
                  <div className="flex items-center justify-between">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <div className={cn("text-2xl font-bold", card.urgent ? "text-warning" : "text-foreground")}>
                      {numberFormatter.format(card.value)}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{card.label}</div>
                  {card.note ? <div className="text-xs text-muted-foreground">{card.note}</div> : null}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
