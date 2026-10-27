"use client";

import { Component, type ReactNode } from "react";
import { noteOffline } from "@/lib/pwa/offline-report";
import { isServerReachable, whenServerReachable } from "@/lib/pwa/connection";
import { withSentry } from "@/lib/sentry-lazy";
import { reloadIfStaleBuild } from "@/lib/ui/auto-recover";

type Props = {
  /** Which part this is, for the report. */
  name: string;
  children: ReactNode;
  /** Shown instead while the part can't load (nothing by default). */
  fallback?: ReactNode;
};

/**
 * A part of the app whose code loads when it's needed (the "+" forms): if
 * that code can't be had — no connection, and it was never downloaded to this
 * device — that part alone gives way, instead of the whole app breaking
 * (owner's test, 2026-10-27: hovering "+" offline, then "אירעה שגיאה"). It's
 * tried again once the server answers (lib/pwa/connection.ts). With the
 * server answering it's a real failure: reported, and a stale build reloads
 * as the app's error screens do.
 */
export default class OfflineSafe extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  private stopWaiting?: () => void;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.stopWaiting?.();
    if (isServerReachable()) {
      withSentry((Sentry) => Sentry.captureException(error, { tags: { area: "offline-safe", part: this.props.name } }));
      reloadIfStaleBuild(error);
      return;
    }
    noteOffline("part failed", { part: this.props.name, name: error.name, message: error.message.slice(0, 300) });
    this.stopWaiting = whenServerReachable(() => this.setState({ failed: false }));
  }

  componentWillUnmount() {
    this.stopWaiting?.();
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
