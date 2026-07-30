import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";

// The phone-only head of a project page: what the project is, where it stands,
// and when it runs. Nothing else — the customer is the לקוח card and the money
// the תשלום card, both in the cards row below (rendered from ProjectTabsClient,
// which owns their dialogs). The project's NAME isn't repeated here either; the
// app's top bar carries it.

export default function ProjectMobileHeader({
  status,
  typeLabel,
  startDateText,
  endDateText,
}: {
  status: string;
  typeLabel: string;
  startDateText: string | null;
  endDateText: string | null;
}) {
  // "start – end", or whichever of the two the project actually has. A job that
  // starts and ends on the same day is one date, not the same date twice.
  const dateRangeText =
    startDateText && endDateText
      ? startDateText === endDateText
        ? startDateText
        : `${startDateText} – ${endDateText}`
      : startDateText ?? endDateText ?? null;

  return (
    // 24px of air below the chips: the page stack's 1.25rem (20px) + 4px.
    <div className="mb-1 md:hidden">
      <div className="-mx-4 -mt-4 flex items-center justify-between gap-2 px-4 pb-0 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {status ? <StatusBadge value={status} type="project" /> : null}
          <Badge variant="outline">{typeLabel}</Badge>
        </div>
        {dateRangeText ? (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            title="התחלה – סיום"
          >
            <CalendarDays className="h-3.9 w-3.5" aria-hidden />
            <span dir="ltr">{dateRangeText}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
