import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import type { UserRole } from "@/lib/auth/requireProfile";

type RouteProfile = {
  id: string;
  role: UserRole;
  active: boolean;
  system_access: boolean;
  email: string | null;
  full_name: string | null;
};

type RouteAccessOk = {
  supabase: Awaited<ReturnType<typeof createSupabaseRouteClient>>;
  user: { id: string; email?: string | null };
  profile: RouteProfile;
};

type RouteAccessResult =
  | { ok: true; value: RouteAccessOk }
  | { ok: false; response: NextResponse };

export async function requireRouteAccess(options?: {
  allowedRoles?: UserRole[];
}): Promise<RouteAccessResult> {
  const supabase = await createSupabaseRouteClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Authentication error: ${userError.message}` }, { status: 400 }),
    };
  }

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id,role,active,system_access,email,full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No user profile access" }, { status: 403 }),
    };
  }

  const typed = profile as RouteProfile;

  if (!typed.active || !typed.system_access || typed.role === "worker_no_access") {
    return {
      ok: false,
      response: NextResponse.json({ error: "No access" }, { status: 403 }),
    };
  }

  const allowedRoles = options?.allowedRoles;
  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(typed.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Insufficient role" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    value: {
      supabase,
      user: { id: user.id, email: user.email },
      profile: typed,
    },
  };
}
