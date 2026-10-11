"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /**
   * Grow with the text — the lines it WRAPS to as well as the ones typed — so
   * nothing sits hidden below the box's edge. `rows` only counts typed lines:
   * a long one-line task name showed its first line and hid the rest, more of
   * it the bigger the text size. Cap it with a max-h class; past that it scrolls.
   */
  autoGrow?: boolean;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoGrow = false, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );

    // Before paint, so a dialog opens with the box already the text's height
    // rather than growing a frame later.
    React.useLayoutEffect(() => {
      const el = innerRef.current;
      if (!autoGrow || !el) return;
      const fit = () => {
        el.style.height = "auto";
        // scrollHeight has the padding but not the border (border-box sizing).
        el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
      };
      fit();
      // A new width re-wraps the text: the phone turning, a dialog settling,
      // the text size changing. Only width — refitting on our own height change
      // would loop.
      let width = el.clientWidth;
      const observer = new ResizeObserver(() => {
        if (el.clientWidth === width) return;
        width = el.clientWidth;
        fit();
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, [autoGrow, props.value]);

    return (
      <textarea
        ref={setRefs}
        className={cn(
          // Placeholders a shade lighter than labels and values (owner, 2026-10-09: a hint
          // like "אם שונה משם הלקוח" read as if something had been typed).
          "flex min-h-[110px] w-full rounded-xl border border-input bg-background/80 px-4 py-3 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground/55 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
