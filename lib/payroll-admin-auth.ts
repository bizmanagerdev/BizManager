import { cookies } from "next/headers";
import { PAYROLL_ADMIN_COOKIE } from "@/lib/payroll";

export async function isPayrollAdminUnlocked() {
  const store = await cookies();
  return store.get(PAYROLL_ADMIN_COOKIE)?.value === "1";
}

export function isPayrollAdminPasswordConfigured() {
  return Boolean(process.env.PAYROLL_ADMIN_PASSWORD);
}
