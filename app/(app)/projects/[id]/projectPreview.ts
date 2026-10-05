// What the projects list already knows about a project — its name, customer,
// status, kind and dates — handed to the project page for the moment between
// a tap on the row and the page's own data arriving (about a second on a
// phone). The page's loading screen draws its header from this instead of
// grey bars, so the tap answers at once with the right project
// (ProjectPageLoading, ProjectOpeningOverlay).
//
// One slot, kept briefly: it only has to last from the tap to the page. It is
// written only from a click handler, so on the server it is always empty.

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

// Long enough for a slow phone network; short enough that a later visit to
// the same project from somewhere else never gets an outdated header.
const PREVIEW_FRESH_MS = 30_000;

let latest: { preview: ProjectPreview; at: number } | null = null;

export function rememberProjectPreview(preview: ProjectPreview) {
  latest = { preview, at: Date.now() };
}

export function readProjectPreview(id: string): ProjectPreview | null {
  if (typeof window === "undefined" || !latest) return null;
  if (latest.preview.id !== id || Date.now() - latest.at > PREVIEW_FRESH_MS) return null;
  return latest.preview;
}

/** The page has arrived — its own header is on screen now. */
export function forgetProjectPreview(id: string) {
  if (latest?.preview.id === id) latest = null;
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A projects-list row as a preview, or null when it has no id. */
export function projectPreviewFromRow(row: Record<string, unknown>): ProjectPreview | null {
  const id = text(row, "id");
  if (!id) return null;
  return {
    id,
    name: text(row, "name") ?? "פרויקט",
    status: text(row, "status"),
    projectType: text(row, "project_type"),
    startDate: text(row, "start_date"),
    endDate: text(row, "end_date"),
    customerId: text(row, "customer_id"),
    customerName: text(row, "customer_name"),
    // A project for a branch shows the BRANCH's phone on its page, which the
    // list doesn't have — leave the phone out rather than flash the wrong one.
    customerPhone: text(row, "branch_id") ? null : text(row, "customer_phone"),
  };
}
