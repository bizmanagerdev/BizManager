"use client";

import { useSetPageTitle } from "@/components/layout/page-title-context";

/**
 * Declare a page's mobile header title from a SERVER component — the hook it
 * wraps is client-only, and a static title doesn't justify making the whole page
 * a client component. Renders nothing.
 */
export default function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  useSetPageTitle(title, subtitle);
  return null;
}
