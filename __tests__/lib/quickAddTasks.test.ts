import { describe, it, expect } from "vitest";
import { parseTaskLines } from "@/components/tasks/QuickAddTasksDialog.helpers";

describe("parseTaskLines", () => {
  it("makes one task per line", () => {
    expect(parseTaskLines("לבדוק את הדירה\nלדבר עם הקבלן\nלתקן את האמבטיה")).toEqual([
      "לבדוק את הדירה",
      "לדבר עם הקבלן",
      "לתקן את האמבטיה",
    ]);
  });

  it("drops blank lines and trims — dictation and pasting leave both", () => {
    expect(parseTaskLines("  לבדוק את הדירה  \n\n\n   \nלדבר עם הקבלן\n")).toEqual([
      "לבדוק את הדירה",
      "לדבר עם הקבלן",
    ]);
  });

  it("strips list markers rather than creating a task called '1. …'", () => {
    expect(parseTaskLines("1. לבדוק את הדירה\n2) לדבר עם הקבלן\n- לתקן\n• לאסוף\n* לסדר")).toEqual([
      "לבדוק את הדירה",
      "לדבר עם הקבלן",
      "לתקן",
      "לאסוף",
      "לסדר",
    ]);
  });

  it("keeps text that only LOOKS like a marker", () => {
    // A subject may legitimately start with a number or contain a dash — only a
    // marker followed by a space is stripped.
    expect(parseTaskLines("2 דירות לבדוק\nלתקן מזגן - דחוף\n3.5 שעות עבודה")).toEqual([
      "2 דירות לבדוק",
      "לתקן מזגן - דחוף",
      "3.5 שעות עבודה",
    ]);
  });

  it("returns nothing for empty/whitespace input", () => {
    expect(parseTaskLines("")).toEqual([]);
    expect(parseTaskLines("   \n\n  ")).toEqual([]);
  });
});
