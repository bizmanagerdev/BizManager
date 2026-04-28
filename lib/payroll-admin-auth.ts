import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { PAYROLL_ADMIN_COOKIE } from "@/lib/payroll";

export async function isPayrollAdminUnlocked() {
  const store = await cookies();
  return store.get(PAYROLL_ADMIN_COOKIE)?.value === "1";
}

export function isPayrollAdminPasswordConfigured() {
  return Boolean(
    process.env.SALARY_AREA_PASSWORD_HASH ||
      process.env.PAYROLL_ADMIN_PASSWORD_HASH ||
      process.env.PAYROLL_ADMIN_PASSWORD
  );
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeConfiguredHash(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("sha256:")) {
    return trimmed.slice("sha256:".length).trim().toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function verifyPayrollAdminPassword(password: string) {
  const hashValue =
    process.env.SALARY_AREA_PASSWORD_HASH ?? process.env.PAYROLL_ADMIN_PASSWORD_HASH ?? "";
  const plainPassword = process.env.PAYROLL_ADMIN_PASSWORD ?? "";

  if (hashValue.trim()) {
    const expected = Buffer.from(normalizeConfiguredHash(hashValue), "hex");
    const actual = Buffer.from(sha256Hex(password), "hex");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  if (!plainPassword) return false;
  return password === plainPassword;
}
