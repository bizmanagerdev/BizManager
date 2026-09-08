import { describe, it, expect } from "vitest";
import { promiseStatusLabel } from "@/lib/promises";

describe("promiseStatusLabel", () => {
  it("labels every known status", () => {
    expect(promiseStatusLabel("kept")).toBe("קוימה");
    expect(promiseStatusLabel("broken")).toBe("הופרה");
    expect(promiseStatusLabel("cancelled")).toBe("בוטלה");
  });
  it("defaults to pending wording for 'pending' and anything unrecognized", () => {
    expect(promiseStatusLabel("pending")).toBe("ממתינה");
    expect(promiseStatusLabel("weird")).toBe("ממתינה");
  });
});
