import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { TopBarHeading } from "@/components/layout/TopBarHeading";

// The desktop head of a project page — where you are, the project's name and
// kind, and the handful of things you can do to it — in the top bar (owner,
// 2026-10-22: "the two buttons move into the top bar … Here it says the
// projects, then the arrow, then the customer and his number. We could remove
// that. Just put the project name and the project type"; TopBarHeading). Its
// own component so the page and the preview shown while the page loads
// (ProjectPagePreview) put the same thing there. The customer is on the page's
// own cards; status, dates and manager on the סטטוס הפרויקט card.

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
  projectName,
  projectType,
  actions,
}: {
  projectName: ReactNode;
  projectType: string | null;
  actions?: ReactNode;
}) {
  return (
    <TopBarHeading
      section="פרויקטים"
      href="/projects"
      title={
        <>
          <span className="min-w-0 truncate">{projectName}</span>
          <Badge variant="outline" className="shrink-0 font-medium">
            {projectTypeLabel(projectType)}
          </Badge>
        </>
      }
      actions={actions}
    />
  );
}
