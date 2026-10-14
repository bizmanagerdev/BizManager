"use client";

import Link from "next/link";
import { ProjectIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { EmptyState } from "@/components/ui/empty-state";
import { MetaRow } from "@/components/ui/meta-row";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/money";
import { formatShortDate } from "@/lib/date";
import { AddActionButton, SECTION_IDS } from "@/app/(app)/customers/[id]/customerSectionUi";
import type { CustomerProjectRow } from "@/app/(app)/customers/[id]/customerPageModel";

/** The newest projects on the page; the rest are a link away (the projects list, filtered to this customer). */
export const PROJECTS_SHOWN = 10;

export default function CustomerProjectsSection({
  customerId,
  customerName,
  projects,
  error,
}: {
  customerId: string;
  customerName: string;
  projects: CustomerProjectRow[];
  error: string | null;
}) {
  const newProjectHref = `/projects?create=1&customer_id=${encodeURIComponent(customerId)}`;
  const allProjectsHref = `/projects?customer_id=${encodeURIComponent(customerId)}&customer_name=${encodeURIComponent(customerName.trim())}`;

  return (
    <CollapsibleSection
      id={SECTION_IDS.projects}
      title="פרויקטים"
      icon={<ProjectIcon className={SECTION_ICON_CLASS} />}
      summary={<SectionCount count={projects.length} />}
      defaultOpen={projects.length > 0}
      action={<AddActionButton href={newProjectHref} label="פרויקט" ariaLabel="פרויקט חדש ללקוח" />}
      contentClassName="space-y-3"
    >
      {error ? <p className="text-sm text-destructive">שגיאה בטעינת הפרויקטים: {error}</p> : null}
      {projects.length === 0 ? (
        <EmptyState dense>אין פרויקטים ללקוח זה.</EmptyState>
      ) : (
        <div className="divide-y divide-border/60">
          {projects.slice(0, PROJECTS_SHOWN).map((project) => {
            const remaining = Math.max(project.totalPrice - project.collected, 0);
            return (
              <Link
                key={project.id}
                href={`/projects/${encodeURIComponent(project.id)}`}
                className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-muted/20"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words font-medium">{project.name}</span>
                    {project.status ? <StatusBadge value={project.status} type="project" /> : null}
                  </div>
                  <MetaRow
                    className="mt-0.5 text-xs text-muted-foreground"
                    items={[
                      project.startDate ? `התחיל ${formatShortDate(project.startDate, "—")}` : "ללא תאריך התחלה",
                      project.pending > 0.009 ? `צפוי לגבייה ${formatMoney(project.pending)}` : null,
                    ]}
                  />
                </div>
                <div className="shrink-0 text-end">
                  <div className="font-semibold tabular-nums">{formatMoney(project.totalPrice)}</div>
                  <div className={`text-xs font-medium ${remaining > 0.009 ? "text-destructive" : "text-success-soft-foreground"}`}>
                    {remaining > 0.009 ? `נותר ${formatMoney(remaining)}` : "שולם"}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {projects.length > PROJECTS_SHOWN ? (
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link href={allProjectsHref}>לכל הפרויקטים ({projects.length})</Link>
        </Button>
      ) : null}
    </CollapsibleSection>
  );
}
