import { describe, it, expect } from "vitest";
import { ordersHe, projectsHe } from "@/lib/i18n/pluralHe";

// The customers list's cards said "1 פרויקטים" (2026-10-13). One wording for
// both customer pages: Hebrew's own words for one and two.

describe("counted orders and projects", () => {
  it("one and two in words, more with the numeral", () => {
    expect(projectsHe(1)).toBe("פרויקט אחד");
    expect(projectsHe(2)).toBe("2 פרויקטים");
    expect(projectsHe(7)).toBe("7 פרויקטים");
    expect(ordersHe(1)).toBe("הזמנה אחת");
    expect(ordersHe(2)).toBe("2 הזמנות");
    expect(ordersHe(12)).toBe("12 הזמנות");
  });
});
