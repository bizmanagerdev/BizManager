"use client";
import * as React from "react";
import { CalendarIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type DateInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  value: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
};

type DateTimeInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  value: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
};

function isValidDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function padTwo(value: number) {
  return String(value).padStart(2, "0");
}

function formatIsoForDisplay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1].slice(-2)}`;
}

function formatIsoDateTimeForDisplay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1].slice(-2)} ${match[4]}:${match[5]}`;
}

function parseDisplayToIso(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return isValidDateParts(year, month, day) ? trimmed : null;
  }

  const displayMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed);
  if (!displayMatch) return null;

  const day = Number(displayMatch[1]);
  const month = Number(displayMatch[2]);
  const rawYear = displayMatch[3];
  const year =
    rawYear.length === 2
      ? Number(rawYear) >= 70
        ? 1900 + Number(rawYear)
        : 2000 + Number(rawYear)
      : Number(rawYear);

  if (!isValidDateParts(year, month, day)) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDisplayToIsoDateTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const hours = Number(isoMatch[4]);
    const minutes = Number(isoMatch[5]);
    if (!isValidDateParts(year, month, day)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return trimmed;
  }

  const displayMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})[\s,]+(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!displayMatch) return null;

  const day = Number(displayMatch[1]);
  const month = Number(displayMatch[2]);
  const rawYear = displayMatch[3];
  const hours = Number(displayMatch[4]);
  const minutes = Number(displayMatch[5]);
  const year =
    rawYear.length === 2
      ? Number(rawYear) >= 70
        ? 1900 + Number(rawYear)
        : 2000 + Number(rawYear)
      : Number(rawYear);

  if (!isValidDateParts(year, month, day)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(year).padStart(4, "0")}-${padTwo(month)}-${padTwo(day)}T${padTwo(hours)}:${padTwo(minutes)}`;
}

function openNativePicker(ref: React.RefObject<HTMLInputElement | null>) {
  const el = ref.current;
  if (!el) return;
  try {
    (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    el.click();
  }
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, onBlur, placeholder = "dd/mm/yy", className, inputMode = "numeric", ...props }, ref) => {
    const [displayValue, setDisplayValue] = React.useState(() => formatIsoForDisplay(value));
    const pickerRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
      setDisplayValue(formatIsoForDisplay(value));
    }, [value]);

    const emitChange = React.useCallback(
      (nextValue: string) => {
        if (!onChange) return;
        const event = {
          target: { value: nextValue },
          currentTarget: { value: nextValue },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(event);
      },
      [onChange]
    );

    return (
      <div className="relative flex items-center" dir="ltr">
        <Input
          {...props}
          ref={ref}
          type="text"
          dir="ltr"
          inputMode={inputMode}
          placeholder={placeholder}
          value={displayValue}
          className={cn("pr-9", className)}
          onChange={(event) => {
            const nextDisplayValue = event.target.value;
            setDisplayValue(nextDisplayValue);
            const parsed = parseDisplayToIso(nextDisplayValue);
            if (parsed !== null) {
              emitChange(parsed);
            }
          }}
          onBlur={(event) => {
            const parsed = parseDisplayToIso(displayValue);
            if (parsed === null) {
              setDisplayValue(formatIsoForDisplay(value));
            } else {
              setDisplayValue(formatIsoForDisplay(parsed));
              emitChange(parsed);
            }
            onBlur?.(event);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="בחר תאריך"
          onClick={() => openNativePicker(pickerRef)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
        {/* Hidden native date picker — triggered by the calendar icon. lang="he"
            makes Chromium render the picker's month/day names in Hebrew instead
            of falling back to the browser's UI language. */}
        <input
          ref={pickerRef}
          type="date"
          lang="he"
          value={value}
          onChange={(event) => {
            const iso = event.target.value;
            if (iso) {
              setDisplayValue(formatIsoForDisplay(iso));
              emitChange(iso);
            }
          }}
          tabIndex={-1}
          aria-hidden="true"
          className="absolute right-2.5 bottom-0 opacity-0 pointer-events-none w-0 h-0"
        />
      </div>
    );
  }
);

DateInput.displayName = "DateInput";

export const DateTimeInput = React.forwardRef<HTMLInputElement, DateTimeInputProps>(
  ({ value, onChange, onBlur, placeholder = "dd/mm/yy hh:mm", className, inputMode = "text", ...props }, ref) => {
    const [displayValue, setDisplayValue] = React.useState(() => formatIsoDateTimeForDisplay(value));
    const pickerRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
      setDisplayValue(formatIsoDateTimeForDisplay(value));
    }, [value]);

    const emitChange = React.useCallback(
      (nextValue: string) => {
        if (!onChange) return;
        const event = {
          target: { value: nextValue },
          currentTarget: { value: nextValue },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(event);
      },
      [onChange]
    );

    return (
      <div className="relative flex items-center" dir="ltr">
        <Input
          {...props}
          ref={ref}
          type="text"
          dir="ltr"
          inputMode={inputMode}
          placeholder={placeholder}
          value={displayValue}
          className={cn("pr-9", className)}
          onChange={(event) => {
            const next = event.target.value;
            setDisplayValue(next);
            const parsed = parseDisplayToIsoDateTime(next);
            if (parsed !== null) emitChange(parsed);
          }}
          onBlur={(event) => {
            const parsed = parseDisplayToIsoDateTime(displayValue);
            if (parsed === null) {
              setDisplayValue(formatIsoDateTimeForDisplay(value));
            } else {
              setDisplayValue(formatIsoDateTimeForDisplay(parsed));
              emitChange(parsed);
            }
            onBlur?.(event);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="בחר תאריך ושעה"
          onClick={() => openNativePicker(pickerRef)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
        <input
          ref={pickerRef}
          type="datetime-local"
          lang="he"
          value={value}
          onChange={(event) => {
            const iso = event.target.value;
            if (iso) {
              setDisplayValue(formatIsoDateTimeForDisplay(iso));
              emitChange(iso);
            }
          }}
          tabIndex={-1}
          aria-hidden="true"
          className="absolute right-2.5 bottom-0 opacity-0 pointer-events-none w-0 h-0"
        />
      </div>
    );
  }
);

DateTimeInput.displayName = "DateTimeInput";
