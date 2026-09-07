import type { UserRole } from "@/lib/auth/requireProfile";

// Type-only import above — erased at compile time, so this file has NO runtime
// dependency on requireProfile.ts. Kept as its own leaf module (rather than
// living in roleAccess.ts, which DOES value-import requireProfile for
// requireStaffPage/requireAdminPage) specifically so requireProfile.ts can
// import sanitizeSectionAccess here without creating a circular import.

/**
 * The business sections a worker's access can be individually granted —
 * ONE list, shared by the navigation (so a tab a worker can't open is never
 * rendered), the page guards (so typing the URL doesn't get him there
 * either), and the Salary Center worker-edit dialog (so the checkboxes an
 * admin sees are exactly the sections actually enforced). Nav-only filtering
 * is cosmetic — the guard is the security boundary; keeping all three off
 * this one list is what stops them drifting apart.
 *
 * Order here is the order the checkboxes/nav show in, AND (see
 * `firstAccessibleSection`) the priority a dashboard-less worker falls back
 * through after login.
 */
export type WorkerSectionId = "dashboard" | "deliveries" | "tasks" | "calendar" | "vehicles";

export const WORKER_SECTIONS: { id: WorkerSectionId; label: string; prefix: string }[] = [
  { id: "dashboard", label: "דשבורד", prefix: "/dashboard" },
  { id: "deliveries", label: "משלוחים", prefix: "/deliveries" },
  { id: "tasks", label: "משימות", prefix: "/tasks" },
  // Scoped by the page itself: only admin/office get the "all" schedule, so a
  // worker's calendar is his own tasks and reminders.
  { id: "calendar", label: "יומן", prefix: "/calendar" },
  { id: "vehicles", label: "רכבים", prefix: "/vehicles" },
];

export type SectionAccess = Record<WorkerSectionId, boolean>;

// Preserves current behavior for every existing worker on the day this
// shipped: the four routes that were always on stay on by default; vehicles
// (a brand new capability, previously staff-only) defaults OFF — nobody gets
// it just by deploying this, an admin has to grant it per worker.
export const DEFAULT_SECTION_ACCESS: SectionAccess = {
  dashboard: true,
  deliveries: true,
  tasks: true,
  calendar: true,
  vehicles: false,
};

/** Defensive parse of the `users.section_access` jsonb column — same spirit as lib/dashboard/widgets.ts's sanitizePrefs: unknown shapes/missing keys fall back per-key to DEFAULT_SECTION_ACCESS rather than failing closed or open as a whole. */
export function sanitizeSectionAccess(value: unknown): SectionAccess {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = { ...DEFAULT_SECTION_ACCESS };
  for (const section of WORKER_SECTIONS) {
    const v = raw[section.id];
    if (typeof v === "boolean") out[section.id] = v;
  }
  return out;
}

/**
 * Whether a viewer can reach a given business section. Staff always can,
 * regardless of the flag — `section_access` is a worker-only concept.
 */
export function hasSectionAccess(role: UserRole, access: SectionAccess, id: WorkerSectionId): boolean {
  return role !== "worker" || access[id] === true;
}

/**
 * Deliveries is the one section this predicate used to exist for alone,
 * before section access generalized to cover dashboard/tasks/calendar/
 * vehicles too. Kept as a thin wrapper so the several unrelated call sites
 * (order routes, delivery-images, sales/actions.ts, delivery-location,
 * QuickCreateDialogs.tsx) only need their argument's TYPE to change
 * (a boolean flag → the full SectionAccess object), not a rewrite.
 */
export function hasDeliveriesAccess(role: UserRole, access: SectionAccess): boolean {
  return hasSectionAccess(role, access, "deliveries");
}

/** The prefix of the first section (in WORKER_SECTIONS order) this worker can actually reach — for redirecting a dashboard-less worker somewhere sane right after login, instead of straight to /no-access. Null if every section is off. */
export function firstAccessiblePrefix(access: SectionAccess): string | null {
  return WORKER_SECTIONS.find((s) => access[s.id])?.prefix ?? null;
}
