"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

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
      size="icon"
      onClick={onClick}
      className="group rounded-full !bg-transparent !border-transparent !shadow-none text-foreground transition-all hover:!bg-accent hover:scale-110"
      aria-label="חזרה"
      title="חזרה"
    >
      <ArrowRight className="h-11 w-11 transition-transform group-hover:translate-x-0.5" strokeWidth={3} />
    </Button>
  );
}
