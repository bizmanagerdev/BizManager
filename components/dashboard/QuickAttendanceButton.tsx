"use client";

import { AddIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

/**
 * Opens the top bar's "דיווח נוכחות" dialog from anywhere via the shared
 * `bizh:quick-create` window event — so the dashboard card can log a shift
 * without navigating off the dashboard (and without a second copy of the form).
 * Only the top-bar QuickCreateMenu listens; see components/layout/QuickCreateMenu.tsx.
 */
export default function QuickAttendanceButton({ label = "דיווח נוכחות" }: { label?: string }) {
  return (
    // Solid, not `outline`: a plain outlined button (bg-background + a hairline)
    // is the one thing buttons here may never be — see the fill rule in
    // components/ui/button.tsx. It sat next to the solid "לתור האישורים" looking
    // like a disabled twin.
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => window.dispatchEvent(new CustomEvent("bizh:quick-create", { detail: { action: "attendance" } }))}
    >
      <AddIcon className="h-4 w-4" />
      {label}
    </Button>
  );
}
