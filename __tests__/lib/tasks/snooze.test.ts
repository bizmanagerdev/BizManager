import { describe, it, expect } from "vitest";
import { israelDateAfter, israelMorning, snoozedTasks } from "@/lib/tasks/snooze";
import { pingAgainAt } from "@/lib/reminders/ping-again";

// "לטיפול בהמשך": a snoozed task comes back at 08:00 Israel time on its day,
// whatever the season; the person's own snoozes still ahead are what hide a
// task; and a reminder moved later or snoozed pushes again.

describe("israelMorning / israelDateAfter", () => {
  it("08:00 in Israel, summer (UTC+3) and winter (UTC+2)", () => {
    expect(israelMorning("2026-07-15")).toBe("2026-07-15T05:00:00.000Z");
    expect(israelMorning("2026-12-15")).toBe("2026-12-15T06:00:00.000Z");
  });

  it("days from Israel's today — after midnight Israel time it's already the next day", () => {
    expect(israelDateAfter(1, new Date("2026-10-09T10:00:00Z"))).toBe("2026-10-10");
    expect(israelDateAfter(30, new Date("2026-10-09T22:30:00Z"))).toBe("2026-11-09"); // 01:30 on the 10th in Israel
  });
});

describe("snoozedTasks", () => {
  const supabaseWith = (answer: { data: unknown; error: unknown }) => {
    const calls: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gt", "range"]) {
      builder[m] = (...args: unknown[]) => {
        calls.push([m, args]);
        return m === "range" ? Promise.resolve(answer) : builder;
      };
    }
    return { supabase: { from: () => builder } as never, calls };
  };

  it("the person's snoozes still ahead, task → until", async () => {
    const { supabase, calls } = supabaseWith({ data: [{ task_id: "t1", until: "2026-12-01T06:00:00Z" }], error: null });
    const map = await snoozedTasks(supabase, "u1", new Date("2026-10-09T10:00:00Z"));
    expect([...map]).toEqual([["t1", "2026-12-01T06:00:00Z"]]);
    expect(calls).toContainEqual(["eq", ["user_id", "u1"]]);
    expect(calls).toContainEqual(["gt", ["until", "2026-10-09T10:00:00.000Z"]]);
  });

  it("nothing hidden when the snoozes can't be read (the table isn't there yet)", async () => {
    const { supabase } = supabaseWith({ data: null, error: { message: 'relation "task_snoozes" does not exist' } });
    expect((await snoozedTasks(supabase, "u1")).size).toBe(0);
    expect((await snoozedTasks(supabase, null)).size).toBe(0);
  });
});

describe("pingAgainAt", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  it("a time still ahead clears the sent mark; a past or missing one doesn't", () => {
    expect(pingAgainAt("2026-10-09T12:00:00Z", now)).toEqual({ notified_at: null });
    expect(pingAgainAt("2026-10-09T09:00:00Z", now)).toEqual({});
    expect(pingAgainAt("", now)).toEqual({});
    expect(pingAgainAt(undefined, now)).toEqual({});
  });
});
