"use client";

import { useLocalSyncStatus } from "@/lib/powersync/store";
import { t } from "@/lib/i18n/t";
import { topbarDict } from "@/lib/i18n/dictionaries/topbar";
import type { Locale } from "@/lib/i18n/types";
import { cn } from "@/lib/utils";

// One line in the account menu: is this device's copy of the data up to date?
// Shown only while the copy is switched on for the person (store has a status).
export function LocalSyncStatusLine({ locale }: { locale: Locale }) {
  const status = useLocalSyncStatus();
  if (!status) return null;

  const state = status.error
    ? "error"
    : !status.hasSynced
      ? "first"
      : status.connected
        ? "synced"
        : "offline";
  const label = {
    error: t(topbarDict, locale, "localDataError"),
    first: t(topbarDict, locale, "localDataFirstSync"),
    synced: t(topbarDict, locale, "localDataSynced"),
    offline: t(topbarDict, locale, "localDataOffline"),
  }[state];
  const time = status.lastSyncedAt
    ? status.lastSyncedAt.toLocaleTimeString(locale === "ar" ? "ar" : "he-IL", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-xs text-muted-foreground" role="status">
      <span
        aria-hidden
        className={cn(
          "mt-1 h-2 w-2 shrink-0 rounded-full",
          state === "synced" && "bg-emerald-500",
          state === "first" && "animate-pulse bg-amber-500",
          state === "offline" && "bg-muted-foreground/50",
          state === "error" && "bg-destructive"
        )}
      />
      {/* Wraps rather than truncating — the menu is narrow on phones. "Up to
          date" already says it's current, so it carries just the time. */}
      <span className="min-w-0">
        {t(topbarDict, locale, "localDataTitle")}: {label}
        {time && state === "synced" ? ` · ${time}` : ""}
        {time && (state === "offline" || state === "error")
          ? ` · ${t(topbarDict, locale, "localDataUpdatedAt")} ${time}`
          : ""}
      </span>
    </div>
  );
}
