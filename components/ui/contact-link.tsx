"use client";

// A phone number or email address that does the right thing on the device you're
// actually holding.
//
// `tel:` and `mailto:` are protocol handlers, not URLs. On a phone they open the
// dialer or the mail app every time. On an office laptop with no registered
// handler — the common case on Windows without Phone Link — the browser silently
// does nothing, so the number reads as broken. Here a desktop click copies the
// value to the clipboard instead, which is what someone at a desk wanted anyway.
//
// The href stays on the element either way, so right-click → copy link, middle
// click, and mobile long-press all keep working.

import * as React from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type ContactKind = "tel" | "mailto";

const COPY_LABEL: Record<ContactKind, string> = {
  tel: "המספר הועתק",
  mailto: "כתובת המייל הועתקה",
};

/**
 * True when this looks like a mouse-driven machine rather than a touch device.
 * Pointer/hover media queries beat user-agent sniffing: a tablet with a mouse
 * reports fine+hover and genuinely should copy, while a touchscreen laptop that
 * can still place calls reports coarse and should not.
 */
function usesMouse(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * Stored numbers carry whatever punctuation someone typed ("052-123 4567").
 * Dialers mostly cope, but not universally — strip to digits and a leading +
 * for the href. The visible text and the copied text stay as entered.
 */
function telHref(value: string): string {
  const normalized = value.replace(/[^\d+]/g, "");
  return `tel:${normalized || value}`;
}

export interface ContactLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children"> {
  kind: ContactKind;
  /** The raw phone number or email address. */
  value: string;
  children?: React.ReactNode;
}

export function ContactLink({ kind, value, children, className, onClick, title, ...props }: ContactLinkProps) {
  // Resolved after mount, never during render: reading matchMedia while the
  // server renders would mismatch on hydration. Until it resolves the link
  // behaves exactly as it did before — a plain tel:/mailto: — so the pre-JS
  // state is never worse than today.
  const [isDesktop, setIsDesktop] = React.useState(false);
  React.useEffect(() => setIsDesktop(usesMouse()), []);

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    // Let the browser handle modified clicks (new tab, save, etc.) untouched.
    if (!isDesktop || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    void copyContactValue(kind, value);
  }

  const defaultTitle = kind === "tel" ? "חיוג" : "שליחת מייל";

  return (
    <a
      href={kind === "tel" ? telHref(value) : `mailto:${value}`}
      title={title ?? (isDesktop ? `${defaultTitle} · לחיצה מעתיקה` : defaultTitle)}
      className={cn("cursor-pointer", className)}
      onClick={handleClick}
      {...props}
    >
      {children ?? value}
    </a>
  );
}

async function copyContactValue(kind: ContactKind, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(COPY_LABEL[kind]);
  } catch {
    toast.error("ההעתקה נכשלה. סמנו את הטקסט והעתיקו ידנית.");
  }
}

export interface ContactTapZoneProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  kind: ContactKind;
  value: string;
  children: React.ReactNode;
}

/**
 * Same tap-to-call / click-to-copy behavior as ContactLink, but renders a
 * div instead of an <a> — for a block that mixes the contact value with
 * other text (e.g. a customer name) that must stay natively selectable.
 * An <a href="tel:…"> claims long-press for the browser's own link menu
 * over everything inside it, which blocks copying that other text.
 */
export function ContactTapZone({ kind, value, children, className, title, ...props }: ContactTapZoneProps) {
  const [isDesktop, setIsDesktop] = React.useState(false);
  React.useEffect(() => setIsDesktop(usesMouse()), []);

  function handleActivate() {
    if (isDesktop) {
      void copyContactValue(kind, value);
      return;
    }
    window.location.href = kind === "tel" ? telHref(value) : `mailto:${value}`;
  }

  const defaultTitle = kind === "tel" ? "חיוג" : "שליחת מייל";

  return (
    <div
      role="button"
      tabIndex={0}
      title={title ?? (isDesktop ? `${defaultTitle} · לחיצה מעתיקה` : defaultTitle)}
      className={cn("cursor-pointer", className)}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        handleActivate();
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export default ContactLink;
