import { describe, it, expect } from "vitest";
import { findMorningClientCandidatesForCustomerRecord } from "@/lib/morning/matching";

describe("findMorningClientCandidatesForCustomerRecord", () => {
  it("matches existing Morning client by tax id", () => {
    const result = findMorningClientCandidatesForCustomerRecord(
      {
        id: "1",
        name: "לקוח בדיקה",
        registrationNumber: "512345678",
        email: "a@test.com",
        phone: "052-1234567",
      },
      [
        {
          id: "m1",
          name: "לקוח בדיקה",
          taxId: "512345678",
          email: "other@test.com",
        },
      ]
    );

    expect(result.bestCandidate?.morningClientId).toBe("m1");
    expect(result.shouldAutoMatch).toBe(true);
  });

  it("marks manual review on ambiguous match", () => {
    const result = findMorningClientCandidatesForCustomerRecord(
      {
        id: "1",
        name: "משה כהן",
        email: "a@test.com",
        phone: "0521234567",
      },
      [
        { id: "m1", name: "משה כהן", email: "a@test.com" },
        { id: "m2", name: "משה כהן", phone: "0521234567" },
      ]
    );

    expect(result.needsManualReview).toBe(true);
    expect(result.candidates.length).toBe(2);
  });
});
