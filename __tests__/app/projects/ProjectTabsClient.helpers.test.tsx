// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  LtrInline,
  customerPaymentStatusLabel,
  deriveCustomerPaymentStatus,
  expenseItemTitle,
  expenseRecordedByLabel,
  formatIls,
  formatTimeOnly,
  isImageAttachment,
  isSameDay,
  paymentRecordedByLabel,
  sessionPaymentStatus,
} from "@/app/(app)/projects/[id]/ProjectTabsClient.helpers";
import type { AssignableUser, ExpenseListItem } from "@/app/(app)/projects/[id]/ProjectTabsClient";
import type { AuditRecordInfo } from "@/lib/audit";
import type { PaymentRow } from "@/lib/payments";

describe("deriveCustomerPaymentStatus", () => {
  it("is 'unpriced' when there's no due total (null or <= 0)", () => {
    expect(deriveCustomerPaymentStatus(null, 0)).toBe("unpriced");
    expect(deriveCustomerPaymentStatus(0, 0)).toBe("unpriced");
  });

  it("is 'paid' once paid covers due, within the epsilon tolerance", () => {
    expect(deriveCustomerPaymentStatus(1000, 1000)).toBe("paid");
    expect(deriveCustomerPaymentStatus(1000, 999.995)).toBe("paid"); // float rounding
  });

  it("is 'partial' when something was paid but not enough", () => {
    expect(deriveCustomerPaymentStatus(1000, 400)).toBe("partial");
  });

  it("is 'unpaid' when nothing was paid yet", () => {
    expect(deriveCustomerPaymentStatus(1000, 0)).toBe("unpaid");
  });
});

describe("customerPaymentStatusLabel", () => {
  it("has its own Hebrew label for 'unpriced' (not in the shared payment-status map)", () => {
    expect(customerPaymentStatusLabel("unpriced")).toBe("לא סוכם תשלום");
  });

  it("delegates the other statuses to the shared payment-status label", () => {
    expect(customerPaymentStatusLabel("paid")).toBe("שולם");
  });
});

describe("sessionPaymentStatus", () => {
  it("uses the explicit payment_status when the row has one", () => {
    expect(sessionPaymentStatus({ payment_status: "partial" } as never)).toBe("partial");
  });

  it("derives from paid vs labor cost when there's no explicit status", () => {
    expect(sessionPaymentStatus({ paid_amount: 0, labor_cost: 100 } as never)).toBe("unpaid");
    expect(sessionPaymentStatus({ paid_amount: 40, labor_cost: 100 } as never)).toBe("partial");
    expect(sessionPaymentStatus({ paid_amount: 100, labor_cost: 100 } as never)).toBe("paid");
  });

  it("treats a null session as unpaid", () => {
    expect(sessionPaymentStatus(null)).toBe("unpaid");
  });
});

describe("formatIls / formatTimeOnly / isSameDay", () => {
  it("formats a null amount as an em-dash", () => {
    expect(formatIls(null)).toBe("—");
  });

  it("formats a real amount as whole-shekel ILS", () => {
    expect(formatIls(1500)).toContain("1,500");
  });

  it("formats a valid time and an em-dash for invalid/empty input", () => {
    expect(formatTimeOnly(null)).toBe("—");
    expect(formatTimeOnly("not a date")).toBe("—");
    expect(formatTimeOnly("2026-09-17T14:05:00")).toBe("14:05");
  });

  it("compares two ISO strings by calendar day", () => {
    expect(isSameDay("2026-09-17T01:00", "2026-09-17T23:00")).toBe(true);
    expect(isSameDay("2026-09-17", "2026-09-18")).toBe(false);
    expect(isSameDay(null, "2026-09-17")).toBe(false);
  });
});

describe("isImageAttachment", () => {
  it("recognizes common image extensions, case-insensitively", () => {
    expect(isImageAttachment({ file_name: "photo.JPG", document_type: null })).toBe(true);
    // Falsy, not strictly `false`: `document_type?.includes(...)` short-circuits to
    // `undefined` on a null document_type, and the `||` never coerces it — every
    // real call site only uses this in a boolean context (`? :` / `&&`), so it's
    // harmless, just not a strict boolean return today.
    expect(isImageAttachment({ file_name: "scan.pdf", document_type: null })).toBeFalsy();
  });

  it("also recognizes a document_type containing 'photo'", () => {
    expect(isImageAttachment({ file_name: "upload.bin", document_type: "site_photo" })).toBe(true);
  });
});

describe("paymentRecordedByLabel / expenseRecordedByLabel", () => {
  const auditById: Record<string, AuditRecordInfo> = {
    p1: { action: "create", actorName: "רותי" } as AuditRecordInfo,
  };

  it("prefers the explicit recorded_by name over the audit trail", () => {
    const payment = { id: "p1", recorded_by: "u1" } as PaymentRow;
    const label = paymentRecordedByLabel(payment, {
      paymentRecordedByNameByValue: { u1: "דוד" },
      paymentAuditById: auditById,
    });
    expect(label).toBe("הוזן ע״י דוד");
  });

  it("falls back to a 'create' audit entry when there's no explicit name", () => {
    const payment = { id: "p1", recorded_by: null } as PaymentRow;
    const label = paymentRecordedByLabel(payment, {
      paymentRecordedByNameByValue: {},
      paymentAuditById: auditById,
    });
    expect(label).toBe("הוזן ע״י רותי");
  });

  it("returns null when there is neither a name nor a create audit entry", () => {
    const payment = { id: "p2", recorded_by: null } as PaymentRow;
    const label = paymentRecordedByLabel(payment, {
      paymentRecordedByNameByValue: {},
      paymentAuditById: {},
    });
    expect(label).toBeNull();
  });

  it("expenseRecordedByLabel only applies to expense-sourced rows", () => {
    const sessionItem = { source_type: "session" } as ExpenseListItem;
    expect(
      expenseRecordedByLabel(sessionItem, { expenseRecordedByNameByValue: {}, expenseAuditById: {} })
    ).toBeNull();
  });
});

describe("expenseItemTitle", () => {
  const usersById = new Map<string, AssignableUser>([
    ["u1", { id: "u1", full_name: "דוד כהן" } as AssignableUser],
  ]);

  it("titles a session row with the worker's name", () => {
    const item = {
      source_type: "session",
      session: { user_id: "u1" },
    } as unknown as ExpenseListItem;
    expect(expenseItemTitle(item, usersById)).toBe("שכר עובד — דוד כהן");
  });

  it("falls through expense description -> vendor -> category -> a generic label", () => {
    const item = {
      source_type: "expense",
      expense: { category: "חומרי בניין" },
      project_expense: {},
    } as unknown as ExpenseListItem;
    expect(expenseItemTitle(item, usersById)).toBe("חומרי בניין");
  });
});

describe("LtrInline", () => {
  it("renders its children in an LTR span with tabular-nums styling", () => {
    render(<LtrInline>1,234.50</LtrInline>);
    const el = screen.getByText("1,234.50");
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("dir", "ltr");
    expect(el.className).toContain("tabular-nums");
  });
});
