import { describe, it, expect } from "vitest";
import { computeDefaultSortOrder, computeInsertSortOrder } from "@/lib/tasks/sortOrder";

const NOW = new Date("2026-08-26T12:00:00.000Z");

describe("computeDefaultSortOrder — default board position for a new task", () => {
  it("a todo task with no due date goes above whatever is currently on top", () => {
    const value = computeDefaultSortOrder({ status: "todo", dueDate: null, currentMinInColumn: 500, now: NOW });
    expect(value).toBeLessThan(500);
  });

  it("an empty todo column just gets some value (nothing to be above)", () => {
    const value = computeDefaultSortOrder({ status: "todo", dueDate: null, currentMinInColumn: null, now: NOW });
    expect(Number.isFinite(value)).toBe(true);
  });

  it("a todo due date this year sorts chronologically, ignoring the column's current top", () => {
    const dueSoon = computeDefaultSortOrder({ status: "todo", dueDate: "2026-09-01", currentMinInColumn: 999999999999, now: NOW });
    const dueLater = computeDefaultSortOrder({ status: "todo", dueDate: "2026-12-01", currentMinInColumn: 999999999999, now: NOW });
    expect(dueSoon).toBeLessThan(dueLater);
  });

  it("an overdue (past) due date still sorts by that date, ahead of future ones", () => {
    const overdue = computeDefaultSortOrder({ status: "todo", dueDate: "2026-01-01", currentMinInColumn: null, now: NOW });
    const dueSoon = computeDefaultSortOrder({ status: "todo", dueDate: "2026-09-01", currentMinInColumn: null, now: NOW });
    expect(overdue).toBeLessThan(dueSoon);
  });

  it("a todo due date next year is pushed to the end, even 'sooner' than a distant this-year date", () => {
    const nextYearSoon = computeDefaultSortOrder({ status: "todo", dueDate: "2027-01-05", currentMinInColumn: null, now: NOW });
    const thisYearFar = computeDefaultSortOrder({ status: "todo", dueDate: "2026-12-31", currentMinInColumn: null, now: NOW });
    expect(nextYearSoon).toBeGreaterThan(thisYearFar);
  });

  it("two next-year todo tasks still order chronologically among themselves", () => {
    const earlierNextYear = computeDefaultSortOrder({ status: "todo", dueDate: "2027-02-01", currentMinInColumn: null, now: NOW });
    const laterNextYear = computeDefaultSortOrder({ status: "todo", dueDate: "2027-06-01", currentMinInColumn: null, now: NOW });
    expect(earlierNextYear).toBeLessThan(laterNextYear);
  });

  it("a non-todo column (done/in_progress/blocked) ignores the due date entirely — always goes to the top", () => {
    // Even a far-future due date must NOT push this to the end outside todo —
    // done/in_progress/blocked are plain "order added" lists.
    const value = computeDefaultSortOrder({ status: "done", dueDate: "2027-01-01", currentMinInColumn: 500, now: NOW });
    expect(value).toBeLessThan(500);
  });

  it("null status is treated as todo (legacy convention)", () => {
    const withNull = computeDefaultSortOrder({ status: null, dueDate: "2027-01-01", currentMinInColumn: 500, now: NOW });
    const withTodo = computeDefaultSortOrder({ status: "todo", dueDate: "2027-01-01", currentMinInColumn: 500, now: NOW });
    expect(withNull).toBe(withTodo);
  });
});

describe("computeInsertSortOrder — fractional-index drag drop / top-of-list insert", () => {
  it("drops between two neighbors at their midpoint", () => {
    expect(computeInsertSortOrder(10, 20)).toBe(15);
  });

  it("no 'before' neighbor (insert at the top) sorts ahead of the 'after' value", () => {
    const value = computeInsertSortOrder(null, 100);
    expect(value).toBeLessThan(100);
  });

  it("no 'after' neighbor (insert at the bottom) sorts behind the 'before' value", () => {
    const value = computeInsertSortOrder(100, null);
    expect(value).toBeGreaterThan(100);
  });

  it("repeated top-inserts keep climbing above the previous one", () => {
    const first = computeInsertSortOrder(null, 10);
    const second = computeInsertSortOrder(null, first);
    expect(second).toBeLessThan(first);
    expect(first).toBeLessThan(10);
  });
});
