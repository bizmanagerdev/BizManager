import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildTaskPayload, diffTaskPayload, type TaskPayloadInput } from "@/components/tasks/TaskUpsertDialog.helpers";
import type { StructuredAddress } from "@/lib/address/structured";

// A task's address picked from Google (owner, 2026-10-16). Tasks save field
// by field, so the picked address goes as its own columns, with the city and
// street line beside them; a task saved before the picker keeps its own city
// and address; and the update route takes only the columns that changed.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit-after", () => ({ logAuditEventAfterResponse: vi.fn() }));

import { POST } from "@/app/api/tasks/update/route";

const PICKED: StructuredAddress = {
  city: "תל אביב",
  street: "הרצל",
  houseNumber: "5",
  unit: "קומה 2",
  lat: 32.06,
  lng: 34.77,
  placeId: "ChIJ-herzl-5",
  formatted: "הרצל 5, תל אביב",
};

const input = (extra: Partial<TaskPayloadInput>): TaskPayloadInput => ({
  effectiveTarget: null,
  derivedTargetType: null,
  effectiveDomain: "",
  projectId: "",
  propertyId: "",
  subject: "לבדוק",
  description: "",
  dueDate: "",
  dueTime: "",
  city: "",
  address: "",
  assignedUserId: "u1",
  memberIds: [],
  tagIds: [],
  pendingReminders: [],
  priority: "medium",
  status: "todo",
  isPrivate: false,
  ...extra,
});

describe("a task's address", () => {
  it("picked: its columns, the city, and the street line with the unit", () => {
    expect(buildTaskPayload(input({ addr: PICKED, city: "old", address: "old" }))).toMatchObject({
      city: "תל אביב",
      address: "הרצל 5 · קומה 2",
      addr_city: "תל אביב",
      addr_street: "הרצל",
      addr_house_number: "5",
      addr_unit: "קומה 2",
      addr_lat: 32.06,
      addr_place_id: "ChIJ-herzl-5",
    });
  });

  it("none picked: a task's own city and address, the columns empty", () => {
    expect(buildTaskPayload(input({ city: " ירושלים ", address: "יפו 20" }))).toMatchObject({
      city: "ירושלים",
      address: "יפו 20",
      addr_city: null,
      addr_street: null,
    });
  });

  it("an autosave sends the address columns only when they changed", () => {
    const before = buildTaskPayload(input({}));
    expect(diffTaskPayload(before, buildTaskPayload(input({})))).toBeNull();
    const diff = diffTaskPayload(before, buildTaskPayload(input({ addr: PICKED })));
    expect(diff).toMatchObject({ city: "תל אביב", addr_street: "הרצל", addr_lat: 32.06 });
    expect(diff).not.toHaveProperty("subject");
  });
});

describe("POST /api/tasks/update, the address", () => {
  const updates: Record<string, unknown>[] = [];
  beforeEach(() => {
    updates.length = 0;
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "insert", "delete", "order", "limit"]) builder[m] = () => builder;
    builder.update = (patch: Record<string, unknown>) => {
      updates.push(patch);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: { id: "t1", business_domain: "general_business", is_private: false }, error: null });
    builder.single = builder.maybeSingle;
    builder.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f);
    requireRouteAccess.mockResolvedValue({
      ok: true,
      value: { supabase: { from: () => builder, rpc: () => Promise.resolve({ data: null, error: null }) }, user: { id: "a1" }, profile: { id: "u1", role: "admin" } },
    });
  });

  it("writes only the address columns sent, each checked", async () => {
    await POST(
      new Request("http://test/api/tasks/update", {
        method: "POST",
        body: JSON.stringify({ id: "t1", addr_unit: " דירה 3 ", addr_lat: 999, addr_place_id: "../x" }),
      })
    );
    const patch = updates.find((u) => "addr_unit" in u) ?? {};
    expect(patch).toMatchObject({ addr_unit: "דירה 3", addr_lat: null, addr_place_id: null });
    expect(patch).not.toHaveProperty("addr_city");
  });
});
