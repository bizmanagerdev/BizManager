"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";

type Props = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: LinkProps["href"];
  end?: boolean;
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
};

function isActivePath(pathname: string, to: string, end: boolean) {
  if (end) return pathname === to;
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export const NavLink = React.forwardRef<HTMLAnchorElement, Props>(
  ({ className, activeClassName, pendingClassName, to, end = false, ...props }, ref) => {
    const pathname = usePathname() ?? "/";
    const toPath = typeof to === "string" ? to : (to as any).pathname ?? "/";

    const active = isActivePath(pathname, toPath, end);
    const [pending, setPending] = React.useState(false);
    const lastPathRef = React.useRef(pathname);

    React.useEffect(() => {
      if (pathname !== lastPathRef.current) {
        lastPathRef.current = pathname;
        setPending(false);
      }
    }, [pathname]);

    const onClick: React.MouseEventHandler<HTMLAnchorElement> = (e) => {
      props.onClick?.(e);
      if (e.defaultPrevented) return;
      setPending(true);
    };

    return (
      <Link
        ref={ref}
        href={to}
        className={cn(
          className,
          active && activeClassName,
          pending && pendingClassName
        )}
        onClick={onClick}
        {...props}
      />
    );
  }
);

NavLink.displayName = "NavLink";
