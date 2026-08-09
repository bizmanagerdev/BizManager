"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { toHebrewError } from "@/lib/error-messages";

// NOTE: currently unused — nothing imports this component. Route protection is
// enforced server-side by lib/auth/requireProfile.ts and requireRouteAccess.ts,
// which is stronger: a client-side guard can only redirect after the page has
// already been sent. Kept (and kept correct) rather than deleted so that if it
// is ever picked up it does not reintroduce the identity bug below.

export type UserRole = "admin" | "office" | "worker" | "worker_no_access";

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  active: boolean;
  system_access: boolean;
};

type Props = {
  children: (profile: UserProfile) => React.ReactNode;
  allowedRoles?: UserRole[];
};

export default function AuthGuard({ children, allowedRoles }: Props) {
  const supabase = createSupabaseBrowserClient();
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setErr(null);
      setLoading(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (userError || !user) {
        router.replace("/login");
        router.refresh();
        return;
      }

      // users.id is an independent app PK; the auth link is users.auth_user_id
      // (see supabase/migrations/20260629000000_fix_legacy_auth_uid_identity.sql).
      // Matching the PK against the auth uid works ONLY for accounts that
      // self-provisioned with id = auth_user_id — a staff member created via
      // admin_upsert_user_profile would find no row here and be bounced to
      // /no-access. `profile.id` is therefore the app PK, same as requireProfile.
      const { data, error: profileError } = await supabase
        .from("users")
        .select(
          "id,email,full_name,phone,role,active,system_access"
        )
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (profileError) {
        setErr(toHebrewError(profileError.message, "טעינת ההרשאות נכשלה."));
        setLoading(false);
        return;
      }

      if (!data) {
        router.replace("/no-access");
        router.refresh();
        return;
      }

      const typed = data as UserProfile;

      if (!typed.active || !typed.system_access || typed.role === "worker_no_access") {
        router.replace("/no-access");
        router.refresh();
        return;
      }

      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(typed.role)) {
        router.replace("/no-access");
        router.refresh();
        return;
      }

      setProfile(typed);
      setLoading(false);
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [allowedRoles, router, supabase]);

  if (loading) return <div style={{ padding: 24 }}>טוען…</div>;

  if (err) {
    return (
      <div style={{ padding: 24 }}>
        <h1>אירעה שגיאה</h1>
        <p className="text-destructive">{err}</p>
      </div>
    );
  }

  if (!profile) return null;

  return <>{children(profile)}</>;
}

