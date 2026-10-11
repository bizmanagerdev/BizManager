import { describe, it, expect } from "vitest";
import { earliestReminderByTask, isTaskWaitingForLater, taskShowsFromDate } from "@/lib/tasks/visibility";

// Noon in Israel on 2026-10-04.
const NOW = new Date("2026-10-04T09:00:00.000Z");

describe("isTaskWaitingForLater — far-future tasks wait until their time", () => {
  it("a to-do due more than a week out, with no reminder, waits", () => {
    expect(isTaskWaitingForLater({ status: "todo", dueDate: "2026-11-10", nextReminderAt: null, now: NOW })).toBe(true);
  });

  it("…and shows from a week before it's due", () => {
    expect(isTaskWaitingForLater({ status: "todo", dueDate: "2026-10-11", nextReminderAt: null, now: NOW })).toBe(false);
    expect(isTaskWaitingForLater({ status: "todo", dueDate: "2026-10-12", nextReminderAt: null, now: NOW })).toBe(true);
  });

  it("a reminder still to come keeps it waiting; once the reminder time arrives it shows", () => {
    const due = "2027-03-01";
    expect(isTaskWaitingForLater({ status: "todo", dueDate: due, nextReminderAt: "2026-12-01T07:00:00.000Z", now: NOW })).toBe(true);
    expect(isTaskWaitingForLater({ status: "todo", dueDate: due, nextReminderAt: "2026-10-04T08:00:00.000Z", now: NOW })).toBe(false);
  });

  it("a reminder later than a-week-before-due doesn't hold it back past that point", () => {
    // Due in 5 days, reminder in 6 days → due soon, so it shows.
    expect(isTaskWaitingForLater({ status: "todo", dueDate: "2026-10-09", nextReminderAt: "2026-10-10T07:00:00.000Z", now: NOW })).toBe(false);
  });

  it("only to-do waits — started, blocked and done tasks always show", () => {
    for (const status of ["in_progress", "blocked", "done"]) {
      expect(isTaskWaitingForLater({ status, dueDate: "2027-06-01", nextReminderAt: null, now: NOW })).toBe(false);
    }
    // Legacy null status is to-do.
    expect(isTaskWaitingForLater({ status: null, dueDate: "2027-06-01", nextReminderAt: null, now: NOW })).toBe(true);
  });

  it("no due date → always shows; overdue → always shows", () => {
    expect(isTaskWaitingForLater({ status: "todo", dueDate: null, nextReminderAt: null, now: NOW })).toBe(false);
    expect(isTaskWaitingForLater({ status: "todo", dueDate: "2026-01-01", nextReminderAt: null, now: NOW })).toBe(false);
  });
});

describe("taskShowsFromDate", () => {
  it("is null for a task that shows now", () => {
    expect(taskShowsFromDate({ status: "todo", dueDate: "2026-10-08", nextReminderAt: null, now: NOW })).toBeNull();
  });
  it("is a week before the due date without a reminder", () => {
    expect(taskShowsFromDate({ status: "todo", dueDate: "2027-01-31", nextReminderAt: null, now: NOW })).toBe("2027-01-24");
  });
  it("a rent task due 1/12 with a reminder on 29/11 shows from 24/11, not 1/11 (2026-10-11)", () => {
    expect(
      taskShowsFromDate({ status: "todo", dueDate: "2026-12-01", nextReminderAt: "2026-11-29T07:00:00.000Z", now: NOW })
    ).toBe("2026-11-24");
  });
  it("is the reminder's (Israel) day when that comes sooner", () => {
    // 23:30 UTC on Nov 30 is already Dec 1 in Israel.
    expect(
      taskShowsFromDate({ status: "todo", dueDate: "2027-03-01", nextReminderAt: "2026-11-30T23:30:00.000Z", now: NOW })
    ).toBe("2026-12-01");
  });
});

describe("earliestReminderByTask", () => {
  it("keeps the earliest reminder per task and skips incomplete rows", () => {
    const map = earliestReminderByTask([
      { task_id: "a", remind_at: "2026-12-01T07:00:00.000Z" },
      { task_id: "a", remind_at: "2026-11-01T07:00:00.000Z" },
      { task_id: "b", remind_at: "2026-10-10T07:00:00.000Z" },
      { task_id: null, remind_at: "2026-10-10T07:00:00.000Z" },
      { task_id: "c" },
    ]);
    expect(Object.fromEntries(map)).toEqual({
      a: "2026-11-01T07:00:00.000Z",
      b: "2026-10-10T07:00:00.000Z",
    });
  });
});
