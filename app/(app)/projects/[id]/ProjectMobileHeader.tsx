import { CalendarIcon } from "@/components/ui/icons";
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
    // No bottom margin of its own — the page stack owns the gap below, so the
    // chips sit exactly one card-gap above the first card.
    <div className="md:hidden">
      {/* flex-nowrap on both levels, badges sized down a notch: the status +
          type pair and the date chip need to share one row on a normal
          phone width — wrapping them onto two rows (chip alone, badges
          below) reads as broken, not responsive. No min-w-0 on the badge
          group: that had let the flex algorithm squeeze it narrower than its
          own (shrink-0) children, so they spilled out of their box and
          touched the date chip instead of leaving the justify-between gap. */}
      <div className="-mx-3 -mt-4 flex flex-nowrap items-center justify-between gap-2 px-3 pb-0 pt-3">
        <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
          {status ? (
            <StatusBadge
              value={status}
              type="project"
              className="shrink-0 px-2 py-0.5 text-[0.6875rem]"
            />
          ) : null}
          <Badge variant="outline" className="shrink-0 px-2 py-0.5 text-[0.6875rem]">
            {typeLabel}
          </Badge>
        </div>
        {dateRangeText ? (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            title="התחלה – סיום"
          >
            <CalendarIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span dir="ltr" className="whitespace-nowrap">
              {dateRangeText}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
