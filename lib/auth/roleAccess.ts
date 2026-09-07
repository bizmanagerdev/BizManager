import { redirect } from "next/navigation";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import { WORKER_SECTIONS, type SectionAccess } from "@/lib/auth/sections";

// Re-exported so existing call sites (`import { WORKER_SECTIONS, hasSectionAccess,
// ... } from "@/lib/auth/roleAccess"`) don't need to know these actually live in
// their own leaf module — see sections.ts's own comment for why the split exists
// (avoiding a circular import with requireProfile.ts).
export {
  WORKER_SECTIONS,
  DEFAULT_SECTION_ACCESS,
  sanitizeSectionAccess,
  hasSectionAccess,
  hasDeliveriesAccess,
  firstAccessiblePrefix,
  type WorkerSectionId,
  type SectionAccess,
} from "@/lib/auth/sections";

/**
 * Account/infra routes every worker can always reach, regardless of his
 * section access — they're not a business section to grant or withhold, just
 * where his own hours/pay/notifications already live.
 */
export const WORKER_ALLOWED_PREFIXES = [
  // Hours, monthly totals, payslips and salary — all already on the profile.
  "/profile",
  // The bell in the top bar is on every screen and points at /inbox; its
  // contents are already scoped by role (visibleAudienceRoles), so a worker sees
  // his own reminders there and nothing of the back office's.
  "/inbox",
  "/notifications",
  "/no-access",
] as const;

/** Roles that run the business — everything not on the worker list is theirs. */
export const STAFF_ROLES: UserRole[] = ["admin", "office"];

export function isStaffRole(role: UserRole): boolean {
  return role === "admin" || role === "office";
}

/**
 * Prefix match on path SEGMENTS, so "/tasks" allows "/tasks/123" but "/taskset"
 * (or a crafted "/dashboard-secret") is not swallowed by a bare startsWith.
 * Infra prefixes (WORKER_ALLOWED_PREFIXES) are unconditional; the business
 * sections (WORKER_SECTIONS) are gated by `access`.
 */
export function isPathAllowedForRole(role: UserRole, pathname: string, access: SectionAccess): boolean {
  if (isStaffRole(role)) return true;
  if (role !== "worker") return false;
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  const matches = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (WORKER_ALLOWED_PREFIXES.some(matches)) return true;
  return WORKER_SECTIONS.some((s) => access[s.id] && matches(s.prefix));
}

/**
 * Page guard for a screen a worker must not open. Same shape as requireProfile
 * (which is cache()-wrapped, so this adds no round-trip) — call it INSTEAD of
 * requireProfile at the top of the page:
 *
 *   const { profile, supabase } = await requireStaffPage();
 */
export async function requireStaffPage() {
  const ctx = await requireProfile();
  if (!isStaffRole(ctx.profile.role)) redirect("/no-access");
  return ctx;
}

/** Page guard for an admin-only screen. */
export async function requireAdminPage() {
  const ctx = await requireProfile();
  if (ctx.profile.role !== "admin") redirect("/no-access");
  return ctx;
}
