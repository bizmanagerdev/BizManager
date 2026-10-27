import { describe, expect, it } from "vitest";
import { finishStop, nextOpen, parseDrive, type Drive, type DriveStop } from "@/lib/routes/drive";

// Driving a planned route: which stop comes next, what a stop's end records,
// and the drive kept on the phone.

function stop(key: string): DriveStop {
  return {
    key,
    kind: "delivery",
    name: key,
    phone: null,
    city: "ירושלים",
    address: "הרצל 5",
    orderIds: [`order-${key}`],
    collectOnDelivery: false,
    note: null,
    lat: 31.78,
    lng: 35.2,
    arrival: null,
  };
}

function drive(over: Partial<Drive> = {}): Drive {
  return {
    day: "2026-10-27",
    stops: ["a", "b", "c", "d"].map(stop),
    end: null,
    at: 0,
    outcome: {},
    confirmed: [],
    ...over,
  };
}

describe("nextOpen", () => {
  it("the next stop with nothing done", () => {
    expect(nextOpen(drive(), 0)).toBe(1);
    expect(nextOpen(drive({ outcome: { b: "delivered" } }), 0)).toBe(2);
  });

  it("past the end, a stop jumped over earlier", () => {
    expect(nextOpen(drive({ outcome: { a: "delivered", c: "delivered", d: "skipped" } }), 2)).toBe(1);
  });

  it("nothing left: the end of the route", () => {
    expect(nextOpen(drive({ outcome: { a: "delivered", b: "skipped", c: "done" } }), 3)).toBe(4);
  });
});

describe("finishStop", () => {
  it("records the stop's end and moves to the next stop", () => {
    const next = finishStop(drive({ at: 1 }), "skipped");
    expect(next.outcome).toEqual({ b: "skipped" });
    expect(next.at).toBe(2);
  });

  it("a stop gone back to, delivered this time", () => {
    const next = finishStop(drive({ at: 1, outcome: { a: "delivered", b: "skipped", c: "delivered", d: "delivered" } }), "delivered");
    expect(next.outcome.b).toBe("delivered");
    expect(next.at).toBe(4);
  });

  it("the last stop ends the stops", () => {
    expect(finishStop(drive({ at: 3, outcome: { a: "delivered", b: "delivered", c: "delivered" } }), "delivered").at).toBe(4);
  });

  it("past the end, changes nothing", () => {
    const done = drive({ at: 4 });
    expect(finishStop(done, "delivered")).toBe(done);
  });
});

describe("parseDrive", () => {
  it("today's drive comes back as it was", () => {
    const kept = drive({ at: 2, outcome: { a: "delivered", b: "skipped" }, confirmed: ["order-a"] });
    expect(parseDrive(JSON.stringify(kept), "2026-10-27")).toEqual(kept);
  });

  it("yesterday's drive doesn't", () => {
    expect(parseDrive(JSON.stringify(drive()), "2026-10-28")).toBeNull();
  });

  it("nothing kept, a broken copy, or no stops: no drive", () => {
    expect(parseDrive(null, "2026-10-27")).toBeNull();
    expect(parseDrive("{not json", "2026-10-27")).toBeNull();
    expect(parseDrive(JSON.stringify(drive({ stops: [] })), "2026-10-27")).toBeNull();
  });

  it("a stop number out of range starts from the first", () => {
    expect(parseDrive(JSON.stringify(drive({ at: 9 })), "2026-10-27")?.at).toBe(0);
  });
});
