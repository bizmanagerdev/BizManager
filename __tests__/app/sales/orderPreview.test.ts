// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { orderPreviewFromRow, orderPreviewSlot } from "@/app/(app)/sales/orders/[id]/orderPreview";

// The orders list hands the order page whose order it is, so the page's
// loading screen can name it at once — named exactly as the page will.

const ROW = { id: "o1", customerId: "c1", customerName: "פיצה אורי", customerBranchName: null };

describe("orderPreviewFromRow", () => {
  it("names the order by its customer", () => {
    expect(orderPreviewFromRow(ROW)).toEqual({
      id: "o1",
      customerId: "c1",
      customerName: "פיצה אורי",
      customerDisplayName: "פיצה אורי",
    });
  });

  it("adds the branch the way the page does", () => {
    expect(orderPreviewFromRow({ ...ROW, customerBranchName: "בית שמש" })?.customerDisplayName).toBe(
      "פיצה אורי · סניף בית שמש"
    );
  });

  it("is null without an id, and has no customer link without a customer id", () => {
    expect(orderPreviewFromRow({ ...ROW, id: "" })).toBeNull();
    expect(orderPreviewFromRow({ ...ROW, customerId: "" })?.customerId).toBeNull();
  });
});

describe("orderPreviewSlot", () => {
  it("gives back the tapped order only, until the page has arrived", () => {
    orderPreviewSlot.remember(orderPreviewFromRow(ROW)!);
    expect(orderPreviewSlot.read("o2")).toBeNull();
    expect(orderPreviewSlot.read("o1")?.customerName).toBe("פיצה אורי");
    orderPreviewSlot.forget("o1");
    expect(orderPreviewSlot.read("o1")).toBeNull();
  });
});
