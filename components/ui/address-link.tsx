"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ViewDialog } from "@/components/ui/view-dialog";
import { wazeLinkForPin, type DeliveryPin } from "@/lib/delivery-location";
import { addressQuality, plainAddress } from "@/lib/ui/cities";
import { cn } from "@/lib/utils";

/**
 * Renders an address as a link that opens Waze navigation to that address.
 * Use anywhere an address/city is *displayed* (not in form inputs). The Waze
 * universal link opens the app on mobile and the web map on desktop.
 *
 * Pass `address` (and optionally `city`) to build the navigation target; the
 * visible text defaults to the address but can be overridden via `children`
 * (e.g. to show "עיר · כתובת").
 *
 * Waze only gets a street and house number (lib/ui/cities.ts addressQuality).
 * Anything less sent drivers somewhere random (owner, 2026-10-15/16), so:
 * - a city alone, or a street with extra words ("27 בחניה"): a notice shows
 *   what's saved, to copy into Waze by hand or to save properly;
 * - nothing saved: the mark is grey and a tap says to save an address.
 * A saved drop-off point (`pin`) skips all of that: Waze goes to the point.
 */
export interface AddressLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  address?: string | null;
  city?: string | null;
  /** Shown (unlinked) when there is nothing to navigate to. Defaults to "-". */
  fallback?: React.ReactNode;
  /** Extra classes when Waze is blocked, e.g. a grey Waze button. */
  unavailableClassName?: string;
  /** The customer's saved drop-off point. It always wins over the address
   *  (owner, 2026-10-16: "if there's a saved point … we use the saved point
   *  because that is the real address"). */
  pin?: DeliveryPin | null;
}

function buildWazeUrl(query: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

async function copySavedAddress(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("הכתובת הועתקה");
  } catch {
    toast.error("ההעתקה נכשלה. סמנו את הטקסט והעתיקו ידנית.");
  }
}

export function AddressLink({
  address,
  city,
  fallback = "-",
  unavailableClassName,
  pin,
  children,
  className,
  onClick,
  ...props
}: AddressLinkProps) {
  const [noticeOpen, setNoticeOpen] = React.useState(false);
  const addr = (address ?? "").trim();
  const town = (city ?? "").trim();
  // Skip the city when the address already contains it, to avoid "רחוב, עיר, עיר".
  const query = [addr, addr.includes(town) ? "" : town].filter(Boolean).join(", ");
  const quality = addressQuality({ address: addr, city: town });
  const saved = plainAddress({ address: addr, city: town });

  if (pin || quality === "clear") {
    return (
      <a
        href={pin ? wazeLinkForPin(pin) : buildWazeUrl(query)}
        target="_blank"
        rel="noopener noreferrer"
        title={pin ? "נווט לנקודה השמורה" : "נווט עם Waze"}
        className={cn(
          "cursor-pointer transition-colors hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline",
          className
        )}
        onClick={(e) => {
          // Don't trigger a parent card/row click when the user taps the address.
          e.stopPropagation();
          onClick?.(e);
        }}
        {...props}
      >
        {children ?? (query || saved)}
      </a>
    );
  }

  if (!saved && children == null) {
    return <span className={cn("text-muted-foreground", className)}>{fallback}</span>;
  }

  // Nothing saved (owner, 2026-10-16: "no address saved, please save an
  // address to use Waze"), or not a full one: what's there, to copy.
  const title = saved ? "אין כתובת מלאה לניווט" : "אין כתובת שמורה";

  return (
    // Clicks inside the notice bubble through the portal in React's tree;
    // stop them here so a row underneath doesn't open as well.
    <span className="contents" onClick={stop} onKeyDown={stop}>
      <button
        type="button"
        title={title}
        aria-label={props["aria-label"]}
        className={cn("cursor-pointer text-start", className, unavailableClassName)}
        onClick={() => setNoticeOpen(true)}
      >
        {children ?? saved}
      </button>
      <ViewDialog open={noticeOpen} onOpenChange={setNoticeOpen} title={title} size="formSm">
        {saved ? (
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <p className="text-muted-foreground">הכתובת השמורה כאן:</p>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <span className="min-w-0 flex-1 select-all font-semibold">{saved}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void copySavedAddress(saved)}>
                  העתקה
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground">
              אפשר להעתיק ולהדביק ב-Waze בעצמכם, או לשמור כתובת מלאה: רחוב ומספר בית.
            </p>
          </div>
        ) : (
          <p className="text-sm">לא שמורה כתובת. כדי להשתמש ב-Waze יש לשמור כתובת: רחוב ומספר בית.</p>
        )}
      </ViewDialog>
    </span>
  );
}
