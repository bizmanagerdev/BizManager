import { describe, expect, it } from "vitest";
import {
  applyMoneyKeystroke,
  formatMoney,
  formatMoneyRounded,
  groupMoneyDigits,
  stripMoneyGrouping,
} from "@/lib/money";

describe("formatMoney", () => {
  it("groups thousands and keeps decimals only when there are any", () => {
    expect(formatMoney(5000)).toBe("₪5,000");
    expect(formatMoney(1356.97)).toBe("₪1,356.97");
    expect(formatMoney("1200000")).toBe("₪1,200,000");
    expect(formatMoney(null)).toBe("₪0");
  });

  it("rounds to whole shekels on request", () => {
    expect(formatMoneyRounded(1356.97)).toBe("₪1,357");
  });
});

describe("stripMoneyGrouping", () => {
  it("keeps digits, one decimal point and a leading minus", () => {
    expect(stripMoneyGrouping("1,200,000")).toBe("1200000");
    expect(stripMoneyGrouping("₪1,200,000.50")).toBe("1200000.50");
    expect(stripMoneyGrouping("-4,500")).toBe("-4500");
    expect(stripMoneyGrouping("1,2,3.4.5")).toBe("123.45");
    expect(stripMoneyGrouping("abc")).toBe("");
  });

  it("keeps a lone minus so a negative amount can be typed sign-first", () => {
    expect(stripMoneyGrouping("-")).toBe("-");
  });
});

describe("groupMoneyDigits", () => {
  it("inserts separators without touching the decimals", () => {
    expect(groupMoneyDigits("1200000")).toBe("1,200,000");
    expect(groupMoneyDigits("1200000.5")).toBe("1,200,000.5");
    expect(groupMoneyDigits("-4500")).toBe("-4,500");
    expect(groupMoneyDigits("999")).toBe("999");
    expect(groupMoneyDigits("")).toBe("");
  });

  it("keeps the decimal point that was just typed", () => {
    expect(groupMoneyDigits("1200.")).toBe("1,200.");
  });
});

/** Types `keys` into a field one keystroke at a time, the way the component
 *  does: the field always shows the grouped text, the form stores the plain
 *  value. "\b" is a backspace. A multi-character key is a paste. */
function typeInto(keys: string[], startValue = "") {
  let value = stripMoneyGrouping(startValue);
  let display = groupMoneyDigits(value);
  let caret = display.length;

  for (const key of keys) {
    let typed: string;
    let domCaret: number;
    if (key === "\b") {
      if (caret === 0) continue;
      typed = display.slice(0, caret - 1) + display.slice(caret);
      domCaret = caret - 1;
    } else {
      typed = display.slice(0, caret) + key + display.slice(caret);
      domCaret = caret + key.length;
    }
    const next = applyMoneyKeystroke(display, typed, domCaret);
    value = next.value;
    display = groupMoneyDigits(value);
    caret = next.caret;
  }
  return { value, display, caret };
}

describe("applyMoneyKeystroke", () => {
  it("groups digits as they are typed and stores the plain value", () => {
    expect(typeInto([..."1200000"])).toMatchObject({ value: "1200000", display: "1,200,000" });
    expect(typeInto([..."1356.97"])).toMatchObject({ value: "1356.97", display: "1,356.97" });
    expect(typeInto([..."-200"])).toMatchObject({ value: "-200", display: "-200" });
    expect(typeInto([..."0"])).toMatchObject({ value: "0", display: "0" });
  });

  it("reads a typed comma as the decimal separator (Samsung Hebrew keypad)", () => {
    expect(typeInto([..."12,5"])).toMatchObject({ value: "12.5", display: "12.5" });
    expect(typeInto([..."12,50"])).toMatchObject({ value: "12.50", display: "12.50" });
  });

  it("does not mistake a separator it inserted itself for a typed comma", () => {
    // Backspacing a digit out of "1,200,000" must stay a deletion — the ",00"
    // left at the end is grouping, not a decimal point.
    expect(typeInto([...[..."1200000"], "\b"])).toMatchObject({
      value: "120000",
      display: "120,000",
    });
    expect(typeInto(["\b", "\b", "\b"], "1200000")).toMatchObject({
      value: "1200",
      display: "1,200",
    });
  });

  it("takes a pasted amount, separators and shekel sign included", () => {
    expect(typeInto(["₪1,200,000"])).toMatchObject({ value: "1200000", display: "1,200,000" });
    expect(typeInto(["1,200,000.50"])).toMatchObject({
      value: "1200000.50",
      display: "1,200,000.50",
    });
  });

  it("clears back to empty", () => {
    expect(typeInto([..."1234", "\b", "\b", "\b", "\b"])).toMatchObject({ value: "", display: "" });
  });

  it("puts the caret after the digit just typed, not at the end", () => {
    // "1|,200,000" + "5" → "15,200,000" with the caret between the 5 and the comma.
    expect(applyMoneyKeystroke("1,200,000", "15,200,000", 2)).toEqual({
      value: "15200000",
      caret: 2,
    });
    // A digit typed at the end lands after a freshly inserted separator.
    expect(applyMoneyKeystroke("999", "9990", 4)).toEqual({ value: "9990", caret: 5 });
  });

  it("keeps the value where it was for a keystroke that is not a number", () => {
    expect(applyMoneyKeystroke("1,200", "1,200a", 6)).toEqual({ value: "1200", caret: 5 });
  });
});
