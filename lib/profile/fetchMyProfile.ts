import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  isPayrollWorkerType,
  payrollWorkerTypeAllowsSessions,
  payrollWorkerTypeGeneratesPayslips,
} from "@/lib/payroll-worker-type";

export type MyProfile = {
  role: string | null;
  name: string | null;
  email: string | null;
  canTrackSessions: boolean;
  canViewSalary: boolean;
};

const NO_ROLE: MyProfile = { role: null, name: null, email: null, canTrackSessions: false, canViewSalary: false };

/**
 * "Who am I" — a client-side fallback for the rare mount that renders without
 * the server-resolved `initialMe`/`initialRole` prop (the normal path never
 * calls this; see app/(app)/layout.tsx). Reads straight from Supabase — RLS on
 * `users` (self-select via auth_user_id) already scopes this the same way the
 * old /api/profile/me route did with its identical (cookie-bound) client; the
 * active/system_access → "no role" gate is replicated here since that was
 * app-level logic, not something RLS itself encodes.
 */
export async function fetchMyProfile(): Promise<MyProfile> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NO_ROLE;

  const { data, error } = await supabase
    .from("users")
    .select("role,active,system_access,full_name,email,payroll_worker_type")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error || !data || !data.active || !data.system_access) return NO_ROLE;

  const raw = (data as { payroll_worker_type?: unknown }).payroll_worker_type;
  const workerType = isPayrollWorkerType(raw) ? raw : null;
  return {
    role: (data as { role?: string | null }).role ?? null,
    name: (data as { full_name?: string | null }).full_name ?? null,
    email: (data as { email?: string | null }).email ?? null,
    canTrackSessions: workerType != null && payrollWorkerTypeAllowsSessions(workerType),
    canViewSalary: workerType != null && payrollWorkerTypeGeneratesPayslips(workerType),
  };
}
