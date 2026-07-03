"use client";
import { useEffect, useSyncExternalStore } from "react";
import { toHebrewError } from "@/lib/error-messages";

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
      const res = await fetch("/api/notifications/list", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { items?: NotificationItem[]; unreadCount?: number; error?: string };
      if (!res.ok) throw new Error(toHebrewError(json.error, "טעינת ההתראות נכשלה."));
      state = { items: Array.isArray(json.items) ? json.items : [], unreadCount: json.unreadCount ?? 0, error: null, loading: false };
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
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  } catch {
    // best-effort — a later refresh corrects any drift
  }
}
