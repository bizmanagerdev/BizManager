import { cn } from "@/lib/utils";

type Props = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE = {
  sm: "h-7 w-10",
  md: "h-9 w-12",
  lg: "h-10 w-14",
} as const;

/**
 * Brand logo: three ascending chevrons (roofs/arrows pointing up) drawn in the
 * secondary color. No background tile, pointy edges.
 */
export function BrandMark({ size = "md", className }: Props) {
  return (
    <svg
      viewBox="0 0 32 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeMiterlimit={10}
      aria-hidden="true"
      className={cn("shrink-0 text-secondary", SIZE[size], className)}
    >
      <path d="M3 8 L16 2 L29 8" />
      <path d="M3 15 L16 9 L29 15" />
      <path d="M3 22 L16 16 L29 22" />
    </svg>
  );
}
