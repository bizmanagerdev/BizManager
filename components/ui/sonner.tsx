"use client";

import * as React from "react";
import { CloseIcon, SpinnerIcon } from "@/components/ui/icons";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// How long a toast stays on screen (owner, 2026-10-09: shorter, and every
// toast gets an X). A plain notice — saved, sent, copied — is read at a
// glance: 3 s. An error or a warning says what went wrong and what to do, so
// it gets 5 s. The X closes either one sooner. A toast that passes its own
// duration keeps it: lib/undo-engine.ts holds its "בטל" toast for the whole
// undo window (the save happens when that window ends), and an offer with a
// button ("עדכן", "פתח וואטסאפ ווב") stays long enough to press it.
export const TOAST_DURATION_MS = 3000;
export const TOAST_READ_DURATION_MS = 5000;

// Sonner has one default duration for every kind of toast, so the longer one
// for errors and warnings is set here, once, on the shared `toast` that every
// file imports from "sonner". A duration the caller passes still wins. The
// mark keeps a module re-run (Fast Refresh) from wrapping it twice.
const READ_DURATION_SET = Symbol.for("bizh.toast-read-duration");
const shared = toast as typeof toast & { [READ_DURATION_SET]?: true };
if (!shared[READ_DURATION_SET]) {
  shared[READ_DURATION_SET] = true;
  for (const kind of ["error", "warning"] as const) {
    const show = toast[kind];
    toast[kind] = (message, data) =>
      show(message, { ...data, duration: data?.duration ?? TOAST_READ_DURATION_MS });
  }
}

// A plain toast("…") has no type, so none of the coloured backgrounds below
// applied and it showed as white text straight on the page — the undo's
// "… בוטל." and the vehicle-date offer ("לעדכן גם את תוקף…?") could hardly
// be read. It gets a neutral dark slate, and no icon room since it has no icon.
const plainToast = [
  "[&:not([data-type])]:bg-[#334155] [&:not([data-type])]:ps-5",
  "[&:not([data-type])]:shadow-[0_22px_48px_-18px_rgba(51,65,85,0.6),0_8px_20px_-10px_rgba(51,65,85,0.4)]",
].join(" ");

// The icon is pulled OUT of flow (absolute, top-start corner) instead of
// sitting inline before the text. That leaves the title/description as the
// only in-flow item on the first line, so it always gets the toast's FULL
// width — with up to two action buttons (see undo-engine.ts's "בטל" +
// "צפייה") also competing for that one row, the text used to be squeezed
// into a sliver so narrow it broke mid-word, one letter per line (user,
// 2026-09-10). `ps-[4.25rem]` reserves exactly the room the icon+gap used to
// take inline, so the flex-wrap below drops the buttons to their own row
// underneath the text instead of cramming everything onto one line.
// `pe-11` does the same at the other end for the X (top-end corner), so the
// first line of text never runs under it; a loading toast has no X (sonner
// draws none while it's still working), so it keeps the narrower end.
const baseToast = [
  "group toast pointer-events-auto relative",
  "flex w-full max-w-md flex-wrap items-start gap-x-3 gap-y-2",
  "rounded-2xl ps-[4.25rem] pe-11 py-4 data-[type=loading]:pe-5",
  "text-base font-medium",
  "ring-1 ring-inset ring-white/15",
  plainToast,
  "animate-in fade-in-0 slide-in-from-top-4 md:slide-in-from-bottom-4 md:slide-in-from-top-0 duration-300",
].join(" ");

const baseTitle = "text-[15px] font-bold leading-tight text-white";
const baseDescription = "text-sm leading-snug text-white/90";
const baseIcon = [
  "absolute start-5 top-4 size-9 shrink-0",
  "flex items-center justify-center",
  "rounded-full bg-white/20",
  "[&_svg]:size-5 [&_svg]:text-white",
  "[&_.sonner-loader]:static [&_.sonner-loader]:transform-none",
].join(" ");
// The X: a small round button in the top-end corner (top-left in Hebrew),
// across from the icon. The ::before stretches what a finger can hit to
// 44px without making the circle itself any bigger.
const baseCloseButton = [
  "absolute end-2 top-2 flex size-7 items-center justify-center",
  "rounded-full bg-white/15 text-white transition hover:bg-white/30",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
  "before:absolute before:-inset-2 before:content-['']",
  "[&_svg]:pointer-events-none [&_svg]:size-4",
].join(" ");

function useResponsivePosition() {
  const [position, setPosition] = React.useState<"top-center" | "bottom-center">("bottom-center");
  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setPosition(mql.matches ? "top-center" : "bottom-center");
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return position;
}

export function Toaster(props: ToasterProps) {
  const position = useResponsivePosition();
  return (
    <Sonner
      theme="light"
      position={position}
      expand
      visibleToasts={4}
      duration={TOAST_DURATION_MS}
      closeButton
      className="toaster group"
      icons={{
        loading: <SpinnerIcon className="size-5 animate-spin text-white" />,
        close: <CloseIcon aria-hidden="true" />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: "סגירה",
        classNames: {
          toast: baseToast,
          title: baseTitle,
          description: baseDescription,
          icon: baseIcon,
          // w-full (not flex-1/min-w-0): the first in-flow child now claims
          // the whole row on its own, which is what pushes action/cancel
          // buttons onto a wrapped second row instead of sharing this one.
          content: "w-full min-w-0 space-y-1",
          actionButton:
            "rounded-lg bg-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/30 transition",
          cancelButton:
            "rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/90 hover:bg-white/20 transition",
          closeButton: baseCloseButton,
          success:
            "bg-[#1CB452] text-white shadow-[0_22px_48px_-18px_rgba(28,180,82,0.65),0_8px_20px_-10px_rgba(28,180,82,0.45)]",
          error:
            "bg-[#E41312] text-white shadow-[0_22px_48px_-18px_rgba(228,19,18,0.65),0_8px_20px_-10px_rgba(228,19,18,0.45)]",
          warning:
            "bg-[#FF9232] text-white shadow-[0_22px_48px_-18px_rgba(255,146,50,0.65),0_8px_20px_-10px_rgba(255,146,50,0.45)]",
          info:
            "bg-[#067EE9] text-white shadow-[0_22px_48px_-18px_rgba(6,126,233,0.65),0_8px_20px_-10px_rgba(6,126,233,0.45)]",
          loading:
            "bg-[#0369A1] text-white shadow-[0_22px_48px_-18px_rgba(3,105,161,0.6),0_8px_20px_-10px_rgba(3,105,161,0.4)]",
        },
      }}
      {...props}
    />
  );
}
