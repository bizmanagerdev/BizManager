"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Renders an address as a link that opens Waze navigation to that address.
 * Use anywhere an address/city is *displayed* (not in form inputs). The Waze
 * universal link opens the app on mobile and the web map on desktop.
 *
 * Pass `address` (and optionally `city`) to build the navigation target; the
 * visible text defaults to the address but can be overridden via `children`
 * (e.g. to show "עיר · כתובת"). Falls back to plain text when there is no
 * address so it degrades gracefully.
 */
export interface AddressLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  address?: string | null;
  city?: string | null;
  /** Shown (unlinked) when there is nothing to navigate to. Defaults to "-". */
  fallback?: React.ReactNode;
}

function buildWazeUrl(query: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
}

export function AddressLink({
  address,
  city,
  fallback = "-",
  children,
  className,
  onClick,
  ...props
}: AddressLinkProps) {
  const addr = (address ?? "").trim();
  const town = (city ?? "").trim();
  // Skip the city when the address already contains it, to avoid "רחוב, עיר, עיר".
  const query = [addr, addr.includes(town) ? "" : town].filter(Boolean).join(", ");

  if (!query) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        {children ?? fallback}
      </span>
    );
  }

  return (
    <a
      href={buildWazeUrl(query)}
      target="_blank"
      rel="noopener noreferrer"
      title="נווט עם Waze"
      className={cn(
        "cursor-pointer transition-colors hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline",
        className
      )}
      onClick={(e) => {
        // Don't trigger a parent card/row click when the user taps the address.
        e.stopPropagation();
        onClick?.(e);
      }}
      {...props}
    >
      {children ?? query}
    </a>
  );
}
