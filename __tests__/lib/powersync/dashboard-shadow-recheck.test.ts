import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommonPowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "@/lib/powersync/schema";
import { recheckDifferences, runDashboardShadow, type DashboardShadowSnapshot } from "@/lib/powersync/dashboard-shadow";
import { computeLocalCard } from "@/lib/powersync/dashboard-local";
import { createLocalSupabase } from "@/lib/powersync/local-supabase";

// The daily device-vs-server check compared the server's copy from when the
// page opened with the device's a little later: a save in between — לברון's
// ₪530 expense 0.5 s before a project page's check, the owner's ₪2,054
// payment before the sales list's (2026-10-27) — was reported as a
// difference. Now a part that differs is looked at again against the server's
// data as it is then; only a difference that's still there is reported.

type Row = Record<string, unknown>;
const COLUMNS = new Map(AppSchema.tables.map((table) => [table.name, table.columns.map((column) => column.name)]));

/** A device copy (read whole per table, as the app's engine does) that last synced at `syncedAt`. */
function device(tables: Record<string, Row[]>, syncedAt = "2026-10-28T09:00:05Z") {
  return {
    currentStatus: { lastSyncedAt: new Date(syncedAt) },
    async getAll<T>(sql: string): Promise<T[]> {
      const table = /^SELECT \* FROM ([a-z_]+)$/.exec(sql)?.[1] ?? "";
      return (tables[table] ?? []).map((row) => ({
        ...Object.fromEntries((COLUMNS.get(table) ?? []).map((column) => [column, null])),
        ...row,
      })) as T[];
    },
  } as unknown as CommonPowerSyncDatabase;
}

const viewer = { userId: "admin", role: "admin", locale: "he" as const };

/** An admin's copy: one bank account with a payment in. */
function copy(extraPayments: Row[] = []): Record<string, Row[]> {
  return {
    business_settings: [{ id: "true", vat_rate: "0.18", money_tables: 1, bank_tables: 1 }],
    users: [{ id: "admin", full_name: "מנהל", role: "admin", active: 1, system_access: 1, auth_user_id: "a" }],
    accounts: [{ id: "a1", name: "מזרחי עסקי", kind: "bank", currency: "ILS", opening_balance: "1000", opening_date: "2026-07-01", is_active: 1, sort_order: 1 }],
    payments: [
      { id: "p1", account_id: "a1", amount_total: "500", payment_status: "cleared", payment_date: "2026-10-01 00:00:00.000Z", payment_method: "bank_transfer", business_domain: "sales", created_at: "2026-10-01 09:00:00.000Z", recorded_by: "admin" },
      ...extraPayments,
    ],
  };
}

/** A payment the owner adds after the page opened. */
const later = { id: "p2", account_id: "a1", amount_total: "2054", payment_status: "cleared", payment_date: "2026-10-28 00:00:00.000Z", payment_method: "bank_transfer", business_domain: "sales", created_at: "2026-10-28 09:00:03.000Z", recorded_by: "admin" };

async function bankPage(tables: Record<string, Row[]>) {
  return computeLocalCard(createLocalSupabase(device(tables)), "bankPage", viewer);
}

describe("the daily check's second look", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T09:00:10Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("a save between the page opening and the check: the second look matches — not reported as a difference", async () => {
    // The server read the page at 09:00:00, before the payment; the device has it.
    const snapshot: DashboardShadowSnapshot = {
      renderedAt: "2026-10-28T09:00:00Z", userId: "admin", role: "admin", locale: "he", todayIso: "2026-10-28",
      cards: { bankPage: await bankPage(copy()) },
    };
    const db = device(copy([later]));
    const first = await runDashboardShadow(db, snapshot);
    expect(first[0].match).toBe(false);

    const askServer = vi.fn(async () => ({ renderedAt: "2026-10-28T09:00:04Z", data: await bankPage(copy([later])) }));
    const [result] = await recheckDifferences(db, snapshot, first, askServer);
    expect(askServer).toHaveBeenCalledWith("bankPage", undefined);
    expect(result).toMatchObject({ card: "bankPage", match: true, recheck: "settled" });
  });

  it("a difference that's still there on the second look is reported, with the second look's differences", async () => {
    const snapshot: DashboardShadowSnapshot = {
      renderedAt: "2026-10-28T09:00:00Z", userId: "admin", role: "admin", locale: "he", todayIso: "2026-10-28",
      cards: { bankPage: await bankPage(copy()) },
    };
    // The device is missing nothing new, but the server has a payment the device never got.
    const db = device(copy());
    const serverNow = await bankPage(copy([later]));
    const first = await runDashboardShadow(db, { ...snapshot, cards: { bankPage: serverNow } });
    const [result] = await recheckDifferences(db, snapshot, first, async () => ({ renderedAt: "2026-10-28T09:00:04Z", data: serverNow }));
    expect(result.match).toBe(false);
    expect(result.recheck).toBe("confirmed");
    expect(result.diffs.length).toBeGreaterThan(0);
  });

  it("the server can't be asked (no connection): the first result stands, marked so", async () => {
    const snapshot: DashboardShadowSnapshot = {
      renderedAt: "2026-10-28T09:00:00Z", userId: "admin", role: "admin", locale: "he", todayIso: "2026-10-28",
      cards: { bankPage: await bankPage(copy()) },
    };
    const db = device(copy([later]));
    const first = await runDashboardShadow(db, snapshot);
    const [result] = await recheckDifferences(db, snapshot, first, async () => {
      throw new Error("offline");
    });
    expect(result).toMatchObject({ match: false, recheck: "unavailable" });
    expect(result.diffs).toEqual(first[0].diffs);
  });

  it("a part that matched isn't looked at again", async () => {
    const snapshot: DashboardShadowSnapshot = {
      renderedAt: "2026-10-28T09:00:00Z", userId: "admin", role: "admin", locale: "he", todayIso: "2026-10-28",
      cards: { bankPage: await bankPage(copy()) },
    };
    const db = device(copy());
    const askServer = vi.fn();
    const [result] = await recheckDifferences(db, snapshot, await runDashboardShadow(db, snapshot), askServer);
    expect(result.match).toBe(true);
    expect(result.recheck).toBeUndefined();
    expect(askServer).not.toHaveBeenCalled();
  });
});
