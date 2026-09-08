"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { AUTH_LOCK_EVENTS } from "@/lib/supabase/authLock";

/**
 * A timed-out auth-lock acquisition (see lib/supabase/authLock.ts) used to be
 * a silent freeze — a click that just did nothing for up to 10s, no user
 * feedback. This turns the actual failure into a visible toast so it reads
 * as "slow", not "broken", and doubles as an on-device signal while we
 * measure how often this really happens.
 */
export default function AuthLockToasts() {
  useEffect(() => {
    const onTimeout = () => {
      toast.error("החיבור מתעכב — נסה שוב בעוד רגע", { id: "auth-lock-timeout" });
    };
    window.addEventListener(AUTH_LOCK_EVENTS.timeout, onTimeout);
    return () => window.removeEventListener(AUTH_LOCK_EVENTS.timeout, onTimeout);
  }, []);

  return null;
}
