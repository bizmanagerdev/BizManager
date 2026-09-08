import { describe, it, expect } from "vitest";
import {
  formatOrderCommentTimestamp,
  parseOrderComments,
  appendOrderComment,
  serializeOrderComments,
  findOrderCommentIndex,
  type OrderComment,
} from "@/lib/orders/comments";

describe("formatOrderCommentTimestamp", () => {
  it("renders a short Israel-local DD/MM/YYYY HH:MM-shaped timestamp", () => {
    const text = formatOrderCommentTimestamp(new Date("2026-07-24T09:26:00Z"));
    expect(text).toContain("2026");
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("appendOrderComment", () => {
  it("becomes the whole notes string when there were none before", () => {
    const notes = appendOrderComment(null, { author_name: "יעקב", created_at: "24.07.2026, 12:26", body: "התקשרתי ללקוח" });
    expect(notes).toBe("יעקב · 24.07.2026, 12:26\nהתקשרתי ללקוח");
  });
  it("appends after the separator when there's an existing note", () => {
    const notes = appendOrderComment("הערה ישנה", {
      author_name: "דנה",
      created_at: "25.07.2026, 08:00",
      body: "עדכון",
    });
    expect(notes).toBe("הערה ישנה\n―――\nדנה · 25.07.2026, 08:00\nעדכון");
  });
  it("defaults a blank author to 'משתמש'", () => {
    const notes = appendOrderComment(null, { author_name: null, created_at: "01.01.2026, 00:00", body: "x" });
    expect(notes).toContain("משתמש ·");
  });
});

describe("parseOrderComments", () => {
  it("empty/null/whitespace notes parse to []", () => {
    expect(parseOrderComments(null)).toEqual([]);
    expect(parseOrderComments(undefined)).toEqual([]);
    expect(parseOrderComments("   ")).toEqual([]);
  });

  it("a legacy plain note with no header parses as one unattributed comment", () => {
    expect(parseOrderComments("הזמנה דחופה, לתאם עם הלקוח")).toEqual([
      { author_name: null, created_at: null, body: "הזמנה דחופה, לתאם עם הלקוח" },
    ]);
  });

  it("parses a single attributed comment, splitting the header from the body", () => {
    const parsed = parseOrderComments("יעקב · 24.07.2026, 12:26\nהתקשרתי ללקוח");
    expect(parsed).toEqual([{ author_name: "יעקב", created_at: "24.07.2026, 12:26", body: "התקשרתי ללקוח" }]);
  });

  it("accepts DOT-separated dates, not just slashes (he-IL formats with dots)", () => {
    const parsed = parseOrderComments("יעקב · 24.07.2026, 12:26\nגוף ההודעה");
    expect(parsed[0].created_at).toBe("24.07.2026, 12:26");
  });
  it("accepts slash- and dash-separated dates too", () => {
    expect(parseOrderComments("יעקב · 24/07/2026 12:26\nx")[0].created_at).toBe("24/07/2026 12:26");
    expect(parseOrderComments("יעקב · 24-07-2026 12:26\nx")[0].created_at).toBe("24-07-2026 12:26");
  });

  it("parses several comments joined by the separator, oldest to newest", () => {
    const notes = "הערה ישנה בלי כותרת\n―――\nדנה · 25.07.2026, 08:00\nעדכון ראשון\n―――\nיעקב · 26.07.2026, 09:00\nעדכון שני";
    const parsed = parseOrderComments(notes);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ author_name: null, created_at: null, body: "הערה ישנה בלי כותרת" });
    expect(parsed[1]).toMatchObject({ author_name: "דנה", body: "עדכון ראשון" });
    expect(parsed[2]).toMatchObject({ author_name: "יעקב", body: "עדכון שני" });
  });

  it("drops a genuinely empty block (no author, no body)", () => {
    const parsed = parseOrderComments("יעקב · 24.07.2026, 12:26\nתוכן\n―――\n   ");
    expect(parsed).toHaveLength(1);
  });
});

describe("round-trip: append -> parse -> serialize is stable", () => {
  it("appending several comments and re-parsing recovers them exactly", () => {
    let notes: string | null = null;
    notes = appendOrderComment(notes, { author_name: "יעקב", created_at: "24.07.2026, 12:00", body: "ראשון" });
    notes = appendOrderComment(notes, { author_name: "דנה", created_at: "24.07.2026, 13:00", body: "שני" });

    const parsed = parseOrderComments(notes);
    expect(parsed).toEqual([
      { author_name: "יעקב", created_at: "24.07.2026, 12:00", body: "ראשון" },
      { author_name: "דנה", created_at: "24.07.2026, 13:00", body: "שני" },
    ]);

    // serializeOrderComments is the inverse of parseOrderComments — parsing its
    // own output must reproduce the same list (what the edit dialog relies on).
    const reserialized = serializeOrderComments(parsed);
    expect(parseOrderComments(reserialized)).toEqual(parsed);
  });

  it("serializeOrderComments drops a comment that's genuinely empty (no header, no body)", () => {
    const comments: OrderComment[] = [
      { author_name: "יעקב", created_at: "24.07.2026, 12:00", body: "תוכן" },
      { author_name: null, created_at: null, body: "" },
    ];
    const serialized = serializeOrderComments(comments);
    expect(parseOrderComments(serialized)).toHaveLength(1);
  });
});

describe("findOrderCommentIndex", () => {
  const comments: OrderComment[] = [
    { author_name: "יעקב", created_at: "24.07.2026, 12:00", body: "ראשון" },
    { author_name: "דנה", created_at: "24.07.2026, 13:00", body: "שני" },
  ];

  it("finds a comment by content (author+timestamp+body), not by array position", () => {
    expect(findOrderCommentIndex(comments, comments[1])).toBe(1);
  });
  it("-1 when the comment is no longer present (already deleted/edited elsewhere)", () => {
    expect(
      findOrderCommentIndex(comments, { author_name: "מישהו אחר", created_at: "x", body: "y" })
    ).toBe(-1);
  });
});
