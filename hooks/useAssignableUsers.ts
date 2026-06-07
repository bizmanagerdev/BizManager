"use client";

import { useEffect, useState } from "react";

export type AssignableUser = { id: string; label: string };

// Module-level cache so the user list is fetched once and shared across the
// various reminder assignee pickers, not re-fetched per dialog.
let cachedUsers: AssignableUser[] | null = null;
let cachedCurrentUserId: string | null = null;
let inFlight: Promise<void> | null = null;

async function loadUsers() {
  if (!inFlight) {
    inFlight = fetch("/api/users/list")
      .then((res) => (res.ok ? res.json() : { users: [], currentUserId: null }))
      .then((json: { users?: AssignableUser[]; currentUserId?: string | null }) => {
        cachedUsers = json.users ?? [];
        cachedCurrentUserId = json.currentUserId ?? null;
      })
      .catch(() => {
        cachedUsers = [];
      });
  }
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
