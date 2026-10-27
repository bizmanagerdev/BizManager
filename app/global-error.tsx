"use client";

// Root-level error boundary: reports unhandled render errors to Sentry and shows
// a Hebrew fallback. Replaces the whole document when a top-level error occurs,
// so it must render its own <html>/<body>.
import { useEffect } from "react";
import { withSentry } from "@/lib/sentry-lazy";
import { reloadIfStaleBuild } from "@/lib/ui/auto-recover";
import { noteOffline } from "@/lib/pwa/offline-report";
import { isServerReachable } from "@/lib/pwa/connection";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // Reported before the reload below — see app/(app)/error.tsx.
    withSentry((Sentry) => Sentry.captureException(error));
    // With no connection that report is lost: kept for when it's back, as in
    // app/(app)/error.tsx (owner's test, 2026-10-27: "+" broke the whole app
    // offline, and nothing about it reached Sentry).
    const savedCopy = document.documentElement.dataset.bizhSaved !== undefined;
    if (!isServerReachable() || savedCopy) {
      noteOffline("app error", { name: error.name, message: error.message.slice(0, 300), savedCopy });
    }
    // See lib/ui/auto-recover.ts — a stale/mismatched build gets one
    // automatic hard reload instead of leaving the user stuck here.
    reloadIfStaleBuild(error);
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body>
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
          <h1>אירעה שגיאה</h1>
          <p>משהו השתבש. נסו לרענן את הדף, ואם הבעיה נמשכת פנו לתמיכה.</p>
        </div>
      </body>
    </html>
  );
}
