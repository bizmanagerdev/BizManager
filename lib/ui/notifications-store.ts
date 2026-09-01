"use client";
import { useEffect, useSyncExternalStore } from "react";
import { toHebrewError } from "@/lib/error-messages";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  url: string;
  category: string | null;
  read_at: string | null;
  created_at: string;
};

type State = { items: NotificationItem[] | null; unreadCount: number; error: string | null; loading: boolean };

// Module-level cache so the bell doesn't re-fetch/flicker on every navigation.
const TTL_MS = 45_000;
let state: State = { items: null, unreadCount: 0, error: null, loading: false };
let lastFetchedAt = 0;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<() => void>();

function emit() {
  subscribers.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
function getSnapshot() {
  return state;
}
const SERVER_SNAPSHOT: State = { items: null, unreadCount: 0, error: null, loading: false };
function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

async function refresh(force = false): Promise<void> {
  if (typeof window === "undefined") return;
  if (!force && state.items && Date.now() - lastFetchedAt < TTL_MS) return;
  if (inFlight) return inFlight;
  if (!state.items && !state.loading) {
    state = { ...state, loading: true };
    emit();
  }
  inFlight = (async () => {
    try {
      // RLS scopes both queries to the viewer (notifications.user_id = auth.uid()),
      // same as the old /api/notifications/list route did with the identical client.
      const supabase = createSupabaseBrowserClient();
      const [itemsRes, countRes] = await Promise.all([
        supabase
          .from("notifications")
          .select("id,title,body,url,category,read_at,created_at")
          .order("created_at", { ascending: false })
          .limit(40),
        supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      state = {
        items: (itemsRes.data ?? []) as NotificationItem[],
        unreadCount: countRes.count ?? 0,
        error: null,
        loading: false,
      };
      lastFetchedAt = Date.now();
    } catch (err: unknown) {
      state = { items: state.items, unreadCount: state.unreadCount, loading: false, error: toHebrewError(err, "טעינת ההתראות נכשלה.") };
    } finally {
      inFlight = null;
      emit();
    }
  })();
  return inFlight;
}

export function useNotifications() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    void refresh();
  }, []);
  return snap;
}

export function refreshNotifications() {
  void refresh(true);
}

/** Optimistically mark items read locally, then persist. */
export async function markNotificationRead(opts: { id?: string; all?: boolean }) {
  if (state.items) {
    const nowIso = new Date().toISOString();
    const items = state.items.map((n) => (opts.all || n.id === opts.id ? { ...n, read_at: n.read_at ?? nowIso } : n));
    state = { ...state, items, unreadCount: items.filter((n) => !n.read_at).length };
    emit();
  }
  try {
    const supabase = createSupabaseBrowserClient();
    const nowIso = new Date().toISOString();
    let q = supabase.from("notifications").update({ read_at: nowIso });
    q = opts.all ? q.is("read_at", null) : q.eq("id", opts.id ?? "");
    await q;
  } catch {
    // best-effort — a later refresh corrects any drift
  }
}
