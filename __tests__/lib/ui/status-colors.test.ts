import { describe, it, expect } from "vitest";
import {
  normalizeOrderStatus,
  getPaymentStatusColor,
  getProjectStatusColor,
  getTaskStatusColor,
  getTaskPriorityColor,
  getOrderStatusColor,
  getPaymentStatusLabel,
  getProjectStatusLabel,
  getTaskStatusLabel,
  getTaskPriorityLabel,
  getOrderStatusLabel,
  getStatusLabel,
  getStatusColor,
} from "@/lib/ui/status-colors";

// Every status badge in the app (orders/payments/projects/tasks/priority, in
// both Hebrew and Arabic) is driven by this one file. It had zero tests, so a
// silently-broken case/locale here would only ever be caught by eyeballing a
// screenshot.

describe("normalizeOrderStatus", () => {
  it("maps every Hebrew synonym to its canonical English status", () => {
    expect(normalizeOrderStatus("פתוחה")).toBe("draft");
    expect(normalizeOrderStatus("מאושרת")).toBe("reserved");
    expect(normalizeOrderStatus("בטיפול")).toBe("reserved");
    expect(normalizeOrderStatus("במשלוח")).toBe("reserved");
    expect(normalizeOrderStatus("סופק חלקית")).toBe("partially_delivered");
    expect(normalizeOrderStatus("סופקה")).toBe("delivered");
    expect(normalizeOrderStatus("הושלמה")).toBe("closed");
    expect(normalizeOrderStatus("סגורה")).toBe("closed");
    expect(normalizeOrderStatus("בוטלה")).toBe("cancelled");
  });
  it("also accepts the canonical English values directly, case/whitespace-insensitive", () => {
    expect(normalizeOrderStatus(" Delivered ")).toBe("delivered");
    expect(normalizeOrderStatus("CLOSED")).toBe("closed");
  });
  it("passes an unrecognized status through, lowercased", () => {
    expect(normalizeOrderStatus("Something Weird")).toBe("something weird");
  });
  it("blanks null/undefined", () => {
    expect(normalizeOrderStatus(null)).toBe("");
    expect(normalizeOrderStatus(undefined)).toBe("");
  });
});

describe("getPaymentStatusColor", () => {
  it.each([
    ["paid", "success"],
    ["cleared", "success"],
    ["partial", "warning"],
    ["pending", "warning"],
    ["not_due", "neutral"],
    ["not_paid", "danger"],
    ["unpaid", "danger"],
    ["overpaid", "danger"],
    ["rejected", "danger"],
    ["something_unrecognized", "neutral"],
  ] as const)("%s -> %s", (status, color) => {
    expect(getPaymentStatusColor(status)).toBe(color);
  });
});

describe("getProjectStatusColor", () => {
  it.each([
    ["quote", "neutral"],
    ["planned", "neutral"],
    ["active", "info"],
    ["on_hold", "warning"],
    ["completed", "success"],
    ["cancelled", "neutral"],
  ] as const)("%s -> %s", (status, color) => {
    expect(getProjectStatusColor(status)).toBe(color);
  });
});

describe("getTaskStatusColor", () => {
  it.each([
    ["todo", "neutral"],
    ["in_progress", "info"],
    ["blocked", "danger"],
    ["done", "success"],
    ["cancelled", "neutral"],
  ] as const)("%s -> %s", (status, color) => {
    expect(getTaskStatusColor(status)).toBe(color);
  });
});

describe("getTaskPriorityColor", () => {
  it.each([
    ["low", "neutral"],
    ["medium", "info"],
    ["high", "warning"],
    ["urgent", "danger"],
  ] as const)("%s -> %s", (priority, color) => {
    expect(getTaskPriorityColor(priority)).toBe(color);
  });
});

describe("getOrderStatusColor", () => {
  it("draft reads danger (an open order needs attention), not neutral", () => {
    expect(getOrderStatusColor("draft")).toBe("danger");
  });
  it("delivered/closed both read success", () => {
    expect(getOrderStatusColor("delivered")).toBe("success");
    expect(getOrderStatusColor("closed")).toBe("success");
  });
  it("goes through the Hebrew-synonym normalization first", () => {
    expect(getOrderStatusColor("סופקה")).toBe(getOrderStatusColor("delivered"));
  });
});

describe("Hebrew labels — one representative case per status family", () => {
  it("payment", () => {
    expect(getPaymentStatusLabel("paid")).toBe("שולם");
    expect(getPaymentStatusLabel("pending")).toBe("תשלום צפוי");
    expect(getPaymentStatusLabel("rejected")).toBe("נדחה");
  });
  it("project", () => {
    expect(getProjectStatusLabel("active")).toBe("פעיל");
    expect(getProjectStatusLabel("on_hold")).toBe("בהמתנה");
  });
  it("task", () => {
    expect(getTaskStatusLabel("in_progress")).toBe("בתהליך");
    expect(getTaskStatusLabel("overdue")).toBe("באיחור"); // not a TaskStatus member, but handled
  });
  it("priority", () => {
    expect(getTaskPriorityLabel("urgent")).toBe("דחופה");
  });
  it("order (through the Hebrew-synonym normalization)", () => {
    expect(getOrderStatusLabel("מאושרת")).toBe("בהזמנה");
    expect(getOrderStatusLabel("closed")).toBe("סגור");
  });
  it("an unrecognized status falls back to itself, never a blank badge", () => {
    expect(getPaymentStatusLabel("mystery_status")).toBe("mystery_status");
  });
  it("an empty status falls back to a dash, not an empty badge", () => {
    expect(getPaymentStatusLabel("")).toBe("-");
  });
});

describe("Arabic labels — worker-facing locale switch", () => {
  it("every status family has real Arabic wording, not a silent Hebrew leak", () => {
    expect(getPaymentStatusLabel("paid", "ar")).toBe("مدفوع");
    expect(getProjectStatusLabel("active", "ar")).toBe("نشط");
    expect(getTaskStatusLabel("done", "ar")).toBe("منجز");
    expect(getTaskPriorityLabel("urgent", "ar")).toBe("عاجلة");
    expect(getOrderStatusLabel("delivered", "ar")).toBe("تم التسليم");
  });
  it("order status still normalizes Hebrew synonyms before switching to Arabic wording", () => {
    expect(getOrderStatusLabel("סופקה", "ar")).toBe("تم التسليم");
  });
});

describe("getStatusLabel / getStatusColor — the type-dispatched entry points", () => {
  it("route to the matching per-domain function for every StatusBadgeType", () => {
    expect(getStatusLabel("payment", "paid")).toBe(getPaymentStatusLabel("paid"));
    expect(getStatusLabel("project", "active")).toBe(getProjectStatusLabel("active"));
    expect(getStatusLabel("task", "done")).toBe(getTaskStatusLabel("done"));
    expect(getStatusLabel("priority", "urgent")).toBe(getTaskPriorityLabel("urgent"));
    expect(getStatusLabel("order", "closed")).toBe(getOrderStatusLabel("closed"));

    expect(getStatusColor("payment", "paid")).toBe(getPaymentStatusColor("paid"));
    expect(getStatusColor("project", "active")).toBe(getProjectStatusColor("active"));
    expect(getStatusColor("task", "done")).toBe(getTaskStatusColor("done"));
    expect(getStatusColor("priority", "urgent")).toBe(getTaskPriorityColor("urgent"));
    expect(getStatusColor("order", "closed")).toBe(getOrderStatusColor("closed"));
  });
});
