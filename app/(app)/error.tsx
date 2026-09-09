"use client";

// Route-boundary error fallback for every page under the authenticated app
// shell (dashboard/projects/sales/financial/tasks/customers/etc — this file
// sits inside app/(app)/layout.tsx, so it catches an error from the ROUTED
// PAGE without unmounting the sidebar/nav around it). Before this existed,
// any uncaught error anywhere in the app had nowhere to land except
// app/global-error.tsx, which replaces the ENTIRE document.
// Still reports to Sentry itself (nested error.tsx boundaries do NOT bubble
// into global-error.tsx, so skipping this would silently lose visibility).
//
// Copy deliberately does NOT blame "the internet connection" — that was
// this message's original wording, written around one confirmed trigger (a
// dropped connection mid client-side nav), but this boundary catches EVERY
// uncaught error, including genuine code bugs. Telling a user their own
// connection is at fault for a real bug is actively misleading (confirmed
// live: it read as "why do we keep coming back to this" rather than as a
// helpful explanation) and erodes trust in this message the next time it's
// actually a connection issue. Matches global-error.tsx's honest, generic
// wording instead.
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { RefreshIcon, WarningIcon } from "@/components/ui/icons";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      dir="rtl"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <WarningIcon className="h-10 w-10 text-warning-soft-foreground" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">אירעה תקלה בטעינת הדף</h2>
        <p className="text-sm text-muted-foreground">
          משהו השתבש. ניתן לנסות שוב, ואם הבעיה נמשכת יש לפנות לתמיכה.
        </p>
      </div>
      <Button onClick={() => reset()}>
        <RefreshIcon />
        נסה שוב
      </Button>
    </div>
  );
}
