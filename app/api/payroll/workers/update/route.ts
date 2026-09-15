import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeSectionAccess, type SectionAccess } from "@/lib/auth/sections";
import {
  getPayTrackingModeForWorkerType,
  normalizePayrollWorkerType,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";

type UpdateWorkerPayload = {
  user_id?: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string;
  active?: boolean;
  system_access?: boolean;
  payroll_worker_type?: PayrollWorkerType;
  pay_tracking_mode?: "session" | "payslip";
  locale?: "he" | "ar";
  section_access?: Partial<SectionAccess>;
  /** New login password. Required when granting access to a worker who has no
   *  auth account yet; otherwise optional ("" = leave the password alone). */
  password?: string | null;
};

/** Supabase's minimum; the create flow relies on GoTrue enforcing it, and we
 *  reject early here so a half-done grant can't fail after the profile write. */
const MIN_PASSWORD_LENGTH = 6;

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

/**
 * Finds an existing auth account by email address.
 *
 * Only used to recover from a duplicate-email collision when provisioning: the
 * address may already exist in auth without being linked to this profile (an
 * account made by hand in the Supabase dashboard, or one orphaned by an earlier
 * profile delete). Adopting it beats dead-ending the admin, who can't see or
 * fix auth.users from inside the app. The admin SDK has no get-by-email, hence
 * the paging — bounded, and only on the error path.
 */
async function findAuthUserIdByEmail(adminClient: AdminClient, email: string): Promise<string | null> {
  const PER_PAGE = 200;
  const MAX_PAGES = 25;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) return null;

    const users = data?.users ?? [];
    const match = users.find((user) => (user.email ?? "").trim().toLowerCase() === email);
    if (match?.id) return match.id;
    if (users.length < PER_PAGE) return null;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as UpdateWorkerPayload;
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const role =
      body.role === "admin" ||
      body.role === "office" ||
      body.role === "worker" ||
      body.role === "worker_no_access"
        ? body.role
        : null;
    const active = body.active === false ? false : true;
    const systemAccess =
      role === "worker_no_access" ? false : body.system_access === false ? false : true;
    const payrollWorkerType = normalizePayrollWorkerType(body.payroll_worker_type, body.pay_tracking_mode);
    const payTrackingMode = getPayTrackingModeForWorkerType(payrollWorkerType);
    // Only workers are ever offered Arabic; force office/admin back to Hebrew
    // rather than trusting a stray client value for a role that shouldn't have one.
    const locale = role === "worker" && body.locale === "ar" ? "ar" : "he";
    // Meaningless for staff (they always have full access regardless of what's
    // stored) — only a worker's own choice is ever actually consulted.
    const sectionAccess = sanitizeSectionAccess(body.section_access);
    const password = typeof body.password === "string" ? body.password.trim() : "";

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id." }, { status: 400 });
    }
    if (!role) {
      return NextResponse.json({ error: "Role must be admin, office, worker or worker_no_access." }, { status: 400 });
    }
    if (!fullName) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }
    // The email IS the login identifier, so a user with access can't be left
    // without one (same invariant /api/users/create enforces at creation).
    if (systemAccess && !email) {
      return NextResponse.json({ error: "יש להזין אימייל למשתמש עם גישה." }, { status: 400 });
    }

    const { supabase } = access.value;
    const existingUserResult = await supabase
      .from("users")
      .select("id,auth_user_id,email")
      .eq("id", userId)
      .maybeSingle();

    if (existingUserResult.error) {
      return NextResponse.json({ error: toHebrewError(existingUserResult.error.message) }, { status: 400 });
    }
    if (!existingUserResult.data?.id) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const existingAuthUserId =
      typeof existingUserResult.data.auth_user_id === "string" && existingUserResult.data.auth_user_id
        ? existingUserResult.data.auth_user_id
        : null;
    const existingEmail =
      typeof existingUserResult.data.email === "string" ? existingUserResult.data.email.trim().toLowerCase() : "";

    // `system_access` only says the PROFILE is allowed in — logging in needs an
    // actual Supabase Auth account, joined to this row by users.auth_user_id
    // (see lib/profile/fetchMyProfile.ts). A worker first created as
    // "worker_no_access" has none, so granting access here has to provision one
    // the same way /api/users/create does, or the worker is left with a profile
    // that says "allowed" and no credentials to log in with.
    let authUserId = existingAuthUserId;
    // The profile email and the auth email have to move together, or the admin
    // "changes the email" here and the worker still has to log in with the old one.
    const emailChanged = Boolean(email) && email !== existingEmail;

    if (systemAccess && (!existingAuthUserId || password || emailChanged)) {
      if (!existingAuthUserId && !password) {
        return NextResponse.json(
          { error: "לעובד זה אין עדיין חשבון כניסה. יש להזין סיסמה כדי לפתוח לו גישה." },
          { status: 400 }
        );
      }
      if (password && password.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json(
          { error: `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.` },
          { status: 400 }
        );
      }

      const adminClient = createSupabaseAdminClient();
      if (!adminClient) {
        return NextResponse.json(
          { error: toHebrewError("SUPABASE_SERVICE_ROLE_KEY not configured") },
          { status: 500 }
        );
      }

      if (existingAuthUserId) {
        // Patch only what the admin actually changed — never re-create, and
        // never send password: "" (GoTrue rejects it), which is how "leave the
        // existing password alone" is expressed.
        const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(existingAuthUserId, {
          ...(password ? { password } : {}),
          ...(emailChanged ? { email, email_confirm: true } : {}),
        });
        if (updateAuthError) {
          return NextResponse.json({ error: toHebrewError(updateAuthError.message) }, { status: 400 });
        }
      } else {
        // email_confirm: true for the same reason /api/users/create does it —
        // the worker was handed a password directly and has no confirmation
        // link to click.
        const { data: createdAuthUser, error: createAuthError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName || undefined,
            phone: phone || undefined,
          },
        });

        if (createAuthError || !createdAuthUser?.user?.id) {
          // Most likely "already registered" — an auth account exists for this
          // address but isn't linked to this profile. Adopt it (and set the
          // password the admin just typed) instead of dead-ending.
          const orphanAuthUserId = await findAuthUserIdByEmail(adminClient, email);
          if (!orphanAuthUserId) {
            return NextResponse.json(
              { error: toHebrewError(createAuthError?.message ?? "Failed to create auth user") },
              { status: 400 }
            );
          }

          // ...unless it is genuinely somebody else's account. Re-pointing it
          // here would hand this worker that person's login.
          const { data: alreadyLinked } = await supabase
            .from("users")
            .select("id")
            .eq("auth_user_id", orphanAuthUserId)
            .neq("id", userId)
            .maybeSingle();

          if (alreadyLinked?.id) {
            return NextResponse.json(
              { error: "כתובת האימייל הזו כבר משויכת למשתמש אחר במערכת." },
              { status: 400 }
            );
          }

          const { error: adoptError } = await adminClient.auth.admin.updateUserById(orphanAuthUserId, {
            password,
            email_confirm: true,
          });
          if (adoptError) {
            return NextResponse.json({ error: toHebrewError(adoptError.message) }, { status: 400 });
          }
          authUserId = orphanAuthUserId;
        } else {
          authUserId = createdAuthUser.user.id;
        }
      }
    }

    const rpcResult = await supabase.rpc("admin_upsert_user_profile", {
      p_user_id: userId,
      p_auth_user_id: authUserId,
      p_full_name: fullName,
      p_email: email || null,
      p_phone: phone || null,
      p_role: role,
      p_active: active,
      p_system_access: systemAccess,
      p_payroll_worker_type: payrollWorkerType,
      p_pay_tracking_mode: payTrackingMode,
      p_locale: locale,
      p_section_access: sectionAccess,
    });

    if (rpcResult.error) {
      return NextResponse.json({ error: toHebrewError(rpcResult.error.message) }, { status: 400 });
    }

    const result = await supabase
      .from("users")
      .select("id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode,locale,section_access")
      .eq("id", userId)
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ error: toHebrewError(result.error.message) }, { status: 400 });
    }

    return NextResponse.json({ user: result.data });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
