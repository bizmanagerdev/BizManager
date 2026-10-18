"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CloseIcon, EditIcon, LocationIcon, SearchIcon, SpinnerIcon, WarningIcon } from "@/components/ui/icons";
import {
  addressLine,
  isFullAddress,
  type StructuredAddress,
} from "@/lib/address/structured";
import type { AddressSuggestion } from "@/lib/places/google";
import { cn } from "@/lib/utils";

/**
 * THE address field, on every screen that takes an address (owner,
 * 2026-10-16: "like Amazon … you start typing in an address and you have to
 * click a real address … from a list"). Typing asks Google, through BizH's
 * server (/api/places/*), and only a picked suggestion is saved — with its
 * city, street, house number and map point apart (lib/address/structured.ts).
 *
 * - A street with no number ("חזון איש, רחובות") asks for the house number,
 *   then looks the full address up again for its exact point.
 * - A settlement on its own ("מושב אלומה") is allowed, marked as not full.
 * - "דירה / כניסה" is typed by hand beside the picked address.
 * - No address at all is allowed too (a pickup customer): `onChange(null)`.
 * - Without a connection Google can't be asked; it says so and keeps what's there.
 */

const MIN_CHARS = 2;

/** "בית שמש | יחזקאל הנביא 27 בחניה" → "יחזקאל הנביא 27 בית שמש": street first, as Google likes it. */
function legacySearchText(legacy: string): string {
  const parts = legacy.split("|").map((p) => p.trim()).filter(Boolean);
  return (parts.length > 1 ? [...parts.slice(1), parts[0]] : parts).join(" ");
}
const DEBOUNCE_MS = 250;

function newSessionToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "חיפוש הכתובות לא זמין כרגע. נסו שוב בעוד רגע.");
  return data;
}

export type AddressPickerProps = {
  value: StructuredAddress | null;
  onChange: (next: StructuredAddress | null) => void;
  id?: string;
  /** Spoken name of the field, when no visible label points at it. */
  ariaLabel?: string;
  placeholder?: string;
  /** The "דירה / כניסה" box under a picked address. */
  allowUnit?: boolean;
  /**
   * The address as it was saved before the picker ("בית שמש | יחזקאל הנביא 27
   * בחניה"), shown while nothing is picked, with a button that searches for it.
   */
  legacyText?: string | null;
  disabled?: boolean;
  className?: string;
};

export function AddressPicker({
  value,
  onChange,
  id,
  ariaLabel = "כתובת",
  placeholder = "התחילו להקליד רחוב ומספר בית",
  allowUnit = true,
  legacyText = null,
  disabled = false,
  className,
}: AddressPickerProps) {
  const [searching, setSearching] = useState(value === null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  // A street picked without a number: waiting for the house number.
  const [street, setStreet] = useState<StructuredAddress | null>(null);
  const [houseNumber, setHouseNumber] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const sessionToken = useRef(newSessionToken());
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const unitId = useId();
  const numberId = useId();

  // A value set from outside (a form reset, a customer loaded) shows as picked.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    setSearching(value === null);
    setStreet(null);
  }

  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  const trimmed = query.trim();

  // Suggestions, a moment after typing stops; a newer query cancels an older one.
  useEffect(() => {
    if (!searching || street || trimmed.length < MIN_CHARS || !online) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      postJson<{ suggestions: AddressSuggestion[] }>(
        "/api/places/autocomplete",
        { input: trimmed, sessionToken: sessionToken.current },
        controller.signal
      )
        .then((data) => {
          setSuggestions(data.suggestions ?? []);
          setActive(0);
        })
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === "AbortError") return;
          setSuggestions([]);
          setError(e instanceof Error ? e.message : "חיפוש הכתובות לא זמין כרגע.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, searching, street, online]);

  const finish = useCallback(
    (picked: StructuredAddress, pickedNote: string | null = null) => {
      // The unit typed before stays with the address.
      onChange({ ...picked, unit: value?.unit ?? picked.unit ?? "" });
      setNote(pickedNote);
      setSearching(false);
      setStreet(null);
      setHouseNumber("");
      setQuery("");
      setSuggestions([]);
      sessionToken.current = newSessionToken();
    },
    [onChange, value?.unit]
  );

  async function pick(suggestion: AddressSuggestion) {
    setLoading(true);
    setError(null);
    try {
      const { address } = await postJson<{ address: StructuredAddress }>("/api/places/details", {
        placeId: suggestion.placeId,
        sessionToken: sessionToken.current,
      });
      sessionToken.current = newSessionToken();
      if (address.street && !address.houseNumber) {
        // A street: ask for the number, then find that exact address.
        setStreet(address);
        setSuggestions([]);
        return;
      }
      finish(address, address.street ? null : "נבחר יישוב בלבד, בלי רחוב ומספר בית.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "חיפוש הכתובות לא זמין כרגע.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmNumber() {
    if (!street) return;
    const number = houseNumber.trim();
    if (!number) return;
    setLoading(true);
    setError(null);
    try {
      const token = sessionToken.current;
      const { suggestions: found } = await postJson<{ suggestions: AddressSuggestion[] }>(
        "/api/places/autocomplete",
        { input: `${street.street} ${number} ${street.city}`, sessionToken: token }
      );
      const match = found.find((s) => s.kind === "address" && s.main.includes(number));
      if (match) {
        const { address } = await postJson<{ address: StructuredAddress }>("/api/places/details", {
          placeId: match.placeId,
          sessionToken: token,
        });
        if (address.street && address.houseNumber && address.city === street.city) {
          finish(address);
          return;
        }
      }
      // Google doesn't know this number: keep the street and the typed number,
      // without the street's point — Waze then looks the address up itself.
      finish(
        {
          ...street,
          houseNumber: number,
          lat: null,
          lng: null,
          placeId: null,
          formatted: `${street.street} ${number}, ${street.city}`,
        },
        "Google לא מכיר את מספר הבית הזה. Waze יחפש את הכתובת לפי השם."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "חיפוש הכתובות לא זמין כרגע.");
    } finally {
      setLoading(false);
    }
  }

  function startSearch() {
    setSearching(true);
    setQuery(value ? addressLine(value, { withUnit: false }) : "");
    setNote(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      // Enter picks the highlighted address; it never moves the form on with
      // half an address in the box.
      event.preventDefault();
      event.stopPropagation();
      if (suggestions[active]) void pick(suggestions[active]);
    } else if (event.key === "Escape" && value) {
      setSearching(false);
      setQuery("");
      setSuggestions([]);
    }
  }

  // ── Picked ───────────────────────────────────────────────────────────────
  if (!searching && value) {
    const full = isFullAddress(value);
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-start gap-2 rounded-xl border border-input bg-background/80 px-3 py-2.5 shadow-sm">
          <LocationIcon className={cn("mt-0.5 h-4 w-4 shrink-0", full ? "text-secondary" : "text-warning")} />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{addressLine(value, { withUnit: false }) || value.formatted}</p>
            {!full || note ? (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-warning-soft-foreground">
                <WarningIcon className="h-3.5 w-3.5 shrink-0" />
                {note ?? "אין רחוב ומספר בית: Waze לא יוכל לנווט לכאן."}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={startSearch} disabled={disabled} className="gap-1 px-2">
              <EditIcon className="h-4 w-4" />
              שינוי
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="ניקוי הכתובת"
              onClick={() => onChange(null)}
              disabled={disabled}
              className="px-2"
            >
              <CloseIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {allowUnit ? (
          <div className="space-y-1">
            <label htmlFor={unitId} className="text-xs text-muted-foreground">
              דירה / כניסה / קומה (לא חובה)
            </label>
            <Input
              id={unitId}
              value={value.unit}
              onChange={(e) => onChange({ ...value, unit: e.target.value })}
              placeholder="דירה 5, כניסה א"
              disabled={disabled}
            />
          </div>
        ) : null}
      </div>
    );
  }

  // ── A street, waiting for its number ─────────────────────────────────────
  if (street) {
    return (
      <div className={cn("space-y-2 rounded-xl border border-input bg-background/80 p-3 shadow-sm", className)}>
        <p className="text-sm">
          <span className="text-muted-foreground">רחוב: </span>
          <span className="font-medium">{[street.street, street.city].filter(Boolean).join(", ")}</span>
        </p>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={numberId} className="text-xs text-muted-foreground">
              מספר בית
            </label>
            <Input
              id={numberId}
              autoFocus
              inputMode="numeric"
              value={houseNumber}
              onChange={(e) => setHouseNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  void confirmNumber();
                }
              }}
              placeholder="למשל 12"
              disabled={disabled || loading}
            />
          </div>
          <Button type="button" onClick={() => void confirmNumber()} disabled={disabled || loading || !houseNumber.trim()}>
            {loading ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : "אישור"}
          </Button>
          <Button type="button" variant="muted" onClick={() => setStreet(null)} disabled={loading}>
            חזרה
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  // ── Searching ────────────────────────────────────────────────────────────
  const showList = focused && (loading || error !== null || suggestions.length > 0 || (trimmed.length >= MIN_CHARS && online));
  return (
    <div className={cn("space-y-1", className)}>
      <Popover.Root open={showList}>
        <Popover.Anchor asChild>
          <div className="relative">
            <Input
              ref={inputRef}
              id={id}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.trim().length < MIN_CHARS) setSuggestions([]);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={onInputKeyDown}
              placeholder={placeholder}
              autoComplete="off"
              role="combobox"
              aria-label={ariaLabel}
              aria-expanded={showList}
              aria-controls={listId}
              aria-activedescendant={suggestions[active] ? `${listId}-${active}` : undefined}
              disabled={disabled}
              className="pe-10"
            />
            {loading ? (
              <SpinnerIcon className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : (
              <SearchIcon className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            )}
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            style={{
              width: "var(--radix-popper-anchor-width)",
              maxHeight: "var(--radix-popover-content-available-height)",
            }}
            className="z-[60] overflow-auto overscroll-contain rounded-xl border bg-background p-1 shadow-lg"
          >
            <div id={listId} role="listbox" aria-label="כתובות">
              {error ? (
                <p className="px-3 py-2 text-sm text-destructive">{error}</p>
              ) : suggestions.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{loading ? "מחפש..." : "לא נמצאו כתובות. נסו לכתוב גם את העיר."}</p>
              ) : (
                suggestions.map((s, index) => (
                  <button
                    key={s.placeId}
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    // Picked on pointer-down, before the input's blur closes the list.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void pick(s)}
                    onMouseMove={() => setActive(index)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-right text-sm hover:bg-muted",
                      index === active && "bg-muted"
                    )}
                  >
                    <LocationIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{s.main}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[s.secondary.replace(/,?\s*ישראל$/, ""), s.kind === "street" ? "רחוב" : s.kind === "settlement" ? "יישוב" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {!online ? (
        <p className="text-xs text-muted-foreground">אין חיבור לאינטרנט: אי אפשר לחפש כתובת עכשיו.</p>
      ) : null}
      {legacyText?.trim() && !value && !trimmed ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs">
          <span className="text-muted-foreground">הכתובת שנשמרה עד היום:</span>
          <span className="font-medium text-foreground">{legacyText.replace(/\s*\|\s*/g, ", ")}</span>
          <button
            type="button"
            className="font-medium text-secondary underline-offset-4 hover:underline"
            onClick={() => {
              setQuery(legacySearchText(legacyText));
              setFocused(true);
              inputRef.current?.focus();
            }}
            disabled={disabled}
          >
            חיפוש הכתובת הזו
          </button>
        </div>
      ) : null}
      {value ? (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setSearching(false);
            setQuery("");
            setSuggestions([]);
          }}
        >
          ביטול, להשאיר את הכתובת הקודמת
        </button>
      ) : null}
    </div>
  );
}
