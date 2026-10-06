import type { CommonPowerSyncDatabase } from "@powersync/web";
import { createLocalSupabase } from "./local-supabase";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getInboxView, todaySlice } from "@/lib/reminders/worklist";
import { getMyTasks, type DashboardTask } from "@/lib/dashboard/tasks-overview";
import { loadDeliveriesPage, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { loadAttendanceSpark, loadDeliveriesSpark } from "@/lib/dashboard/sparklines";
import { loadPhoneQueueData, type PhoneQueueData } from "@/lib/attendance/phone-reports";
import { loadAttendanceClassificationOptions } from "@/lib/payroll-page-loader";
import { getPropertiesSummary, type PropertiesSummary } from "@/lib/properties";
import type { Locale } from "@/lib/i18n/types";

// The dashboard's "shadow" check (PowerSync plan, dashboard step): while the
// board still shows the server's figures, work out the same cards from the
// on-device copy — with the SAME loaders, through createLocalSupabase — and
// compare. Nothing on screen changes; differences are reported. The board
// switches to the device copy (LOCAL_DATA_PAGES.dashboard) only after a stretch
// with none.

export type DashboardShadowCards = Partial<{
  todaySchedule: CalendarEntry[];
  todayAlerts: ReturnType<typeof todaySlice> | null;
  myTasks: DashboardTask[];
  deliveries: { items: DeliveryItem[]; spark: number[] };
  attendanceQueue: {
    data: PhoneQueueData;
    spark: number[];
    options: Awaited<ReturnType<typeof loadAttendanceClassificationOptions>> | null;
  };
  properties: PropertiesSummary;
}>;

export type DashboardShadowSnapshot = {
  /** When the server read these figures (ISO). */
  renderedAt: string;
  userId: string;
  role: string;
  locale: Locale;
  todayIso: string;
  cards: DashboardShadowCards;
};

export type ShadowResult = {
  card: keyof DashboardShadowCards;
  match: boolean;
  /** How long the device took to work the card out, ms. */
  localMs: number;
  diffs: { path: string; server: unknown; local: unknown }[];
  error?: string;
};

/** Timestamps compared as instants, money to the agora; key order ignored. */
function normalize(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? value : `@${t}`;
  }
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  return value ?? null;
}

const MAX_DIFFS = 8;

function shorten(value: unknown): unknown {
  if (typeof value === "string" && value.length > 60) return `${value.slice(0, 60)}…`;
  if (value && typeof value === "object") return Array.isArray(value) ? `[${value.length} items]` : "{…}";
  return value;
}

function diff(server: unknown, local: unknown, path: string, out: ShadowResult["diffs"]) {
  if (out.length >= MAX_DIFFS) return;
  if (Array.isArray(server) && Array.isArray(local)) {
    if (server.length !== local.length) out.push({ path: `${path}.length`, server: server.length, local: local.length });
    for (let i = 0; i < Math.min(server.length, local.length); i += 1) diff(server[i], local[i], `${path}[${i}]`, out);
    return;
  }
  if (server && local && typeof server === "object" && typeof local === "object") {
    const keys = new Set([...Object.keys(server), ...Object.keys(local)]);
    for (const key of keys) {
      diff((server as Record<string, unknown>)[key], (local as Record<string, unknown>)[key], `${path}.${key}`, out);
    }
    return;
  }
  if (server !== local) out.push({ path, server: shorten(server), local: shorten(local) });
}

function compare(card: keyof DashboardShadowCards, server: unknown, local: unknown, localMs: number): ShadowResult {
  const diffs: ShadowResult["diffs"] = [];
  diff(normalize(server), normalize(local), card, diffs);
  return { card, match: diffs.length === 0, localMs, diffs };
}

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await work();
  return { value, ms: Math.round(performance.now() - started) };
}

/** Work out each card in the snapshot from the device copy and compare. */
export async function runDashboardShadow(
  db: CommonPowerSyncDatabase,
  snapshot: DashboardShadowSnapshot
): Promise<ShadowResult[]> {
  const local = createLocalSupabase(db);
  const { cards, userId, role, locale, todayIso } = snapshot;
  const results: ShadowResult[] = [];

  const check = async <T>(card: keyof DashboardShadowCards, server: unknown, work: () => Promise<T>) => {
    try {
      const { value, ms } = await timed(work);
      results.push(compare(card, server, value, ms));
    } catch (error) {
      results.push({ card, match: false, localMs: 0, diffs: [], error: error instanceof Error ? error.message : String(error) });
    }
  };

  if (cards.todaySchedule) {
    await check("todaySchedule", cards.todaySchedule, () => getScheduleEntries(local, { scope: "mine", userId }));
  }
  if (cards.todayAlerts !== undefined) {
    await check("todayAlerts", cards.todayAlerts, async () => todaySlice(await getInboxView(local, { userId, role })));
  }
  if (cards.myTasks) {
    await check("myTasks", cards.myTasks, () => getMyTasks(local, userId, locale));
  }
  if (cards.deliveries) {
    await check("deliveries", cards.deliveries, async () => ({
      items: (await loadDeliveriesPage(local, { page: 1, filters: { customerId: null } })).deliveries,
      spark: await loadDeliveriesSpark(local),
    }));
  }
  if (cards.attendanceQueue) {
    await check("attendanceQueue", cards.attendanceQueue, async () => ({
      data: await loadPhoneQueueData(local),
      spark: await loadAttendanceSpark(local),
      options: await loadAttendanceClassificationOptions(local),
    }));
  }
  if (cards.properties) {
    await check("properties", cards.properties, () => getPropertiesSummary(local, todayIso));
  }
  return results;
}
