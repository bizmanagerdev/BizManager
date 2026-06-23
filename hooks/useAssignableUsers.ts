"use client";

import { useEffect, useState } from "react";

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

async function loadUsers() {
  if (loadedOk) return;
  if (inFlight) return inFlight;
  inFlight = fetch("/api/users/list")
    .then(async (res) => {
      if (!res.ok) throw new Error(`users/list ${res.status}`);
      const json = (await res.json()) as {
        users?: AssignableUser[];
        currentUserId?: string | null;
      };
      cachedUsers = json.users ?? [];
      cachedCurrentUserId = json.currentUserId ?? null;
      loadedOk = true;
    })
    .catch(() => {
      // Leave loadedOk=false so the next mount retries instead of caching empty.
    })
    .finally(() => {
      inFlight = null;
    });
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
