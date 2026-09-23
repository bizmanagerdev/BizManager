"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { SectionCard } from "@/components/ui/section-card";
import { CalendarCheckIcon } from "@/components/ui/icons";
import { meetingPeriod } from "@/lib/meetings/stats";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { cn } from "@/lib/utils";

// Opening the week's meeting. A button rather than "the page creates one when
// you look at it": a meeting is a record with a date on it, and a link
// prefetch is not a decision to hold one.

function formatDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : iso;
}

export function OpenMeetingCard({
  suggestedDate,
  suggestedNextDate,
  previousMeetingDate,
  isFirst,
}: {
  suggestedDate: string;
  suggestedNextDate: string;
  /** The last meeting's date — the period starts the morning after it. */
  previousMeetingDate: string | null;
  /** No meeting has ever been held — the copy says so instead of "the next one". */
  isFirst: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(suggestedDate);
  const [nextDate, setNextDate] = useState(suggestedNextDate);
  const [busy, setBusy] = useState(false);

  // Shown live as the date is picked, because the answer to "we skipped two
  // weeks — will it still cover them?" should be visible BEFORE the meeting is
  // opened, not discovered in the numbers afterwards.
  const period = date ? meetingPeriod(previousMeetingDate, date) : null;

  const open = async () => {
    if (!date) {
      toast.error("יש לבחור תאריך לישיבה.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/meetings/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_date: date, next_meeting_date: nextDate || null }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error || "פתיחת הישיבה נכשלה");
      toast.success("הישיבה נפתחה");
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "פתיחת הישיבה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard icon={<CalendarCheckIcon className="h-4 w-4" />} title={isFirst ? "פתיחת הישיבה הראשונה" : "פתיחת הישיבה הבאה"}>
      <p className="text-xs text-muted-foreground">
        פתיחת הישיבה יוצרת את רשימת הסעיפים, מעבירה אליה סעיפים שלא סומנו בישיבה הקודמת,
        ומקפיאה את מספרי התקופה.
      </p>
      {period ? (
        <p
          className={cn(
            "rounded-xl px-3 py-2 text-xs font-medium",
            period.days === 7 ? "bg-muted/40 text-muted-foreground" : getStatusColorClasses("info")
          )}
        >
          {period.days === 7
            ? `הישיבה תכסה את השבוע האחרון: ${formatDay(period.fromKey)} – ${formatDay(period.toKey)}`
            : `הישיבה תכסה ${period.days} ימים: ${formatDay(period.fromKey)} – ${formatDay(period.toKey)}` +
              (previousMeetingDate ? " — הכל מאז הישיבה הקודמת" : "")}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">תאריך הישיבה</span>
          <DateInput value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">תאריך הישיבה שאחריה</span>
          <DateInput value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
        </label>
      </div>
      <Button onClick={() => void open()} disabled={busy}>
        <CalendarCheckIcon />
        {busy ? "פותח..." : "פתיחת ישיבה"}
      </Button>
    </SectionCard>
  );
}

export default OpenMeetingCard;
