"use client";

import { useState, type SyntheticEvent } from "react";
import { ClockIcon } from "@/components/ui/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/date";
import { SNOOZE_CHOICES, israelDateAfter, israelMorning } from "@/lib/tasks/snooze";
import { t } from "@/lib/i18n/t";
import { tasksDict } from "@/lib/i18n/dictionaries/tasks";
import type { Locale } from "@/lib/i18n/types";

/**
 * "לטיפול בהמשך" — the clock beside a task's checkbox, on its card and inside
 * it (owner, 2026-10-09): put the task away until a day — tomorrow, in a week,
 * a month, two months or a date picked — and it comes back then, with a ping
 * (lib/tasks/snooze.ts). Per person: it goes away for whoever pressed it.
 * Lit up while the task is snoozed, with a way to bring it back now.
 *
 * Nothing here opens the card under it or starts a drag: the menu and the date
 * dialog live in portals, whose events still bubble to the card in React.
 */
export function TaskSnoozeButton({
  snoozedUntil,
  onSnooze,
  locale,
  className,
  iconClassName = "h-4 w-4",
}: {
  snoozedUntil: string | null;
  /** The time it comes back (an ISO instant, 08:00 Israel time on the day picked), or null: back now. */
  onSnooze: (until: string | null) => void;
  locale: Locale;
  className?: string;
  iconClassName?: string;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState("");
  // Only a snooze still ahead reaches here (the lists read those alone).
  const snoozed = Boolean(snoozedUntil);
  const label = snoozed
    ? `${t(tasksDict, locale, "snoozedUntilPrefix")}${formatShortDate(snoozedUntil)}`
    : t(tasksDict, locale, "snoozeLabel");
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  const tomorrow = israelDateAfter(1);

  return (
    <span className="contents" onClick={stop} onPointerDown={stop} onKeyDown={stop} onContextMenu={stop}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={label}
            className={cn(
              "shrink-0 transition duration-150",
              snoozed ? "text-secondary" : "text-muted-foreground hover:text-secondary",
              className
            )}
          >
            <ClockIcon className={iconClassName} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{label}</div>
          {SNOOZE_CHOICES.map((choice) => (
            <DropdownMenuItem key={choice.key} onClick={() => onSnooze(israelMorning(israelDateAfter(choice.days)))}>
              {t(tasksDict, locale, choice.key)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => {
              setPickedDate("");
              setPickOpen(true);
            }}
          >
            {t(tasksDict, locale, "snoozePickDate")}
          </DropdownMenuItem>
          {snoozed ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onSnooze(null)}>{t(tasksDict, locale, "snoozeBackNow")}</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <FormDialog
        open={pickOpen}
        onOpenChange={setPickOpen}
        title={t(tasksDict, locale, "snoozeDateTitle")}
        size="formSm"
        submitLabel={t(tasksDict, locale, "snoozeConfirm")}
        submitDisabled={!pickedDate || pickedDate < tomorrow}
        onSubmit={() => {
          if (!pickedDate || pickedDate < tomorrow) return;
          setPickOpen(false);
          onSnooze(israelMorning(pickedDate));
        }}
      >
        <DateInput value={pickedDate} onChange={(event) => setPickedDate(event.target.value)} />
      </FormDialog>
    </span>
  );
}
