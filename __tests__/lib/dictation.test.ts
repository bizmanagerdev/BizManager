import { describe, it, expect } from "vitest";
import { appendDictatedText } from "@/lib/dictation";

describe("appendDictatedText — prose fields (notes, comments, descriptions)", () => {
  it("joins onto existing text as a continuing sentence, not a new line", () => {
    expect(appendDictatedText("הלקוח התקשר היום", "ואמר שישלם עד יום שישי")).toBe(
      "הלקוח התקשר היום ואמר שישלם עד יום שישי"
    );
  });

  it("first dictation into an empty field doesn't leave a leading space", () => {
    expect(appendDictatedText("", "הלקוח התקשר היום")).toBe("הלקוח התקשר היום");
    expect(appendDictatedText("   ", "הלקוח התקשר היום")).toBe("הלקוח התקשר היום");
  });

  it("a dictation with nothing usable leaves the text untouched", () => {
    expect(appendDictatedText("הלקוח התקשר", "  ")).toBe("הלקוח התקשר");
  });

  it("trims trailing whitespace off the existing text before joining", () => {
    expect(appendDictatedText("הלקוח התקשר   \n", "ואמר תודה")).toBe("הלקוח התקשר ואמר תודה");
  });
});
