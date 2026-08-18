import { cn } from "@/lib/utils";

type Props = {
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
};

// Height only — the width follows from the mark's own 100 × 90.92 aspect ratio.
// (The old hand-drawn chevrons were fixed h/w pairs at a wider 4:3 ratio; pinning
// both here would squash the real artwork.)
const SIZE = {
  xs: "h-4",
  sm: "h-7",
  md: "h-9",
  lg: "h-10",
} as const;

/**
 * Brand logo — the real Yaakov Heller mark: three stacked chevrons as filled
 * ribbons, each cut by the one above it. Filled with `currentColor` (defaults to
 * the secondary sky), so it inherits the text color of whatever chrome it sits in.
 *
 * The same geometry lives as standalone files in `public/brand/` for anywhere a
 * React component can't reach — PDFs, emails, print, `<img>` tags:
 *   heller-mark.svg        currentColor, for inline/CSS-colored use
 *   heller-mark-white.svg  white, for the navy chrome and dark backgrounds
 *   heller-watermark.svg   #161C2B at 4% opacity, for page/document watermarks
 * Keep the paths in sync if the artwork is ever revised.
 */
export function BrandMark({ size = "md", className }: Props) {
  return (
    <svg
      viewBox="0 0 100 90.92"
      fill="currentColor"
      aria-hidden="true"
      className={cn("w-auto shrink-0 text-secondary", SIZE[size], className)}
    >
      <path d="M 99.54 31.20 L 87.41 38.81 L 49.96 15.30 L 12.40 38.88 L 0.16 31.20 L 49.85 0.00 Z" />
      <path d="M 0.00 41.88 L 12.29 49.60 L 49.85 26.02 L 87.39 49.59 L 100.00 41.68 L 100.00 57.04 L 87.49 64.90 L 75.25 57.22 L 49.96 41.32 L 12.40 64.90 L 0.16 57.22 L 0.00 57.11 Z" />
      <path d="M 0.00 67.90 L 12.29 75.62 L 49.85 52.04 L 87.39 75.61 L 100.00 67.70 L 100.00 83.06 L 87.49 90.92 L 75.25 83.23 L 49.96 67.33 L 12.40 90.92 L 0.16 83.23 L 0.00 83.13 Z" />
    </svg>
  );
}
