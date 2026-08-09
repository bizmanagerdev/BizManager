"use client";

import { RefreshIcon } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { TOPBAR_ICON_BUTTON, TOPBAR_ICON_STROKE } from "@/components/layout/topbar-icon";

// Refreshes ONLY the current route's data (re-runs the server components for
// this page) via router.refresh() — no full browser reload, the app shell /
// sidebar / top bar stay mounted. Sits next to the back arrow in the top bar.
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Keep the icon spinning briefly even for instant refreshes so the tap
  // always gives visible feedback.
  const [spinning, setSpinning] = useState(false);

  const onClick = () => {
    if (isPending) return;
    setSpinning(true);
    emitNavigationStart();
    startTransition(() => {
      router.refresh();
    });
    window.setTimeout(() => setSpinning(false), 600);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      className={TOPBAR_ICON_BUTTON}
      aria-label="רענון"
      title="רענון"
    >
      <RefreshIcon
        className={spinning || isPending ? "animate-spin" : "transition-transform group-hover:rotate-90"}
        strokeWidth={TOPBAR_ICON_STROKE}
      />
    </Button>
  );
}
