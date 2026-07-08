"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { CONNECTION_EVENTS } from "@/lib/offline-queue";

type ConnDetail = { label?: string; count?: number; reason?: string };

/**
 * Field-observability for the offline system. Every offline write/upload emits a
 * CONNECTION_EVENT; this records them as Sentry breadcrumbs (and a captured
 * warning when actions permanently fail) so we can finally SEE how often users
 * hit bad signal, what gets queued, and what never syncs — instead of guessing.
 *
 * Fully inert until a Sentry DSN is configured (same gating as the rest of the
 * app), so it costs nothing in dev / when Sentry is off.
 */
export default function ConnectionTelemetry() {
  useEffect(() => {
    const crumb = (message: string, data: Record<string, unknown>, level: Sentry.SeverityLevel = "info") =>
      Sentry.addBreadcrumb({ category: "offline", message, level, data });

    const onSlow = (e: Event) => {
      const { label } = ((e as CustomEvent).detail ?? {}) as ConnDetail;
      crumb("write slow", { label });
    };
    const onQueued = (e: Event) => {
      const { label, reason } = ((e as CustomEvent).detail ?? {}) as ConnDetail;
      crumb("action queued", { label, reason });
    };
    const onSynced = (e: Event) => {
      const { count } = ((e as CustomEvent).detail ?? {}) as ConnDetail;
      crumb("queue synced", { count });
    };
    const onFailed = (e: Event) => {
      const { count } = ((e as CustomEvent).detail ?? {}) as ConnDetail;
      crumb("queue failed", { count }, "error");
      // A permanent failure is the actionable signal — surface it as a captured
      // event (not just a breadcrumb) so it can alert / be counted.
      Sentry.captureMessage("offline action permanently failed", {
        level: "warning",
        tags: { area: "offline" },
        extra: { count },
      });
    };

    window.addEventListener(CONNECTION_EVENTS.slow, onSlow);
    window.addEventListener(CONNECTION_EVENTS.queued, onQueued);
    window.addEventListener(CONNECTION_EVENTS.synced, onSynced);
    window.addEventListener(CONNECTION_EVENTS.failed, onFailed);

    return () => {
      window.removeEventListener(CONNECTION_EVENTS.slow, onSlow);
      window.removeEventListener(CONNECTION_EVENTS.queued, onQueued);
      window.removeEventListener(CONNECTION_EVENTS.synced, onSynced);
      window.removeEventListener(CONNECTION_EVENTS.failed, onFailed);
    };
  }, []);

  return null;
}
