import { describe, expect, it } from "vitest";
import { buildPaymentsSummary } from "@/lib/dashboard/money-cards";

// The dashboard's payments card comes out the same whatever order its items
// were read in (the morning comparison, 2026-10-09: the server and the owner's
// phone listed two bills of the same day — VAT and income tax — and two
// salaries the other way round). Every list: by date, then by id; today's by
// amount, then by id.

type Item = Parameters<typeof buildPaymentsSummary>[0] extends infer C
  ? C extends { items: Array<infer I> } | null
    ? I
    : never
  : never;

const item = (id: string, date: string, amount = 100): Item =>
  ({ id, date, amount, stage: "scheduled", autoPaid: false, recurringTemplateId: null }) as unknown as Item;

const TODAY = "2026-10-09";
const items = [
  item("recur_proj:b:2026-09", "2026-09-15"),
  item("recur_proj:a:2026-09", "2026-09-15"),
  item("expense:z", "2026-09-01"),
  item("salary_proj:y:2026-10", "2026-10-10"),
  item("salary_proj:x:2026-10", "2026-10-10"),
  item("today:2", TODAY, 50),
  item("today:1", TODAY, 50),
  item("today:big", TODAY, 900),
];

const summaryOf = (list: Item[]) =>
  buildPaymentsSummary({ items: list, todayIso: TODAY } as never, [], TODAY);

describe("the payments card's order", () => {
  it("is the same whatever order the items were read in", () => {
    const forward = summaryOf(items);
    const backward = summaryOf([...items].reverse());
    expect(backward).toEqual(forward);
    expect(forward.late.map((i) => i.id)).toEqual(["expense:z", "recur_proj:a:2026-09", "recur_proj:b:2026-09"]);
    expect(forward.upcoming.map((i) => i.id)).toEqual(["salary_proj:x:2026-10", "salary_proj:y:2026-10"]);
    expect(forward.today.map((i) => i.id)).toEqual(["today:big", "today:1", "today:2"]);
  });
});
