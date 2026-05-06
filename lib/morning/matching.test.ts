import test from "node:test";
import assert from "node:assert/strict";
import { findMorningClientCandidatesForCustomerRecord } from "@/lib/morning/matching";

test("matches existing Morning client by tax id", () => {
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

  assert.equal(result.bestCandidate?.morningClientId, "m1");
  assert.equal(result.shouldAutoMatch, true);
});

test("marks manual review on ambiguous match", () => {
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

  assert.equal(result.needsManualReview, true);
  assert.equal(result.candidates.length, 2);
});
