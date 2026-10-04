import { describe, it, expect, vi, beforeEach } from "vitest";

// Contract tests for POST /api/tasks/get — the full task card behind the edit
// dialog. Focus: the change history (admin/office only by RLS) is looked up in
// the first round for staff and skipped for workers, and a task the caller
// can't see returns nothing.

const { requireRouteAccess, getEntityAuditTrail, resolveUserDisplayNamesForValues, translateToArabic } = vi.hoisted(
  () => ({
    requireRouteAccess: vi.fn(),
    getEntityAuditTrail: vi.fn(),
    resolveUserDisplayNamesForValues: vi.fn(async () => ({})),
    translateToArabic: vi.fn(async (text: string) => `ar:${text}`),
  })
);

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ getEntityAuditTrail, resolveUserDisplayNamesForValues }));
vi.mock("@/lib/i18n/translateToHebrew", () => ({ translateToArabic }));

import { POST } from "@/app/api/tasks/get/route";

const TASK = { id: "t1", subject: "לתקן דלת", description: "בקומה 2", subject_he: null, description_he: null };

function makeSupabase(task: Record<string, unknown> | null) {
  const updates: unknown[] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "range"]) builder[m] = () => builder;
    builder.update = (values: unknown) => {
      updates.push(values);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: table === "tasks" ? task : null, error: null });
    builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onF, onR);
    return builder;
  };
  return { from, updates };
}

function grant(supabase: unknown, role: string, locale = "he") {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role, locale } },
  });
}

function post(id = "t1") {
  return POST(new Request("http://test/api/tasks/get", { method: "POST", body: JSON.stringify({ id }) }));
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  getEntityAuditTrail.mockReset();
  getEntityAuditTrail.mockResolvedValue({
    items: [{ id: "h1", actorName: "דנה", createdAt: "2026-10-01", actionLabel: "עודכן", details: "" }],
    error: null,
  });
  translateToArabic.mockClear();
});

describe("POST /api/tasks/get", () => {
  it("includes the change history for staff", async () => {
    grant(makeSupabase(TASK), "office");
    const res = await post();
    const body = await res.json();
    expect(getEntityAuditTrail).toHaveBeenCalledTimes(1);
    expect(body.history).toEqual([
      { id: "h1", actor_name: "דנה", created_at: "2026-10-01", action_label: "עודכן", details: "" },
    ]);
  });

  it("skips the history lookup for a worker (RLS would return nothing anyway)", async () => {
    grant(makeSupabase(TASK), "worker");
    const res = await post();
    expect(getEntityAuditTrail).not.toHaveBeenCalled();
    expect((await res.json()).history).toEqual([]);
  });

  it("returns no task — and no history — for a task the caller can't see", async () => {
    grant(makeSupabase(null), "admin");
    const res = await post();
    expect(await res.json()).toEqual({ task: null });
  });

  it("translates subject and description for an Arabic viewer", async () => {
    grant(makeSupabase(TASK), "worker", "ar");
    const res = await post();
    const body = await res.json();
    expect(translateToArabic).toHaveBeenCalledTimes(2);
    expect(body.task.subject_ar).toBe("ar:לתקן דלת");
    expect(body.task.description_ar).toBe("ar:בקומה 2");
  });
});
