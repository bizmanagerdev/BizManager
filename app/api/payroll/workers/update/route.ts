import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type UpdateWorkerPayload = {
  user_id?: string;
  role?: string;
  active?: boolean;
  system_access?: boolean;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as UpdateWorkerPayload;
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
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

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id." }, { status: 400 });
    }
    if (!role) {
      return NextResponse.json({ error: "Role must be admin, office, worker or worker_no_access." }, { status: 400 });
    }

    const { supabase } = access.value;
    const result = await supabase
      .from("users")
      .update({
        role,
        active,
        system_access: systemAccess,
      })
      .eq("id", userId)
      .select("id,full_name,email,phone,role,active,system_access")
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    return NextResponse.json({ user: result.data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
