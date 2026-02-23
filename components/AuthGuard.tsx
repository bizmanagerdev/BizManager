"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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

      const { data, error: profileError } = await supabase
        .from("users")
        .select(
          "id,email,full_name,phone,role,active,system_access"
        )
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (profileError) {
        setErr(profileError.message);
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

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  if (err) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Something went wrong</h1>
        <p style={{ color: "red" }}>{err}</p>
      </div>
    );
  }

  if (!profile) return null;

  return <>{children(profile)}</>;
}

