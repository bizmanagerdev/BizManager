import { after } from "next/server";
import { logAuditEvent } from "@/lib/audit";

// logAuditEvent(), but after the response has been sent, so a save never waits
// on the activity log. It's the same write with the same error handling
// (logged, never thrown); Vercel keeps the function alive until it finishes,
// as it already does for orders/update's Morning auto-issue. On a quick-create
// save this was ~0.1 s of every response: the audit-switch read, then for
// trigger-audited tables (expenses, payments, tasks…) a lookup + actor backfill
// on the row the database trigger already wrote.
//
// Its own module (not lib/audit.ts) because lib/audit.ts is also imported by
// browser code and next/server's after() is server-only. Outside a request
// scope (scripts, unit tests) after() throws, so it just runs immediately.
export function logAuditEventAfterResponse(params: Parameters<typeof logAuditEvent>[0]): void {
  try {
    after(() => logAuditEvent(params));
  } catch {
    void logAuditEvent(params);
  }
}
