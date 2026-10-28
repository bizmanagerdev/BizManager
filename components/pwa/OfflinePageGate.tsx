"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { OfflineIcon } from "@/components/ui/icons";
import { useServerReachable } from "@/lib/pwa/connection";
import { markPageNotOnDevice, pageNotOnDevice, subscribePageNotOnDevice } from "@/lib/pwa/page-not-on-device";

/**
 * The page area: the page itself — or, for a page moved to with no connection
 * whose data isn't on the device (lib/pwa/page-not-on-device.ts), a word that
 * it isn't, in its place. The menu, the top bar and the red bar stay, so the
 * next page is a tap away. When the server answers again the page loads by
 * itself.
 */
export default function OfflinePageGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const notOnDevice = useSyncExternalStore(subscribePageNotOnDevice, pageNotOnDevice, () => null);
  const showing = notOnDevice !== null && notOnDevice === pathname + window.location.search;
  const reachable = useServerReachable();

  // Loaded once the server answers again — only after it was seen not
  // answering here: an answer still counted from before the move isn't one.
  const sawNoAnswer = useRef(false);
  const shown = useRef(false);
  useEffect(() => {
    if (!showing) {
      // Left (Back, say): the page is behind, and opens as usual next time.
      if (shown.current) markPageNotOnDevice(null);
      shown.current = false;
      sawNoAnswer.current = false;
      return;
    }
    shown.current = true;
    if (!reachable) sawNoAnswer.current = true;
    else if (sawNoAnswer.current) window.location.reload();
  }, [showing, reachable]);

  if (!showing) return children;
  return (
    <div dir="rtl" role="status" className="mx-auto mt-6 max-w-md">
      <EmptyState icon={<OfflineIcon className="h-8 w-8" />}>
        <h2 className="text-base font-semibold text-foreground">הדף הזה לא זמין בלי חיבור</h2>
        <p className="mt-1">המידע שלו לא שמור במכשיר, והוא יופיע כשיחזור החיבור. אפשר לעבור בינתיים לדפים אחרים.</p>
      </EmptyState>
    </div>
  );
}
