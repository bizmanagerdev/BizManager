import { redirect } from "next/navigation";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";

/**
 * ONE list of what a `worker` may reach, shared by the navigation (so the tabs a
 * worker can't open are never rendered) and by the page guards (so typing the
 * URL doesn't get him there either). Nav-only filtering is cosmetic — the guard
 * is the security boundary; keeping both off this list is what stops them
 * drifting apart.
 *
 * A logged-in worker's world is deliberately small: the deliveries he drives,
 * his tasks, his calendar, and his profile (which is where his own hours and pay
 * already live). Everything else — money, customers, projects, inventory, global
 * search — is staff-only.
 */
export const WORKER_ALLOWED_PREFIXES = [
  "/dashboard",
  "/deliveries",
  "/tasks",
  // Scoped by the page itself: only admin/office get the "all" schedule, so a
  // worker's calendar is his own tasks and reminders.
  "/calendar",
  // Hours, monthly totals, payslips and salary — all already on the profile.
  "/profile",
  // The bell in the top bar is on every screen and points at /inbox; its
  // contents are already scoped by role (visibleAudienceRoles), so a worker sees
  // his own reminders there and nothing of the back office's.
  "/inbox",
  "/notifications",
  "/no-access",
] as const;

/**
 * Deliveries is the one route on the worker list that's ALSO gated per
 * individual worker (`users.deliveries_access`, admin-set from the Salary
 * Center worker-edit dialog) — staff always have it regardless of the flag.
 * Shared by the page guard and every API route the delivery-confirm flow
 * writes/reads through, so they can't drift.
 */
export function hasDeliveriesAccess(role: UserRole, deliveriesAccess: boolean): boolean {
  return role !== "worker" || deliveriesAccess;
}

/** Roles that run the business — everything not on the worker list is theirs. */
export const STAFF_ROLES: UserRole[] = ["admin", "office"];

export function isStaffRole(role: UserRole): boolean {
  return role === "admin" || role === "office";
}

/**
 * Prefix match on path SEGMENTS, so "/tasks" allows "/tasks/123" but "/taskset"
 * (or a crafted "/dashboard-secret") is not swallowed by a bare startsWith.
 */
export function isPathAllowedForRole(role: UserRole, pathname: string): boolean {
  if (isStaffRole(role)) return true;
  if (role !== "worker") return false;
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  return WORKER_ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
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
