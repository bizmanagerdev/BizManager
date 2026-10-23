"use client";

// The amount field of an entry form, in ₪, US$ or C$ (owner, 2026-10-23: "a
// ₪ / $ / C$ choice beside the amount … the rate filled in and editable"):
// the currency beside the amount — the account's own when it's kept in dollars
// — and, for dollars, the rate of the row's day with what it comes to in
// shekels, the rate open to be typed when the bank's differs.
//
// What's saved is what was typed: the amount in its currency and the rate if
// it was typed by hand. The server takes the Bank of Israel rate of the row's
// day otherwise, and works out the shekels (lib/fx/money-input.ts).

import * as React from "react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { NativeSelect } from "@/components/ui/native-select";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  CURRENCY_NAME,
  CURRENCY_SYMBOL,
  isForeignCurrency,
  readForeignMoney,
  type CurrencyCode,
  type ForeignCurrency,
} from "@/lib/fx/currencies";
import { lookupFxRate, type DayRate } from "@/lib/fx/rate-lookup";
import { rowDay } from "@/lib/fx/money-input";
import { formatShekelNote } from "@/lib/money";
import { formatShortDate } from "@/lib/date";

/** A row's currency fields as a caller hands them to an edit form. */
export type RowCurrency = {
  currency?: string | null;
  foreign_amount?: number | string | null;
  fx_rate?: number | string | null;
  fx_rate_manual?: boolean | null;
};

/** The amount to put in an edit form's field: the dollars of a row in
 *  dollars, else its shekels. */
export function typedAmountOf(row: RowCurrency | null | undefined, shekels: number | string | null | undefined): string {
  const foreign = row ? readForeignMoney(row) : null;
  if (foreign) return String(foreign.amount);
  const value = typeof shekels === "number" ? shekels : Number(shekels);
  return shekels == null || shekels === "" || !Number.isFinite(value) ? "" : String(value);
}

/** Whether a caller carried the row's currency at all — an older one didn't,
 *  and its form must then leave the row's currency as it is. */
export function knowsCurrency(row: RowCurrency | null | undefined): boolean {
  return Boolean(row && Object.prototype.hasOwnProperty.call(row, "currency"));
}

export type MoneyCurrency = {
  /** The row's currency: the account's when it's kept in dollars. */
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  /** The account's currency when it's US$ or C$ — the row has to be in it. */
  lockedTo: ForeignCurrency | null;
  /** Fixed by the form (a loan's repayment is in the loan's currency). */
  fixed: CurrencyCode | null;
  /** False on an edit whose caller didn't carry the row's currency: the
   *  field shows no choice and the save says nothing about it. */
  known: boolean;
  /** The rate in use: typed, or the Bank of Israel's of the row's day. */
  rate: number | null;
  /** The Bank of Israel rate of the day, and the day it is of. */
  dayRate: DayRate | null;
  manual: boolean;
  rateText: string;
  setRateText: (text: string) => void;
  /** Back to the Bank of Israel rate. */
  backToDayRate: () => void;
  loading: boolean;
  symbol: string;
  /** What it comes to in shekels, at the rate in use; null with no rate. */
  shekels: (amount: number) => number | null;
  /** The save request's currency fields ({} when not known). */
  body: () => Record<string, unknown>;
};

export function useMoneyCurrency({
  open,
  initial,
  known = true,
  accountCurrency,
  fixed = null,
  preferred = null,
  date,
}: {
  /** The form is open — it starts over from `initial` each time it opens. */
  open: boolean;
  /** The row being edited; read when the form opens. */
  initial?: RowCurrency | null;
  known?: boolean;
  /** The chosen account's currency. */
  accountCurrency?: CurrencyCode | null;
  /** A currency the row can't leave (a repayment: its loan's). */
  fixed?: CurrencyCode | null;
  /** What a NEW row starts in (on a Canada building's page, C$); a row being edited keeps its own. */
  preferred?: CurrencyCode | null;
  /** The row's day (the form's date field). */
  date: string | null | undefined;
}): MoneyCurrency {
  const start = React.useMemo(() => (initial ? readForeignMoney(initial) : null), [initial]);
  const startCurrency: CurrencyCode = start?.currency ?? (initial ? "ILS" : preferred ?? "ILS");
  const [chosen, setChosen] = React.useState<CurrencyCode>(startCurrency);
  const [manual, setManual] = React.useState(Boolean(start?.rateManual));
  const [rateText, setRateTextState] = React.useState(start?.rateManual ? String(start.rate) : "");
  const [dayRate, setDayRate] = React.useState<DayRate | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Starts over from the row each time the form OPENS — not on every render:
  // some callers build the row object inline, a new one each render.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setChosen(startCurrency);
      setManual(Boolean(start?.rateManual));
      setRateTextState(start?.rateManual ? String(start.rate) : "");
    }
    wasOpen.current = open;
  }, [open, start, startCurrency]);

  const lockedTo = isForeignCurrency(accountCurrency) ? accountCurrency : null;
  const currency: CurrencyCode = fixed ?? lockedTo ?? chosen;
  const day = rowDay(date);

  React.useEffect(() => {
    if (!open || !isForeignCurrency(currency)) {
      setDayRate(null);
      return;
    }
    let active = true;
    setLoading(true);
    void lookupFxRate(createSupabaseBrowserClient(), currency, day)
      .then((found) => {
        if (active) setDayRate(found);
      })
      .catch(() => {
        if (active) setDayRate(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, currency, day]);

  const typedRate = Number(rateText);
  const rate = isForeignCurrency(currency)
    ? manual
      ? Number.isFinite(typedRate) && typedRate > 0
        ? typedRate
        : null
      : dayRate?.rate ?? null
    : 1;

  return {
    currency,
    setCurrency: setChosen,
    lockedTo,
    fixed,
    known,
    rate,
    dayRate,
    manual,
    rateText,
    setRateText: (text) => {
      setManual(true);
      setRateTextState(text);
    },
    backToDayRate: () => {
      setManual(false);
      setRateTextState("");
    },
    loading,
    symbol: CURRENCY_SYMBOL[currency],
    shekels: (amount) => (rate === null || !Number.isFinite(amount) ? null : Math.round(amount * rate * 100) / 100),
    body: () => {
      if (!known) return {};
      if (!isForeignCurrency(currency)) return { currency: "ILS" };
      return manual ? { currency, fx_rate: typedRate, fx_rate_manual: true } : { currency, fx_rate_manual: false };
    },
  };
}

/** ₪ / $ / C$ beside the amount; fixed to the account's when it's in dollars. */
export function CurrencySelect({ money, disabled, className }: { money: MoneyCurrency; disabled?: boolean; className?: string }) {
  if (!money.known) return null;
  return (
    <NativeSelect
      aria-label="מטבע"
      value={money.currency}
      onChange={(event) => money.setCurrency(event.target.value as CurrencyCode)}
      disabled={disabled || Boolean(money.lockedTo) || Boolean(money.fixed)}
      title={money.lockedTo ? `החשבון מתנהל ב${CURRENCY_NAME[money.lockedTo]}` : undefined}
      className={cn("w-24 shrink-0", className)}
    >
      <option value="ILS">₪</option>
      <option value="USD">$</option>
      <option value="CAD">C$</option>
    </NativeSelect>
  );
}

/** Under a US$ or C$ amount: what it comes to in shekels, at which rate — the
 *  day's Bank of Israel rate, or one typed in its place. */
export function FxRateLine({ money, amount }: { money: MoneyCurrency; amount: number }) {
  const [editing, setEditing] = React.useState(false);
  if (!isForeignCurrency(money.currency)) return null;
  const shekels = money.shekels(Number.isFinite(amount) ? amount : 0);
  const showInput = editing || money.manual || (!money.loading && !money.dayRate);
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {money.lockedTo && !money.fixed ? <div>החשבון מתנהל ב{CURRENCY_NAME[money.lockedTo]}.</div> : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {shekels !== null && amount > 0 ? (
          <span dir="ltr" className="font-medium text-foreground">
            {formatShekelNote(shekels)}
          </span>
        ) : null}
        {money.manual ? (
          <span>שער שהוקלד</span>
        ) : money.loading ? (
          <span>מביא את השער היציג…</span>
        ) : money.dayRate ? (
          <span>
            שער יציג <span dir="ltr">{money.dayRate.rate}</span> ({formatShortDate(money.dayRate.date).slice(0, 5)})
          </span>
        ) : (
          <span className="text-destructive">אין שער יציג לתאריך הזה — יש להקליד את השער</span>
        )}
        {showInput ? (
          <input
            aria-label="שער"
            dir="ltr"
            inputMode="decimal"
            value={money.rateText}
            placeholder={money.dayRate ? String(money.dayRate.rate) : "3.1"}
            onChange={(event) => money.setRateText(event.target.value.replace(",", "."))}
            className="h-7 w-20 rounded-md border border-input bg-background px-2 text-right text-xs text-foreground"
          />
        ) : (
          <button type="button" className="text-secondary underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
            שינוי השער
          </button>
        )}
        {money.manual && money.dayRate ? (
          <button
            type="button"
            className="text-secondary underline-offset-2 hover:underline"
            onClick={() => {
              money.backToDayRate();
              setEditing(false);
            }}
          >
            לשער היציג ({money.dayRate.rate})
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The amount, its currency beside it, and the rate line under it. */
export function CurrencyAmountInput({
  money,
  containerClassName,
  ...props
}: { money: MoneyCurrency } & React.ComponentProps<typeof CurrencyInput>) {
  return (
    <div className="space-y-1">
      <div className="flex items-stretch gap-2">
        <CurrencyInput {...props} symbol={money.symbol} containerClassName={cn("min-w-0 flex-1", containerClassName)} />
        <CurrencySelect money={money} disabled={props.disabled} />
      </div>
      <FxRateLine money={money} amount={Number(props.value)} />
    </div>
  );
}
