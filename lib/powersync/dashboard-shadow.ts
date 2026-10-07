import type { CommonPowerSyncDatabase } from "@powersync/web";
import { createLocalSupabase } from "./local-supabase";
import { computeLocalCard, MONEY_CARD_NOT_READY, type LocalCardKind, type LocalDashboardCards } from "./dashboard-local";
import type { Locale } from "@/lib/i18n/types";

// The dashboard's "shadow" check (PowerSync plan, dashboard step): while the
// board still shows the server's figures, work out the same cards from the
// on-device copy — with the SAME loaders (dashboard-local.ts, through
// createLocalSupabase) — and compare. Nothing on screen changes; differences
// are reported. The board switches to the device copy
// (LOCAL_DATA_PAGES.dashboard) only after a stretch with none.

export type DashboardShadowCards = Partial<LocalDashboardCards>;

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
  /** A dashboard card, or a whole money view (runMoneyViewsCheck). */
  card: string;
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

function compare(card: string, server: unknown, local: unknown, localMs: number): ShadowResult {
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
  const viewer = { userId: snapshot.userId, role: snapshot.role, locale: snapshot.locale };
  const results: ShadowResult[] = [];
  for (const card of Object.keys(snapshot.cards) as LocalCardKind[]) {
    try {
      const filters = (snapshot.cards[card] as { filters?: unknown } | undefined)?.filters;
      const { value, ms } = await timed(() => computeLocalCard(local, card, viewer, filters));
      results.push(compare(card, snapshot.cards[card], value, ms));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A copy without the money tables yet (before sync rules v1.8 reach
      // it): nothing to compare, not a difference.
      if (message.startsWith(MONEY_CARD_NOT_READY)) continue;
      results.push({ card, match: false, localMs: 0, diffs: [], error: message });
    }
  }
  return results;
}

/**
 * The plan's "every figure on every project" check: the two money views the
 * projects pages stand on — read whole from the server (as this person, so
 * the same rows they'd see) and worked out whole on the device — compared row
 * by row. Run once a day per device; projects move to the device copy only
 * after this comes out clean.
 */
export async function runMoneyViewsCheck(db: CommonPowerSyncDatabase): Promise<ShadowResult[]> {
  const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
  const server = createSupabaseBrowserClient();
  const local = createLocalSupabase(db);
  const views = [
    { name: "project_financials_view", key: (r: Record<string, unknown>) => String(r.id) },
    { name: "worker_debt_items_view", key: (r: Record<string, unknown>) => `${r.source_type}:${r.source_id}` },
  ] as const;
  const results: ShadowResult[] = [];
  for (const view of views) {
    try {
      const [serverRes, { value: localRes, ms }] = await Promise.all([
        server.from(view.name).select("*").range(0, 9999),
        timed(async () => local.from(view.name).select("*")),
      ]);
      if (serverRes.error) throw new Error(`server: ${serverRes.error.message}`);
      if (localRes.error) throw new Error(`device: ${localRes.error.message}`);
      const byKey = (rows: unknown) =>
        [...((rows ?? []) as Record<string, unknown>[])].sort((a, b) => view.key(a).localeCompare(view.key(b)));
      results.push(compare(view.name, byKey(serverRes.data), byKey(localRes.data), ms));
    } catch (error) {
      results.push({ card: view.name, match: false, localMs: 0, diffs: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
