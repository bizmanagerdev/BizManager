import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Breakpoint = "sm" | "md" | "lg" | "xl";

const DESKTOP_CLASS: Record<Breakpoint, string> = {
  sm: "hidden sm:block",
  md: "hidden md:block",
  lg: "hidden lg:block",
  xl: "hidden xl:block",
};

const MOBILE_CLASS: Record<Breakpoint, string> = {
  sm: "sm:hidden",
  md: "md:hidden",
  lg: "lg:hidden",
  xl: "xl:hidden",
};

/**
 * Renders both `desktop` and `mobile` and lets CSS pick one via `hidden` /
 * `{breakpoint}:hidden` — never a client-JS media-query branch, so there's no
 * hydration flicker and no SSR/CSR mismatch. `breakpoint` is where the desktop
 * view takes over (matches whatever breakpoint the page's table was already
 * built for — mostly `xl` in this app, some pages use `md`).
 */
export function ResponsiveDataView({
  breakpoint = "md",
  desktop,
  mobile,
  desktopClassName,
  mobileClassName,
}: {
  breakpoint?: Breakpoint;
  desktop: ReactNode;
  mobile: ReactNode;
  desktopClassName?: string;
  mobileClassName?: string;
}) {
  return (
    <>
      <div className={cn(DESKTOP_CLASS[breakpoint], desktopClassName)}>{desktop}</div>
      <div className={cn(MOBILE_CLASS[breakpoint], mobileClassName)}>{mobile}</div>
    </>
  );
}
