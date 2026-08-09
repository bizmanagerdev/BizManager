"use client";

import { ArrowRightIcon } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { TOPBAR_ICON_BUTTON, TOPBAR_ICON_STROKE } from "@/components/layout/topbar-icon";

export function BackButton() {
  const router = useRouter();

  const onClick = () => {
    emitNavigationStart();
    router.back();
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      className={TOPBAR_ICON_BUTTON}
      aria-label="חזרה"
      title="חזרה"
    >
      <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" strokeWidth={TOPBAR_ICON_STROKE} />
    </Button>
  );
}
