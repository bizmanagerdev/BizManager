import * as React from "react";
import { Input } from "@/components/ui/input";

type DateInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
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

function formatIsoForDisplay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1].slice(-2)}`;
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

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, onBlur, placeholder = "dd/mm/yy", inputMode = "numeric", ...props }, ref) => {
    const [displayValue, setDisplayValue] = React.useState(() => formatIsoForDisplay(value));

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
      <Input
        {...props}
        ref={ref}
        type="text"
        dir="ltr"
        inputMode={inputMode}
        placeholder={placeholder}
        value={displayValue}
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
    );
  }
);

DateInput.displayName = "DateInput";
