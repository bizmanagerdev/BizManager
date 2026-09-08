import { describe, it, expect } from "vitest";
import { elevatorToBool, boolToElevator, EMPTY_MOVING_ENDPOINT } from "@/components/projects/MovingAddressFields";

describe("elevatorToBool", () => {
  it("maps yes/no to true/false", () => {
    expect(elevatorToBool("yes")).toBe(true);
    expect(elevatorToBool("no")).toBe(false);
  });
  it("maps the unspecified state to null, not false", () => {
    expect(elevatorToBool("")).toBeNull();
  });
});

describe("boolToElevator — the exact inverse of elevatorToBool", () => {
  it("round-trips every state through both directions", () => {
    for (const v of ["yes", "no", ""] as const) {
      expect(boolToElevator(elevatorToBool(v))).toBe(v);
    }
  });
  it("null and undefined both map to the unspecified state", () => {
    expect(boolToElevator(null)).toBe("");
    expect(boolToElevator(undefined)).toBe("");
  });
});

describe("EMPTY_MOVING_ENDPOINT", () => {
  it("is a genuinely blank endpoint", () => {
    expect(EMPTY_MOVING_ENDPOINT).toEqual({ address: "", floor: "", hasElevator: "" });
  });
});
