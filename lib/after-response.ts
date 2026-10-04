import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";

// Work a save route does for someone other than the person who pressed Save —
// push notifications to assignees, Morning auto-issued receipts/invoices — run
// after the response has been sent, so the dialog closes without waiting on
// them. Vercel keeps the function alive until it finishes (the same mechanism
// as lib/audit-after.ts and orders/update's Morning auto-issue).
//
// The save has already succeeded by then, so a failure here is reported to
// Sentry and the console, never thrown. Outside a request scope (scripts, unit
// tests) after() throws, so the work just starts immediately instead.
export function runAfterResponse(label: string, task: () => Promise<unknown>): void {
  const run = () =>
    task().catch((err: unknown) => {
      console.error(`${label} failed after the response`, err);
      Sentry.captureException(err, { tags: { after_response: label } });
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
