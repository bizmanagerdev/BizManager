"use client";
import { toHebrewError } from "@/lib/error-messages";
import { useAlertsVersion } from "@/lib/ui/alerts-refresh";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SystemAlert } from "@/lib/reminders/alert-bar";

// Module-level cache for the shared AlertBar, mirroring lib/ui/alerts-store.ts (the
// bell's store) — kept as its OWN store rather than reusing the bell's, so a change
// here can never touch that component's documented render-loop history. Lives in
// module scope so navigating between pages doesn't reflicker the strip.

type State = {
  alerts: SystemAlert[] | null;
  error: string | null;
  loading: boolean;
};

const TTL_MS = 60_000;

let state: State = { alerts: null, error: null, loading: false };
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

const SERVER_SNAPSHOT: State = { alerts: null, error: null, loading: false };
function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

async function refresh(force = false): Promise<void> {
  if (typeof window === "undefined") return;
  if (!force && state.alerts && Date.now() - lastFetchedAt < TTL_MS) return;
  if (inFlight) return inFlight;

  if (!state.alerts && !state.loading) {
    state = { ...state, loading: true };
    emit();
  }

  inFlight = (async () => {
    try {
      const res = await fetch("/api/reminders/alert-bar", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { alerts?: SystemAlert[]; error?: string };
      if (!res.ok) {
        throw new Error(toHebrewError(json.error, "טעינת ההתראות נכשלה."));
      }
      state = { alerts: Array.isArray(json.alerts) ? json.alerts : [], error: null, loading: false };
      lastFetchedAt = Date.now();
    } catch (err: unknown) {
      state = { alerts: state.alerts, loading: false, error: toHebrewError(err, "טעינת ההתראות נכשלה.") };
    } finally {
      inFlight = null;
      emit();
    }
  })();

  return inFlight;
}

export function useAlertBarAlerts() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const alertsVersion = useAlertsVersion();
  const lastVersion = useRef(alertsVersion);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (alertsVersion !== lastVersion.current) {
      lastVersion.current = alertsVersion;
      void refresh(true);
    }
  }, [alertsVersion]);

  return snap;
}

export function refreshAlertBarAlerts() {
  void refresh(true);
}
