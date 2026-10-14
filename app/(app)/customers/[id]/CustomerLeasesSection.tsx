"use client";

import Link from "next/link";
import { BuildingIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { MetaRow } from "@/components/ui/meta-row";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { formatMoney } from "@/lib/money";
import { formatShortDate } from "@/lib/date";
import { depositTypeLabel, leaseStatusLabel } from "@/lib/properties";
import { SECTION_IDS } from "@/app/(app)/customers/[id]/customerSectionUi";
import type { CustomerLeaseRow } from "@/app/(app)/customers/[id]/customerPageModel";

/** "החל מ-01/09/25" — nothing at all for a lease with no start date (it read "החל מ--"). */
export function leaseStartText(startDate: string | null): string | null {
  return startDate ? `החל מ-${formatShortDate(startDate, "—")}` : null;
}

/**
 * נכסים בשכירות — only for a customer who rents (a tenant is a customer like
 * any other; this is their lease history). Open: it's what makes them a tenant.
 */
export default function CustomerLeasesSection({ leases }: { leases: CustomerLeaseRow[] }) {
  if (leases.length === 0) return null;
  return (
    <CollapsibleSection
      id={SECTION_IDS.leases}
      title="נכסים בשכירות"
      icon={<BuildingIcon className={SECTION_ICON_CLASS} />}
      summary={<SectionCount count={leases.length} />}
      defaultOpen
    >
      <div className="divide-y divide-border/60">
        {leases.map((lease) => (
          <Link
            key={lease.id}
            href={`/properties/${encodeURIComponent(lease.propertyId)}`}
            className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-muted/20"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words font-medium">{lease.label}</span>
                <Badge variant={lease.status === "active" ? "success" : "neutral"}>{leaseStatusLabel(lease.status)}</Badge>
              </div>
              <MetaRow
                className="mt-0.5 text-xs text-muted-foreground"
                items={[
                  leaseStartText(lease.startDate),
                  lease.endDate ? `עד ${formatShortDate(lease.endDate, "—")}` : "ללא תאריך סיום",
                  lease.depositType
                    ? [depositTypeLabel(lease.depositType), lease.depositAmount != null ? formatMoney(lease.depositAmount) : null]
                        .filter(Boolean)
                        .join(" ")
                    : null,
                ]}
              />
            </div>
            <div className="shrink-0 text-end font-semibold tabular-nums">{formatMoney(lease.monthlyRentAmount)} לחודש</div>
          </Link>
        ))}
      </div>
    </CollapsibleSection>
  );
}
