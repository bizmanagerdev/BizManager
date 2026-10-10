import * as React from "react";

import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        // Placeholders a shade lighter than labels and values (owner, 2026-10-09: a hint
        // like "אם שונה משם הלקוח" read as if something had been typed).
        "flex min-h-[110px] w-full rounded-xl border border-input bg-background/80 px-4 py-3 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground/55 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
