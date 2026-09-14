"use client";

// Root-level error boundary: reports unhandled render errors to Sentry and shows
// a Hebrew fallback. Replaces the whole document when a top-level error occurs,
// so it must render its own <html>/<body>.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { reloadIfStaleBuild } from "@/lib/ui/auto-recover";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
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
