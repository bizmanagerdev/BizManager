// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The projects list hands the project page what the tapped row knew, so the
// page's loading screen can show its header at once. It must only ever show
// the project that was tapped, and only right after the tap.

const ROW = {
  id: "p1",
  name: "הובלה לחיפה",
  status: "active",
  project_type: "moving",
  start_date: "2026-10-04",
  end_date: null,
  customer_id: "c1",
  customer_name: "לקוח",
  customer_phone: "0501234567",
  branch_id: null,
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("projectPreviewFromRow", () => {
  it("takes the header's fields from a list row", async () => {
    const { projectPreviewFromRow } = await import("@/app/(app)/projects/[id]/projectPreview");
    expect(projectPreviewFromRow(ROW)).toEqual({
      id: "p1",
      name: "הובלה לחיפה",
      status: "active",
      projectType: "moving",
      startDate: "2026-10-04",
      endDate: null,
      customerId: "c1",
      customerName: "לקוח",
      customerPhone: "0501234567",
    });
  });

  it("leaves the phone out for a branch's project — its page shows the branch's", async () => {
    const { projectPreviewFromRow } = await import("@/app/(app)/projects/[id]/projectPreview");
    expect(projectPreviewFromRow({ ...ROW, branch_id: "b1" })?.customerPhone).toBeNull();
  });

  it("is null for a row without an id", async () => {
    const { projectPreviewFromRow } = await import("@/app/(app)/projects/[id]/projectPreview");
    expect(projectPreviewFromRow({ ...ROW, id: null })).toBeNull();
  });
});

describe("rememberProjectPreview / readProjectPreview", () => {
  it("gives back the tapped project, and only that one", async () => {
    const { projectPreviewFromRow, rememberProjectPreview, readProjectPreview } = await import(
      "@/app/(app)/projects/[id]/projectPreview"
    );
    rememberProjectPreview(projectPreviewFromRow(ROW)!);
    expect(readProjectPreview("p1")?.name).toBe("הובלה לחיפה");
    expect(readProjectPreview("p2")).toBeNull();
  });

  it("keeps only the latest tap", async () => {
    const { projectPreviewFromRow, rememberProjectPreview, readProjectPreview } = await import(
      "@/app/(app)/projects/[id]/projectPreview"
    );
    rememberProjectPreview(projectPreviewFromRow(ROW)!);
    rememberProjectPreview(projectPreviewFromRow({ ...ROW, id: "p2" })!);
    expect(readProjectPreview("p1")).toBeNull();
    expect(readProjectPreview("p2")).not.toBeNull();
  });

  it("goes stale after half a minute, so a later visit never shows an old header", async () => {
    vi.useFakeTimers();
    const { projectPreviewFromRow, rememberProjectPreview, readProjectPreview } = await import(
      "@/app/(app)/projects/[id]/projectPreview"
    );
    rememberProjectPreview(projectPreviewFromRow(ROW)!);
    vi.advanceTimersByTime(29_000);
    expect(readProjectPreview("p1")).not.toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(readProjectPreview("p1")).toBeNull();
  });

  it("is gone once the page has arrived", async () => {
    const { projectPreviewFromRow, rememberProjectPreview, readProjectPreview, forgetProjectPreview } = await import(
      "@/app/(app)/projects/[id]/projectPreview"
    );
    rememberProjectPreview(projectPreviewFromRow(ROW)!);
    forgetProjectPreview("p2");
    expect(readProjectPreview("p1")).not.toBeNull();
    forgetProjectPreview("p1");
    expect(readProjectPreview("p1")).toBeNull();
  });
});
