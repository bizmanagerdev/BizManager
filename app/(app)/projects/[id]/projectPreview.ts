import { createPreviewSlot, previewText } from "@/lib/ui/preview-slot";

// What the projects list already knows about a project — its name, customer,
// status, kind and dates — handed to the project page for the moment between
// a tap on the row and the page's own data arriving (about a second on a
// phone). The page's loading screen draws its header from this instead of
// grey bars, so the tap answers at once with the right project
// (ProjectPageLoading, and RouteOpeningOverlay over the list).

export type ProjectPreview = {
  id: string;
  name: string;
  status: string | null;
  projectType: string | null;
  startDate: string | null;
  endDate: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
};

export const projectPreviewSlot = createPreviewSlot<ProjectPreview>();
export const rememberProjectPreview = projectPreviewSlot.remember;
export const readProjectPreview = projectPreviewSlot.read;
export const forgetProjectPreview = projectPreviewSlot.forget;

/** A projects-list row as a preview, or null when it has no id. */
export function projectPreviewFromRow(row: Record<string, unknown>): ProjectPreview | null {
  const id = previewText(row, "id");
  if (!id) return null;
  return {
    id,
    name: previewText(row, "name") ?? "פרויקט",
    status: previewText(row, "status"),
    projectType: previewText(row, "project_type"),
    startDate: previewText(row, "start_date"),
    endDate: previewText(row, "end_date"),
    customerId: previewText(row, "customer_id"),
    customerName: previewText(row, "customer_name"),
    // A project for a branch shows the BRANCH's phone on its page, which the
    // list doesn't have — leave the phone out rather than flash the wrong one.
    customerPhone: previewText(row, "branch_id") ? null : previewText(row, "customer_phone"),
  };
}
