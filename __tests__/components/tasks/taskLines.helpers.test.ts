import { describe, it, expect } from "vitest";
import {
  appendDictatedLines,
  isMultiLineSubject,
  parseTaskLines,
  splitDictationToLines,
} from "@/components/tasks/taskLines.helpers";

describe("splitDictationToLines — say the whole list in one recording", () => {
  it("splits one spoken sentence into one line per task", () => {
    // What the transcriber actually returns for a dictated list.
    expect(splitDictationToLines("לבדוק את הדירה, לדבר עם הקבלן, לתקן את האמבטיה.")).toEqual([
      "לבדוק את הדירה",
      "לדבר עם הקבלן",
      "לתקן את האמבטיה",
    ]);
  });

  it("does NOT split a decimal — '3.5 שעות' is one task, not two", () => {
    expect(splitDictationToLines("לרשום 3.5 שעות")).toEqual(["לרשום 3.5 שעות"]);
  });

  it("handles semicolons, newlines and stray spacing", () => {
    expect(splitDictationToLines("לבדוק ; לדבר \n לתקן")).toEqual(["לבדוק", "לדבר", "לתקן"]);
  });

  it("a single dictated task stays one line", () => {
    expect(splitDictationToLines("לבדוק את הדירה")).toEqual(["לבדוק את הדירה"]);
  });

  it("empty/punctuation-only dictation adds nothing", () => {
    expect(splitDictationToLines("")).toEqual([]);
    expect(splitDictationToLines("  . , ")).toEqual([]);
  });
});

describe("appendDictatedLines", () => {
  it("appends to existing text on new lines, not joined into it", () => {
    expect(appendDictatedLines("לבדוק את הדירה", "לדבר עם הקבלן, לתקן")).toBe(
      "לבדוק את הדירה\nלדבר עם הקבלן\nלתקן"
    );
  });

  it("first dictation into an empty field doesn't leave a leading blank line", () => {
    expect(appendDictatedLines("", "לבדוק, לדבר")).toBe("לבדוק\nלדבר");
    expect(appendDictatedLines("   ", "לבדוק")).toBe("לבדוק");
  });

  it("a dictation with nothing usable leaves the text untouched", () => {
    expect(appendDictatedLines("לבדוק", "  ")).toBe("לבדוק");
  });
});

describe("isMultiLineSubject — decides whether we ask 'five tasks or one?'", () => {
  it("a normal name is not a list, so we must not interrupt", () => {
    expect(isMultiLineSubject("לבדוק את הדירה")).toBe(false);
    expect(isMultiLineSubject("  לבדוק את הדירה\n\n  ")).toBe(false); // trailing newlines only
    expect(isMultiLineSubject("")).toBe(false);
  });

  it("several real lines is a list", () => {
    expect(isMultiLineSubject("לבדוק את הדירה\nלדבר עם הקבלן")).toBe(true);
  });
});

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
