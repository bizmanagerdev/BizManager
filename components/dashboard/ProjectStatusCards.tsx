import Link from "next/link";
import { ProjectIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProjectStatusKey } from "@/lib/dashboard/projects-overview";

const numberFormatter = new Intl.NumberFormat("he-IL");

const CARDS: { key: ProjectStatusKey; label: string; subtitle: string; color: string }[] = [
  { key: "planning", label: "תכנון", subtitle: "ממתינים לתחילת ביצוע", color: "text-secondary" },
  { key: "active", label: "פעיל", subtitle: "בביצוע כעת", color: "text-success" },
  { key: "on_hold", label: "ממתין", subtitle: "מושהים זמנית", color: "text-warning" },
  { key: "completed", label: "הושלם", subtitle: "נסגרו בהצלחה", color: "text-muted-foreground" },
];

/** Project-status breakdown — four count cards (planning / active / on_hold / completed). */
export default function ProjectStatusCards({
  statusCounts,
}: {
  statusCounts: Record<ProjectStatusKey, number>;
}) {
  if (CARDS.every((card) => statusCounts[card.key] === 0)) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ProjectIcon className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">סטטוס פרויקטים</h2>
        </div>
        <Link href="/projects" className="text-sm text-secondary hover:underline">
          כל הפרויקטים ›
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {CARDS.map((card) => (
          <Link key={card.key} href="/projects" className="block">
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardContent className="p-4 text-right">
                <div className="text-sm text-muted-foreground">{card.label}</div>
                <div className={cn("mt-1 text-2xl font-bold", card.color)}>
                  {numberFormatter.format(statusCounts[card.key])}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{card.subtitle}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
