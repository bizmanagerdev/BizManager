import { describe, it, expect } from "vitest";
import {
  daysSince,
  whatsappLink,
  severityTint,
  buildWaMessage,
  groupHasPendingCheck,
  flattenExpectedReceipts,
  buildDomainOptions,
  presentReceiptMethodChips,
  parseInitialView,
  parseInitialFilter,
  filterAndSortDebtors,
  groupReminders,
  filterExpectedReceipts,
  overdueAgingBreakdown,
} from "@/app/(app)/collections/CollectionsClient.helpers";
import type { CollectionCustomerGroup } from "@/lib/collections";
import type { Reminder } from "@/lib/communications";

// Characterization tests for the collections logic extracted from
// CollectionsClient. Fixtures are minimal partials cast to the domain types.

type Source = CollectionCustomerGroup["sources"][number];

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    source_type: "order",
    source_id: "o1",
    business_domain: "sales",
    pending_payments: [],
    actionable_amount: 0,
    ...overrides,
  } as unknown as Source;
}

function makeGroup(overrides: Partial<CollectionCustomerGroup> = {}): CollectionCustomerGroup {
  const outstanding = overrides.outstanding_amount ?? 0;
  return {
    customer_id: "c1",
    customer_name: "לקוח",
    customer_phone: null,
    customer_whatsapp: null,
    outstanding_amount: outstanding,
    overdue_amount: 0,
    pending_amount: 0,
    // Defaults to the outstanding amount (money due now) unless a test overrides
    // it to exercise the "future-only, not actionable" case explicitly.
    actionable_amount: outstanding,
    next_due_date: null,
    last_contact_at: null,
    oldest_days_late: 0,
    status: "unpaid",
    sources: [],
    aging: { d30: 0, d60: 0, d90: 0, d90plus: 0 },
    ...overrides,
  } as unknown as CollectionCustomerGroup;
}

describe("daysSince (deterministic with a fixed reference date)", () => {
  it("daysSince: counts whole days, floors future at 0, null for empty", () => {
    const now = new Date("2024-05-10T12:00:00Z");
    expect(daysSince("2024-05-01", now)).toBe(9);
    expect(daysSince("2024-05-20", now)).toBe(0);
    expect(daysSince(null, now)).toBeNull();
  });
});

describe("whatsappLink — Israeli number normalization", () => {
  it("converts a leading 0 to the 972 country code", () => {
    expect(whatsappLink("050-123-4567", "hi")).toBe("https://wa.me/972501234567?text=hi");
  });
  it("prefixes 972 when missing entirely", () => {
    expect(whatsappLink("501234567", "x")).toBe("https://wa.me/972501234567?text=x");
  });
  it("keeps an existing 972 prefix and url-encodes the message", () => {
    expect(whatsappLink("+972 50 1", "א ב")).toBe("https://wa.me/972501?text=%D7%90%20%D7%91");
  });
  it("returns null for empty/garbage numbers", () => {
    expect(whatsappLink(null, "x")).toBeNull();
    expect(whatsappLink("abc", "x")).toBeNull();
  });
});

describe("severityTint", () => {
  it("flags 90+ red, 60/90 amber, otherwise none", () => {
    expect(severityTint(makeGroup({ aging: { d30: 0, d60: 0, d90: 0, d90plus: 5 } } as Partial<CollectionCustomerGroup>))).toBe("bg-destructive/5");
    expect(severityTint(makeGroup({ aging: { d30: 0, d60: 3, d90: 0, d90plus: 0 } } as Partial<CollectionCustomerGroup>))).toBe("bg-warning/5");
    expect(severityTint(makeGroup())).toBe("");
  });
});

describe("overdueAgingBreakdown", () => {
  it("returns one exact-days entry when every late source shares the same day count", () => {
    const group = makeGroup({
      sources: [makeSource({ overdue_amount: 3, days_late: 5 }), makeSource({ overdue_amount: 7, days_late: 5 })],
    });
    expect(overdueAgingBreakdown(group)).toEqual([{ daysLate: 5, amount: 10 }]);
  });
  it("splits by EXACT days late (not a bucket range) when the debt spans different ages — e.g. mostly 3 days late, a bit 34 days late", () => {
    const group = makeGroup({
      sources: [
        makeSource({ source_id: "o1", overdue_amount: 48570, days_late: 3 }),
        makeSource({ source_id: "o2", overdue_amount: 6077, days_late: 34 }),
      ],
    });
    expect(overdueAgingBreakdown(group)).toEqual([
      { daysLate: 34, amount: 6077 },
      { daysLate: 3, amount: 48570 },
    ]);
  });
  it("ignores sources with nothing overdue and returns an empty list when nothing is late", () => {
    const group = makeGroup({ sources: [makeSource({ overdue_amount: 0, days_late: 0 })] });
    expect(overdueAgingBreakdown(group)).toEqual([]);
  });
});

describe("buildWaMessage / groupHasPendingCheck", () => {
  it("embeds the outstanding amount in the message", () => {
    expect(buildWaMessage(makeGroup({ outstanding_amount: 1500 }))).toContain("1,500");
  });
  it("detects a pending check among the sources", () => {
    const withCheck = makeGroup({
      sources: [makeSource({ pending_payments: [{ payment_method: "check" }] as unknown as Source["pending_payments"] })],
    });
    expect(groupHasPendingCheck(withCheck)).toBe(true);
    expect(groupHasPendingCheck(makeGroup({ sources: [makeSource()] }))).toBe(false);
  });
});

describe("flattenExpectedReceipts", () => {
  function pending(id: string, dueDate: string | null, method: string) {
    return { id, amount: 100, due_date: dueDate, payment_method: method, check_number: null, overdue: false };
  }
  it("flattens, skips loans, and sorts by earliest due date", () => {
    const customers = [
      makeGroup({
        customer_name: "א",
        sources: [
          makeSource({ source_type: "order", source_id: "o1", pending_payments: [pending("p2", "2024-06-01", "check")] as unknown as Source["pending_payments"] }),
          makeSource({ source_type: "loan", source_id: "L1", pending_payments: [pending("pl", "2024-01-01", "cash")] as unknown as Source["pending_payments"] }),
        ],
      }),
      makeGroup({
        customer_name: "ב",
        sources: [makeSource({ source_type: "project", source_id: "pr1", pending_payments: [pending("p1", "2024-05-01", "bank_transfer")] as unknown as Source["pending_payments"] })],
      }),
    ];
    const receipts = flattenExpectedReceipts(customers);
    expect(receipts.map((r) => r.paymentId)).toEqual(["p1", "p2"]); // loan skipped, sorted by due date
    expect(receipts[0].methodKey).toBe("bank_transfer");
    expect(receipts.every((r) => r.isScheduled)).toBe(true);
  });

  it("adds an unscheduled row for money that's not yet due but has nothing registered", () => {
    const customers = [
      makeGroup({
        customer_name: "ג",
        sources: [
          makeSource({
            source_type: "order",
            source_id: "o3",
            collection_key: "order:o3",
            pending_amount: 300,
            due_date: "2024-07-01",
            pending_payments: [pending("p3", "2024-06-15", "check")] as unknown as Source["pending_payments"],
          }),
        ],
      }),
    ];
    const receipts = flattenExpectedReceipts(customers);
    expect(receipts.map((r) => r.paymentId)).toEqual(["p3", "unscheduled:order:o3"]);
    expect(receipts[1]).toMatchObject({
      amount: 200, // pending_amount (300) minus the registered p3 (100)
      dueDate: "2024-07-01",
      methodKey: "unscheduled",
      isScheduled: false,
    });
    expect(receipts[0].isScheduled).toBe(true);
  });

  it("adds no unscheduled row when registered payments already cover the whole pending amount", () => {
    const customers = [
      makeGroup({
        sources: [
          makeSource({
            source_type: "order",
            source_id: "o4",
            collection_key: "order:o4",
            pending_amount: 100,
            pending_payments: [pending("p4", "2024-06-01", "check")] as unknown as Source["pending_payments"],
          }),
        ],
      }),
    ];
    expect(flattenExpectedReceipts(customers).map((r) => r.paymentId)).toEqual(["p4"]);
  });
});

describe("buildDomainOptions / presentReceiptMethodChips", () => {
  it("returns distinct domains with labels", () => {
    const opts = buildDomainOptions([
      makeGroup({ sources: [makeSource({ business_domain: "sales" }), makeSource({ business_domain: "sales" })] }),
      makeGroup({ sources: [makeSource({ business_domain: "logistics_projects" })] }),
    ]);
    expect(opts.map((o) => o.value)).toEqual(["sales", "logistics_projects"]);
  });
  it("only shows method chips present in the data, plus 'all'", () => {
    const chips = presentReceiptMethodChips([
      { methodKey: "check" } as never,
      { methodKey: "cash" } as never,
    ]);
    expect(chips.map((c) => c.key)).toEqual(["all", "check", "cash"]);
  });
});

describe("parseInitialView / parseInitialFilter", () => {
  it("accepts known values and defaults unknown ones", () => {
    expect(parseInitialView("debtors")).toBe("debtors");
    expect(parseInitialView("garbage")).toBe("activity");
    expect(parseInitialView(null)).toBe("activity");
    expect(parseInitialFilter("overdue")).toBe("overdue");
    expect(parseInitialFilter("xxx")).toBe("all");
  });
});

describe("filterAndSortDebtors", () => {
  const base = { filter: "all" as const, search: "", domain: "all", sort: "amount" as const };
  const a = makeGroup({ customer_id: "a", customer_name: "אבי", customer_phone: "050", outstanding_amount: 100, overdue_amount: 50, oldest_days_late: 5, next_due_date: "2024-05-20" });
  const b = makeGroup({ customer_id: "b", customer_name: "בני", outstanding_amount: 900, pending_amount: 30, oldest_days_late: 2, last_contact_at: "2024-04-01", next_due_date: "2024-05-10", sources: [makeSource({ business_domain: "logistics_projects" })] });

  it("excludes a debtor whose whole balance is future/not-yet-due, even under filter=all", () => {
    // e.g. a tenant with next month's rent already scheduled but nothing due now —
    // outstanding_amount > 0 but actionable_amount is 0, so they don't belong in
    // the action list at all (that money lives in תקבולים צפויים instead).
    const futureOnly = makeGroup({
      customer_id: "c",
      customer_name: "גימל",
      outstanding_amount: 500,
      actionable_amount: 0,
    });
    expect(filterAndSortDebtors([a, b, futureOnly], base).map((g) => g.customer_id)).toEqual(["b", "a"]);
  });
  it("filter=overdue keeps only debtors with overdue debt", () => {
    expect(filterAndSortDebtors([a, b], { ...base, filter: "overdue" }).map((g) => g.customer_id)).toEqual(["a"]);
  });
  it("filter=uncontacted excludes debtors with a last_contact_at", () => {
    expect(filterAndSortDebtors([a, b], { ...base, filter: "uncontacted" }).map((g) => g.customer_id)).toEqual(["a"]);
  });
  it("domain filter matches a source business_domain", () => {
    expect(filterAndSortDebtors([a, b], { ...base, domain: "logistics_projects" }).map((g) => g.customer_id)).toEqual(["b"]);
  });
  it("search matches name or phone", () => {
    expect(filterAndSortDebtors([a, b], { ...base, search: "אב" }).map((g) => g.customer_id)).toEqual(["a"]);
    expect(filterAndSortDebtors([a, b], { ...base, search: "050" }).map((g) => g.customer_id)).toEqual(["a"]);
  });
  it("sorts by amount desc (default), name, and due date", () => {
    expect(filterAndSortDebtors([a, b], base).map((g) => g.customer_id)).toEqual(["b", "a"]);
    expect(filterAndSortDebtors([a, b], { ...base, sort: "name" }).map((g) => g.customer_id)).toEqual(["a", "b"]);
    expect(filterAndSortDebtors([a, b], { ...base, sort: "due" }).map((g) => g.customer_id)).toEqual(["b", "a"]);
  });
});

describe("groupReminders", () => {
  function reminder(id: string, day: string): Reminder {
    return { id, remind_at: `${day}T09:00:00Z` } as unknown as Reminder;
  }
  it("buckets by remind_at day relative to today", () => {
    const groups = groupReminders(
      [reminder("past", "2024-04-30"), reminder("now", "2024-05-01"), reminder("future", "2024-05-10")],
      "2024-05-01"
    );
    expect(groups.overdue.map((r) => r.id)).toEqual(["past"]);
    expect(groups.today.map((r) => r.id)).toEqual(["now"]);
    expect(groups.upcoming.map((r) => r.id)).toEqual(["future"]);
  });
});

describe("filterExpectedReceipts", () => {
  const r = (over: Partial<import("@/app/(app)/collections/CollectionsClient.helpers").ExpectedReceipt>) =>
    ({ paymentId: "p", amount: 1, dueDate: "2024-05-15", methodKey: "check", methodRaw: "check", checkNumber: "12", overdue: false, customerId: "c", customerName: "לקוח", customerPhone: "050", sourceType: "order", sourceId: "o", ...over }) as import("@/app/(app)/collections/CollectionsClient.helpers").ExpectedReceipt;
  const all = { method: "all", from: "", to: "", search: "" };

  it("filters by method", () => {
    const list = [r({ paymentId: "a", methodKey: "check" }), r({ paymentId: "b", methodKey: "cash" })];
    expect(filterExpectedReceipts(list, { ...all, method: "cash" }).map((x) => x.paymentId)).toEqual(["b"]);
  });
  it("filters by due-date range", () => {
    const list = [r({ paymentId: "a", dueDate: "2024-05-01" }), r({ paymentId: "b", dueDate: "2024-05-31" })];
    expect(filterExpectedReceipts(list, { ...all, from: "2024-05-15", to: "" }).map((x) => x.paymentId)).toEqual(["b"]);
  });
  it("searches name / phone / check number", () => {
    const list = [r({ paymentId: "a", checkNumber: "999" }), r({ paymentId: "b", checkNumber: "111" })];
    expect(filterExpectedReceipts(list, { ...all, search: "999" }).map((x) => x.paymentId)).toEqual(["a"]);
  });
});
