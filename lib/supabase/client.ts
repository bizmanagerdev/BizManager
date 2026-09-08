import { createBrowserClient } from "@supabase/ssr";
import { instrumentedLock } from "./authLock";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Instrumented so slow/timed-out auth-lock acquisitions are actually
    // visible (Sentry + a toast) instead of a silent freeze — see
    // lib/supabase/authLock.ts.
    { auth: { lock: instrumentedLock } }
  );
}