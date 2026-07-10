import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/requireProfile";

/**
 * The catalog of dashboard widgets a user can show/hide/reorder via the "התאמת
 * לוח" customizer. ROLE is the security boundary: `roles` lists which roles may
 * ever see a widget, and `resolveWidgets` re-applies that filter AFTER the user's
 * saved prefs — so a stored/injected id can never surface a widget the viewer's
 * role isn't allowed to load (those panels are RLS-protected anyway).
 *
 * Shared by the server (DashboardPanels render + data-fetch gating) and the
 * client customizer, so this module stays framework-neutral.
 */

export type WidgetId =
  | "alerts"
  | "week"
  | "myTasks"
  | "reminders"
  | "finance"
  | "projects"
  | "deliveries"
  | "taskDonut"
  | "workforce"
  | "inventory"
  | "domainChart"
  | "activity";

export type WidgetMeta = {
  id: WidgetId;
  /** Hebrew label shown in the customizer. */
  label: string;
  /** Roles allowed to see this widget. */
  roles: UserRole[];
  /** Column span in the 2-col widget grid (2 = full width). */
  span: 1 | 2;
};

const ALL: UserRole[] = ["admin", "office", "worker"];
const BACK_OFFICE: UserRole[] = ["admin", "office"];
const ADMIN_ONLY: UserRole[] = ["admin"];

/**
 * Registry in DEFAULT top-to-bottom order (matches the legacy hand-coded
 * dashboard order). The order here is the fallback whenever the user hasn't set
 * an explicit order.
 */
export const DASHBOARD_WIDGETS: WidgetMeta[] = [
  // "מבט על היום" leads the dashboard for everyone by default (users can reorder).
  { id: "week", label: "מבט על היום", roles: ALL, span: 2 },
  { id: "alerts", label: "התראות", roles: ALL, span: 2 },
  { id: "finance", label: "גבייה ותשלומים", roles: BACK_OFFICE, span: 2 },
  { id: "myTasks", label: "המשימות שלי", roles: ALL, span: 2 },
  { id: "projects", label: "סטטוס פרויקטים", roles: BACK_OFFICE, span: 2 },
  { id: "deliveries", label: "אספקות קרובות", roles: BACK_OFFICE, span: 1 },
  { id: "taskDonut", label: "פילוח משימות", roles: BACK_OFFICE, span: 1 },
  { id: "workforce", label: "כוח אדם", roles: BACK_OFFICE, span: 2 },
  { id: "inventory", label: "מצב מלאי", roles: BACK_OFFICE, span: 2 },
  { id: "domainChart", label: "הכנסות והוצאות לפי תחום", roles: BACK_OFFICE, span: 2 },
  { id: "reminders", label: "תזכורות", roles: ALL, span: 1 },
  { id: "activity", label: "פעילות אחרונה", roles: ADMIN_ONLY, span: 1 },
];

export type DashboardPrefs = {
  order: WidgetId[];
  hidden: WidgetId[];
};

const KNOWN_IDS = new Set<WidgetId>(DASHBOARD_WIDGETS.map((w) => w.id));

function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && KNOWN_IDS.has(value as WidgetId);
}

/**
 * Coerce arbitrary JSON (from the DB or a request body) into a clean
 * DashboardPrefs containing only known widget ids. Returns null for "no prefs".
 */
export function sanitizePrefs(value: unknown): DashboardPrefs | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { order?: unknown; hidden?: unknown };
  const order = Array.isArray(raw.order) ? raw.order.filter(isWidgetId) : [];
  const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter(isWidgetId) : [];
  // De-dupe while preserving order.
  const seen = new Set<WidgetId>();
  const dedupedOrder = order.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  return { order: dedupedOrder, hidden: [...new Set(hidden)] };
}

/** The widgets a role is allowed to see, in default order. */
export function catalogForRole(role: UserRole): WidgetMeta[] {
  return DASHBOARD_WIDGETS.filter((w) => w.roles.includes(role));
}

/**
 * The full role catalog reordered by the user's saved `order` — but WITHOUT
 * hiding anything. This is what the customizer lists (so hidden widgets can be
 * toggled back on). Unknown/new ids keep their default-catalog position.
 * Role-safe: only widgets the role already allows are ever included.
 */
export function orderedCatalog(role: UserRole, prefs: DashboardPrefs | null): WidgetMeta[] {
  const catalog = catalogForRole(role);
  const order = prefs?.order ?? [];

  const orderIndex = new Map<WidgetId, number>();
  order.forEach((id, i) => orderIndex.set(id, i));

  // Stable sort: explicitly-ordered widgets first (by saved order), then any
  // widget without a saved position keeps its default-catalog order after them.
  const withDefault = catalog.map((w, defaultIdx) => ({ w, defaultIdx }));
  withDefault.sort((a, b) => {
    const ai = orderIndex.has(a.w.id) ? orderIndex.get(a.w.id)! : Number.POSITIVE_INFINITY;
    const bi = orderIndex.has(b.w.id) ? orderIndex.get(b.w.id)! : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.defaultIdx - b.defaultIdx;
  });

  return withDefault.map((e) => e.w);
}

/**
 * The widgets to actually render, in order, for a viewer. Pure + role-safe:
 * the role catalog, reordered by saved prefs, with `hidden` ids dropped. Role
 * filtering is intrinsic to the catalog, so prefs can only ever hide/reorder
 * widgets the role already allows — never reveal a forbidden one.
 */
export function resolveWidgets(role: UserRole, prefs: DashboardPrefs | null): WidgetMeta[] {
  const hidden = new Set(prefs?.hidden ?? []);
  return orderedCatalog(role, prefs).filter((w) => !hidden.has(w.id));
}

/**
 * Read the viewer's saved dashboard prefs. Tolerant of the column not existing
 * yet (returns null before add_dashboard_prefs.sql runs) — exactly like the
 * font-scale GET — so the dashboard keeps working on role defaults pre-migration.
 */
export const getDashboardPrefs = cache(async function getDashboardPrefs(
  supabase: SupabaseClient,
  userId: string
): Promise<DashboardPrefs | null> {
  // cache(): the page shell and the streamed DashboardPanels both read prefs for
  // the same (supabase, userId) within one request — requireProfile() is itself
  // cached so both get the identical supabase instance, letting this dedupe to a
  // single `users` round-trip instead of two.
  const { data, error } = await supabase
    .from("users")
    .select("dashboard_prefs")
    .eq("id", userId)
    .maybeSingle();
  if (error) return null;
  return sanitizePrefs((data as { dashboard_prefs?: unknown } | null)?.dashboard_prefs);
});
