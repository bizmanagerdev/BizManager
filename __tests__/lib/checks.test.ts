import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getChecks, normalizeCheckStatus, checkStatusLabel, checkStatusClasses } from "@/lib/checks";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

describe("normalizeCheckStatus", () => {
  it("maps every known 'cleared' synonym to cleared", () => {
    for (const raw of ["cleared", "paid", "collected", "completed", "CLEARED"]) {
      expect(normalizeCheckStatus(raw)).toBe("cleared");
    }
  });
  it("maps every known 'bounced' synonym to bounced", () => {
    for (const raw of ["bounced", "rejected", "returned", "failed"]) {
      expect(normalizeCheckStatus(raw)).toBe("bounced");
    }
  });
  it("defaults to pending for null/unknown values", () => {
    expect(normalizeCheckStatus(null)).toBe("pending");
    expect(normalizeCheckStatus("something_else")).toBe("pending");
  });
});

describe("checkStatusLabel", () => {
  it("labels each status in Hebrew", () => {
    expect(checkStatusLabel("cleared")).toBe("נפרע");
    expect(checkStatusLabel("bounced")).toBe("חזר");
    expect(checkStatusLabel("pending")).toBe("לפירעון");
  });
});

describe("checkStatusClasses", () => {
  it("returns non-empty, status-distinct class strings", () => {
    const cleared = checkStatusClasses("cleared");
    const bounced = checkStatusClasses("bounced");
    const pending = checkStatusClasses("pending");
    expect(cleared).toBeTruthy();
    expect(bounced).toBeTruthy();
    expect(pending).toBeTruthy();
    expect(new Set([cleared, bounced, pending]).size).toBe(3);
  });
});

describe("getChecks — a rent check (the rent roll, 2026-10-21)", () => {
  it("names its property and tenant: the lease it names, else the property's only running lease", async () => {
    const check = (id: string, extra: Record<string, unknown>) => ({
      id,
      amount_total: "4000",
      due_date: "2026-11-11",
      payment_date: "2026-11-11T00:00:00+00:00",
      payment_status: "pending",
      cleared_at: null,
      check_number: "262",
      order_id: null,
      project_id: null,
      property_id: "p-d4",
      lease_id: null,
      notes: null,
      account_id: null,
      reference_number: null,
      requires_split: false,
      ...extra,
    });
    const supabase = makeSupabase({
      payments: { data: [check("c1", { lease_id: "l-spot" }), check("c2", { due_date: "2026-12-11" })], error: null },
      properties: { data: [{ id: "p-d4", name: "D4 הר יונה", address: "האדמו״ר מבעלזא 24" }], error: null },
      lease_agreements: {
        data: [
          { id: "l-d4", property_id: "p-d4", customer_id: "cust-1", unit_label: null, status: "active" },
          { id: "l-spot", property_id: "p-d4", customer_id: "cust-2", unit_label: "מחסן", status: "ended" },
        ],
        error: null,
      },
      customers: {
        data: [
          { id: "cust-1", name: "רוזנפלד", name_for_invoice: null, phone: "0527695810" },
          { id: "cust-2", name: "כהן", name_for_invoice: null, phone: null },
        ],
        error: null,
      },
      document_links: { data: [], error: null },
    });
    const { checks, loadError } = await getChecks(supabase as unknown as SupabaseClient);
    expect(loadError).toBeNull();
    expect(checks.map((c) => [c.payment_id, c.source_type, c.source_id, c.source_label, c.customer_name])).toEqual([
      ["c1", "property", "p-d4", "D4 הר יונה · מחסן", "כהן"],
      ["c2", "property", "p-d4", "D4 הר יונה", "רוזנפלד"],
    ]);
  });
});
