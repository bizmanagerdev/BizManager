import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { ContactTapZone } from "@/components/ui/contact-link";

// The desktop head of a project page: where you are, what this is, and the
// handful of things you can do to it. Its own component so the page and the
// preview shown while the page loads (ProjectPagePreview) draw the same thing —
// the preview's heading must sit exactly where the real one lands.

export function projectTypeLabel(type: string | null | undefined) {
  switch (type) {
    case "logistics":
      return "לוגיסטיקה";
    case "construction":
      return "שיפוצים";
    case "moving":
      return "הובלה";
    default:
      return type ?? "לא הוגדר";
  }
}

export default function ProjectPageHeading({
  customerId,
  customerDisplayName,
  customerPhone,
  projectName,
  projectType,
  actions,
}: {
  customerId: string | null;
  /** The customer's name, with " · סניף …" when the project is for a branch. */
  customerDisplayName: string;
  customerPhone: string | null;
  projectName: string;
  projectType: string | null;
  actions?: ReactNode;
}) {
  return (
    <div className="hidden flex-col gap-2 lg:flex">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <nav
            className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
            aria-label="ניווט"
          >
            <Link href="/projects" className="hover:text-foreground hover:underline">
              פרויקטים
            </Link>
            <ChevronLeftIcon className="h-3.5 w-3.5 shrink-0" />
            {customerId ? (
              <Link href={`/customers/${customerId}`} className="text-foreground hover:underline">
                {customerDisplayName || "לקוח"}
              </Link>
            ) : (
              <span className="text-foreground">{customerDisplayName || "ללא לקוח משויך"}</span>
            )}
            {customerPhone ? (
              <>
                <span>·</span>
                <ContactTapZone
                  kind={customerPhone.includes("@") ? "mailto" : "tel"}
                  value={customerPhone}
                  className="hover:text-foreground hover:underline"
                >
                  <span dir="ltr">{customerPhone}</span>
                </ContactTapZone>
              </>
            ) : null}
          </nav>
          {/* Just the name and the kind of job: status, dates and manager
              are on the סטטוס הפרויקט card, which every project has now. */}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">{projectName}</h1>
            <Badge variant="outline">{projectTypeLabel(projectType)}</Badge>
          </div>
        </div>

        {actions}
      </div>
    </div>
  );
}
