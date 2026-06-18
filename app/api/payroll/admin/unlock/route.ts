import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { PAYROLL_ADMIN_COOKIE } from "@/lib/payroll";
import { isPayrollAdminPasswordConfigured, verifyPayrollAdminPassword } from "@/lib/payroll-admin-auth";

type UnlockPayload = {
  password?: string;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    if (!isPayrollAdminPasswordConfigured()) {
      return NextResponse.json(
        { error: "Salary area password is not configured on the server." },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as UnlockPayload;
    const password = typeof body.password === "string" ? body.password : "";

    if (!verifyPayrollAdminPassword(password)) {
      return NextResponse.json({ error: "הסיסמה שגויה." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: PAYROLL_ADMIN_COOKIE,
      value: "1",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return response;
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
