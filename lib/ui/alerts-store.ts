"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useSyncExternalStore } from "react";

export type AlertItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  count: number;
  severity: "info" | "warning" | "danger";
  countsAsActiveAlert?: boolean;
};

type State = {
  alerts: AlertItem[] | null;
  count: number;
  error: string | null;
  loading: boolean;
};

/**
 * Module-level alerts cache. Because the page-level layout architecture mounts
 * AppShell (and therefore TopBar) per route, every navigation would otherwise
 * re-trigger a fetch and make the bell badge flicker. The store lives in module
 * scope so its data survives navigations.
 */

const TTL_MS = 60_000; // re-fetch in background after one minute

let state: State = { alerts: null, count: 0, error: null, loading: false };
let lastFetchedAt = 0;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<() => void>();

function emit() {
  subscribers.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function getSnapshot() {
  return state;
}

const SERVER_SNAPSHOT: State = { alerts: null, count: 0, error: null, loading: false };
function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

async function refresh(force = false): Promise<void> {
  if (typeof window === "undefined") return;
  if (!force && state.alerts && Date.now() - lastFetchedAt < TTL_MS) return;
  if (inFlight) return inFlight;

  // Only show a loading flash on the very first load — when there's no cache yet.
  if (!state.alerts && !state.loading) {
    state = { ...state, loading: true };
    emit();
  }

  inFlight = (async () => {
    try {
      const res = await fetch("/api/reminders/worklist", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        alerts?: AlertItem[];
        count?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(toHebrewError(json.error, "טעינת ההתראות נכשלה."));
      }
      const alerts = Array.isArray(json.alerts) ? json.alerts : [];
      const count = typeof json.count === "number" ? json.count : alerts.length;
      state = { alerts, count, error: null, loading: false };
      lastFetchedAt = Date.now();
    } catch (err: unknown) {
      state = {
        alerts: state.alerts,
        count: state.count,
        loading: false,
        error: toHebrewError(err, "טעינת ההתראות נכשלה."),
      };
    } finally {
      inFlight = null;
      emit();
    }
  })();

  return inFlight;
}

export function useAlerts() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    void refresh();
  }, []);
  return snap;
}

export function refreshAlerts() {
  void refresh(true);
}
