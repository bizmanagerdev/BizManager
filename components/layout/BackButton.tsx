"use client";

import { ArrowRightIcon } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { cn } from "@/lib/utils";
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
      // A size up on the glyph alone — the button keeps the bar's shared 40px box
      // so it still lines up with its neighbours. Back is the most-used control
      // up here and it was the same 18px as the icons you only glance at.
      className={cn(TOPBAR_ICON_BUTTON, "[&_svg]:!size-[22px]")}
      aria-label="חזרה"
      title="חזרה"
    >
      <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" strokeWidth={TOPBAR_ICON_STROKE} />
    </Button>
  );
}
