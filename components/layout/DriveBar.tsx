"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { ChevronLeftIcon, WazeIcon } from "@/components/ui/icons";
import { DRIVE_CHANGED_EVENT, DRIVE_STORAGE_KEY, parseDrive } from "@/lib/routes/drive";
import { israelDateKey } from "@/lib/timezone";

const ROUTE_PAGE = "/deliveries/route";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(DRIVE_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DRIVE_CHANGED_EVENT, onChange);
  };
}

function keptDrive(): string | null {
  try {
    return localStorage.getItem(DRIVE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * While a route is being driven on this phone, every other page carries a bar
 * back to it (owner, 2026-10-27: "let's say I want to do other stuff in the
 * app meanwhile, how do I get back to where I'm holding in the route").
 */
export default function DriveBar() {
  const pathname = usePathname();
  const kept = useSyncExternalStore(subscribe, keptDrive, () => null);
  const drive = useMemo(() => parseDrive(kept, israelDateKey()), [kept]);
  if (!drive || pathname === ROUTE_PAGE) return null;
  const stop = drive.stops[drive.at] ?? null;
  return (
    <Link
      href={ROUTE_PAGE}
      dir="rtl"
      className="flex items-center gap-2 bg-secondary px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary/90"
    >
      <WazeIcon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">
        {stop ? (
          <>
            <b>בנסיעה אל</b> {stop.name}{" "}
            <span className="whitespace-nowrap opacity-80">
              · {drive.at + 1}/{drive.stops.length}
            </span>
          </>
        ) : (
          <>
            <b>בנסיעה</b> · עברתם את כל העצירות
          </>
        )}
      </span>
      <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold">
        חזרה לנסיעה
        <ChevronLeftIcon className="h-4 w-4" />
      </span>
    </Link>
  );
}
