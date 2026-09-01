"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type AssignableUser = { id: string; label: string };

// Module-level cache so the user list is fetched once and shared across the
// various reminder assignee pickers, not re-fetched per dialog.
let cachedUsers: AssignableUser[] | null = null;
let cachedCurrentUserId: string | null = null;
let inFlight: Promise<void> | null = null;
// Only a SUCCESSFUL load is sticky. A failed/aborted first attempt must NOT
// poison the cache with an empty list forever — otherwise one transient
// hiccup on page load leaves every assignee picker permanently empty.
let loadedOk = false;

// Reads straight from Supabase — RLS on `users` already scopes the result the
// same way the old /api/users/list route did (office/admin see everyone active,
// a worker sees only other active workers), since that route used the same
// RLS-bound client with no extra role filtering of its own.
async function loadUsers() {
  if (loadedOk) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const authRes = await supabase.auth.getUser();
      const authUid = authRes.data.user?.id ?? null;
      const [usersRes, selfRes] = await Promise.all([
        supabase
          .from("users")
          .select("id,full_name,email")
          .eq("active", true)
          .order("full_name", { ascending: true })
          .range(0, 499),
        authUid
          ? supabase.from("users").select("id").eq("auth_user_id", authUid).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (usersRes.error) throw usersRes.error;
      const rows = (usersRes.data ?? []) as Array<{
        id: string;
        full_name: string | null;
        email: string | null;
      }>;
      cachedUsers = rows
        .map((u) => ({
          id: u.id,
          label: u.full_name?.trim() || u.email?.trim() || "ללא שם",
        }))
        .filter((u) => u.id);
      cachedCurrentUserId = (selfRes.data as { id: string } | null)?.id ?? null;
      loadedOk = true;
    } catch {
      // Leave loadedOk=false so the next mount retries instead of caching empty.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useAssignableUsers() {
  const [users, setUsers] = useState<AssignableUser[]>(cachedUsers ?? []);
  const [currentUserId, setCurrentUserId] = useState<string | null>(cachedCurrentUserId);

  useEffect(() => {
    // Initial state already reflects the cache (useState initializers); resolve
    // the (possibly already-settled) load and sync afterwards — never call
    // setState synchronously in the effect body.
    let cancelled = false;
    void loadUsers().then(() => {
      if (cancelled) return;
      setUsers(cachedUsers ?? []);
      setCurrentUserId(cachedCurrentUserId);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { users, currentUserId };
}
