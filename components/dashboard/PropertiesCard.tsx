import Link from "next/link";
import { BuildingIcon, HomeIcon, CalendarIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import QuietCard from "@/components/dashboard/QuietCard";
import { cn } from "@/lib/utils";
import type { PropertiesSummary } from "@/lib/properties";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import type { Locale } from "@/lib/i18n/types";

const PROPERTIES_HREF = "/properties";

/** How many rows either section ever draws — the footer link is where the rest is. */
const SHOWN_LIMIT = 8;

/**
 * "נכסים" — occupancy status, not money: which properties have nobody in them,
 * and which active leases are running out. Both are pure display (no
 * one-click action lives on this card the way "נגבה" does on CollectionsCard)
 * — a vacancy is fixed by finding a tenant, and an expiring lease is handled
 * on the lease itself, both real workflows on the property page, not here.
 */
export default function PropertiesCard({ summary, locale }: { summary: PropertiesSummary; locale: Locale }) {
  if (summary.vacantCount === 0 && summary.expiringCount === 0) {
    return (
      <QuietCard
        icon={BuildingIcon}
        title={t(dashboardDict, locale, "propertiesCardTitle")}
        note={t(dashboardDict, locale, "propertiesEmptyNote")}
        href={PROPERTIES_HREF}
      />
    );
  }

  return (
    <Card className="relative flex h-full flex-col">
      <Link
        href={PROPERTIES_HREF}
        aria-label={t(dashboardDict, locale, "propertiesAria")}
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        <DashboardCardHeader
          icon={BuildingIcon}
          title={t(dashboardDict, locale, "propertiesCardTitle")}
          count={summary.vacantCount + summary.expiringCount}
        />

        <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
          {summary.vacantCount > 0 ? (
            <section className={summary.expiringCount > 0 ? "border-b border-border/50" : undefined}>
              <div className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
                {t(dashboardDict, locale, "vacantSectionLabel")} · {summary.vacantCount}
              </div>
              <ul className="divide-y">
                {summary.vacant.slice(0, SHOWN_LIMIT).map((p) => (
                  <li key={p.id} className="relative px-4 py-3 transition-colors hover:bg-secondary/10">
                    <Link
                      href={`/properties/${p.id}`}
                      aria-label={p.label}
                      className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex items-center gap-2 text-sm">
                      <HomeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{p.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t(dashboardDict, locale, "vacantBadgeLabel")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {summary.expiringCount > 0 ? (
            <section>
              <div className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
                {t(dashboardDict, locale, "expiringSectionLabel")} · {summary.expiringCount}
              </div>
              <ul className="divide-y">
                {summary.expiring.slice(0, SHOWN_LIMIT).map((lease) => {
                  const ended = lease.daysLeft < 0;
                  return (
                    <li key={lease.id} className="relative px-4 py-3 transition-colors hover:bg-secondary/10">
                      <Link
                        href={`/properties/${lease.propertyId}`}
                        aria-label={lease.label}
                        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="truncate text-sm font-medium">{lease.label}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[
                              lease.tenantName,
                              ended
                                ? t(dashboardDict, locale, "leaseEndedLabel")
                                : `${lease.daysLeft} ${t(dashboardDict, locale, "daysLeftSuffix")}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        <CalendarIcon
                          className={cn("h-4 w-4 shrink-0", ended ? "text-destructive" : "text-muted-foreground")}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </CardContent>

        <DashboardCardFooter href={PROPERTIES_HREF} label={t(dashboardDict, locale, "propertiesFooterLabel")} />
      </div>
    </Card>
  );
}
