"use client";

import * as React from "react";
import { SpinnerIcon } from "@/components/ui/icons";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const baseToast = [
  "group toast pointer-events-auto",
  "flex w-full max-w-md items-start gap-3",
  "rounded-2xl px-5 py-4",
  "text-base font-medium",
  "ring-1 ring-inset ring-white/15",
  "animate-in fade-in-0 slide-in-from-top-4 md:slide-in-from-bottom-4 md:slide-in-from-top-0 duration-300",
].join(" ");

const baseTitle = "text-[15px] font-bold leading-tight text-white";
const baseDescription = "text-sm leading-snug text-white/90";
const baseIcon = [
  "relative size-9 shrink-0",
  "flex items-center justify-center",
  "rounded-full bg-white/20",
  "[&_svg]:size-5 [&_svg]:text-white",
  "[&_.sonner-loader]:static [&_.sonner-loader]:transform-none",
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
      duration={5000}
      className="toaster group"
      icons={{
        loading: <SpinnerIcon className="size-5 animate-spin text-white" />,
      }}
      toastOptions={{
        unstyled: true,
        duration: 5000,
        classNames: {
          toast: baseToast,
          title: baseTitle,
          description: baseDescription,
          icon: baseIcon,
          content: "flex-1 min-w-0 space-y-1",
          actionButton:
            "rounded-lg bg-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/30 transition",
          cancelButton:
            "rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/90 hover:bg-white/20 transition",
          closeButton:
            "absolute end-2 top-2 rounded-full bg-white/15 p-1 text-white hover:bg-white/30 transition",
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
