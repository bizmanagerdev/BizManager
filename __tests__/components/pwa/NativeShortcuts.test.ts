import { describe, expect, it } from "vitest";
import { shortcutsFor } from "@/components/pwa/NativeShortcuts";
import { DEFAULT_SECTION_ACCESS } from "@/lib/auth/sections";

// The phone app's long-press shortcuts, per person (APK 1.2).

const ids = (list: ReturnType<typeof shortcutsFor>) => list.map((s) => s.id);

describe("shortcutsFor", () => {
  it("staff: deliveries, new order, new task, new expense — the 4 Android shows", () => {
    const list = shortcutsFor("admin", "he", DEFAULT_SECTION_ACCESS);
    expect(ids(list)).toEqual(["deliveries", "new-order", "new-task", "new-expense"]);
    expect(list.find((s) => s.id === "new-expense")).toEqual({
      id: "new-expense",
      label: "הוצאה חדשה",
      url: "/dashboard?quick=expense",
      icon: "expense",
    });
    expect(ids(shortcutsFor("office", "he", DEFAULT_SECTION_ACCESS))).toEqual(ids(list));
  });

  it("a worker: only what he can do (no order, no expense, no search)", () => {
    const list = shortcutsFor("worker", "he", { ...DEFAULT_SECTION_ACCESS, deliveries: true });
    expect(ids(list)).toEqual(["deliveries", "new-task", "new-reminder"]);
  });

  it("an Arabic-reading worker: no deliveries (that page is Hebrew-only), Arabic labels", () => {
    const list = shortcutsFor("worker", "ar", { ...DEFAULT_SECTION_ACCESS, deliveries: true });
    expect(ids(list)).toEqual(["new-task", "new-reminder"]);
    expect(list[0].label).toBe("مهمة جديدة");
  });
});
