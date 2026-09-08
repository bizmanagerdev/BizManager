import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { isPayrollAdminPasswordConfigured, verifyPayrollAdminPassword } from "@/lib/payroll-admin-auth";

const ENV_KEYS = ["SALARY_AREA_PASSWORD_HASH", "PAYROLL_ADMIN_PASSWORD_HASH", "PAYROLL_ADMIN_PASSWORD"] as const;
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("isPayrollAdminPasswordConfigured", () => {
  it("false when none of the three env vars are set", () => {
    expect(isPayrollAdminPasswordConfigured()).toBe(false);
  });
  it("true when any one of the three is set", () => {
    process.env.PAYROLL_ADMIN_PASSWORD = "secret";
    expect(isPayrollAdminPasswordConfigured()).toBe(true);
  });
});

describe("verifyPayrollAdminPassword — hashed password (preferred path)", () => {
  it("accepts the correct password against a bare hex hash", () => {
    process.env.SALARY_AREA_PASSWORD_HASH = sha256Hex("hunter2");
    expect(verifyPayrollAdminPassword("hunter2")).toBe(true);
  });
  it("rejects the wrong password against a bare hex hash", () => {
    process.env.SALARY_AREA_PASSWORD_HASH = sha256Hex("hunter2");
    expect(verifyPayrollAdminPassword("wrong")).toBe(false);
  });
  it("accepts a hash written with the 'sha256:' prefix", () => {
    process.env.SALARY_AREA_PASSWORD_HASH = `sha256:${sha256Hex("hunter2")}`;
    expect(verifyPayrollAdminPassword("hunter2")).toBe(true);
  });
  it("hash comparison is case-insensitive on the configured value", () => {
    process.env.SALARY_AREA_PASSWORD_HASH = sha256Hex("hunter2").toUpperCase();
    expect(verifyPayrollAdminPassword("hunter2")).toBe(true);
  });
  it("PAYROLL_ADMIN_PASSWORD_HASH works as the fallback hash var", () => {
    process.env.PAYROLL_ADMIN_PASSWORD_HASH = sha256Hex("hunter2");
    expect(verifyPayrollAdminPassword("hunter2")).toBe(true);
  });
  it("SALARY_AREA_PASSWORD_HASH takes priority over PAYROLL_ADMIN_PASSWORD_HASH when both are set", () => {
    process.env.SALARY_AREA_PASSWORD_HASH = sha256Hex("primary");
    process.env.PAYROLL_ADMIN_PASSWORD_HASH = sha256Hex("secondary");
    expect(verifyPayrollAdminPassword("primary")).toBe(true);
    expect(verifyPayrollAdminPassword("secondary")).toBe(false);
  });
  it("a hashed config is used even when a plaintext fallback is ALSO set", () => {
    process.env.SALARY_AREA_PASSWORD_HASH = sha256Hex("hashed-one");
    process.env.PAYROLL_ADMIN_PASSWORD = "plaintext-one";
    expect(verifyPayrollAdminPassword("plaintext-one")).toBe(false);
    expect(verifyPayrollAdminPassword("hashed-one")).toBe(true);
  });
});

describe("verifyPayrollAdminPassword — plaintext fallback", () => {
  it("accepts an exact match when no hash is configured", () => {
    process.env.PAYROLL_ADMIN_PASSWORD = "plain-secret";
    expect(verifyPayrollAdminPassword("plain-secret")).toBe(true);
  });
  it("rejects a wrong password", () => {
    process.env.PAYROLL_ADMIN_PASSWORD = "plain-secret";
    expect(verifyPayrollAdminPassword("wrong")).toBe(false);
  });
});

describe("verifyPayrollAdminPassword — nothing configured at all", () => {
  it("always rejects, regardless of what's typed (fails closed, not open)", () => {
    expect(verifyPayrollAdminPassword("anything")).toBe(false);
    expect(verifyPayrollAdminPassword("")).toBe(false);
  });
});
