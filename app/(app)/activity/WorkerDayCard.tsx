"use client";

import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { ActivityIcon, CloseIcon, LoginIcon, LogoutIcon, TimerIcon } from "@/components/ui/icons";
import { israelClock } from "@/lib/activity/days";
import { formatWorkedMinutes, personHighlights, type PersonDay } from "@/lib/activity/today";
import { cn } from "@/lib/utils";
import type { PresenceRow } from "./PeopleStrip";
import { HourRibbon, useIsraelHour } from "./TodayPulse";

// "היום של דני" — one person's day, opened by tapping them in "מי עובד עכשיו":
// (worded without a gendered verb — "כניסה", not "נכנס" — since the app
// doesn't know who is a he or a she)
// when they came in and left, their work clock, what they got done, and how
// their actions spread over the day. The feed below shows only theirs.

function Step({ icon: Icon, label, time }: { icon: typeof LoginIcon; label: string; time: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1 text-xs text-foreground/80">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span>{label}</span>
      <time dir="ltr" className="font-semibold tabular-nums text-foreground">
        {time}
      </time>
    </span>
  );
}

export default function WorkerDayCard({
  person,
  day,
  roleLabel,
  onClose,
}: {
  person: PresenceRow;
  day: PersonDay | null;
  roleLabel: string | null;
  onClose: () => void;
}) {
  const nowHour = useIsraelHour();
  const highlights = day ? personHighlights(day) : [];
  const firstName = person.name.split(/\s+/)[0];
  const shift = day?.shift ?? null;

  return (
    <section className="rounded-xl border-2 border-secondary/40 bg-card p-3 shadow-sm sm:p-4" aria-label={`היום של ${person.name}`}>
      <div className="flex items-start gap-3">
        <span className="relative shrink-0">
          <InitialsAvatar name={person.name} color={person.avatarColor} colorKey={person.name} size="md" className="h-11 w-11 text-sm" />
          {person.activeNow ? (
            <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-card bg-success-soft-foreground" />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight text-foreground">{`היום של ${firstName}`}</h2>
          <p className="text-xs text-muted-foreground">
            {[person.name !== firstName ? person.name : null, roleLabel, person.activeNow ? "מחובר עכשיו" : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="חזרה לכולם"
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-input px-2.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          <CloseIcon className="h-3.5 w-3.5" />
          כולם
        </button>
      </div>

      {day && (day.actions > 0 || day.loginAt || shift) ? (
        <>
          {/* The day in order: in, the work clock, what got done, out. */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {day.loginAt ? <Step icon={LoginIcon} label="כניסה" time={israelClock(day.loginAt)} /> : null}
            {shift ? (
              <Step
                icon={TimerIcon}
                label={shift.clockOut ? "בשעון" : "בשעון מ־"}
                time={
                  shift.clockOut
                    ? `${israelClock(shift.clockIn)}–${israelClock(shift.clockOut)}`
                    : israelClock(shift.clockIn)
                }
              />
            ) : null}
            {day.firstAt ? <Step icon={ActivityIcon} label="פעולה ראשונה" time={israelClock(day.firstAt)} /> : null}
            {day.lastAt ? <Step icon={ActivityIcon} label="פעולה אחרונה" time={israelClock(day.lastAt)} /> : null}
            {day.logoutAt ? <Step icon={LogoutIcon} label="יציאה" time={israelClock(day.logoutAt)} /> : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
              {day.actions === 1 ? "פעולה אחת היום" : `${day.actions.toLocaleString("he-IL")} פעולות היום`}
            </span>
            {shift && shift.minutes > 0 ? (
              <span className="inline-flex items-center rounded-full bg-accentSky-10 px-2.5 py-1 text-xs font-medium text-accentSky-3">
                {`${formatWorkedMinutes(shift.minutes)} עבודה`}
              </span>
            ) : null}
            {highlights.map((h) => (
              <span
                key={h}
                className={cn("inline-flex items-center rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs text-foreground/85")}
              >
                {h}
              </span>
            ))}
          </div>

          {day.actions > 0 ? (
            <div className="mt-3">
              <HourRibbon hourly={day.hourly} nowHour={nowHour} size="sm" />
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{`אין עדיין פעולות של ${firstName} היום.`}</p>
      )}
    </section>
  );
}
