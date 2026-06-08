import { cn } from "@/lib/utils";

// Soft tinted avatar palettes (light bg + colored text) — on-brand, readable on
// the app's light surfaces, never white-on-white.
const PALETTES = [
  "bg-primary-10 text-primary-1",
  "bg-secondary-10 text-secondary-2",
  "bg-success-soft text-success-soft-foreground",
  "bg-warning-soft text-warning-soft-foreground",
  "bg-info-soft text-info-soft-foreground",
  "bg-destructive-soft text-destructive-soft-foreground",
] as const;

const SIZES = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
} as const;

/** First two Hebrew/Latin letters of a name, e.g. "מאיה כהן" → "מכ". */
export function initialsForName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[1][0]}`;
}

function paletteFor(name: string | null | undefined): string {
  const key = (name ?? "").trim();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTES[hash % PALETTES.length];
}

/** Deterministic colored initials circle, reused across dashboard panels. */
export function InitialsAvatar({
  name,
  size = "sm",
  className,
}: {
  name: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        SIZES[size],
        paletteFor(name),
        className
      )}
      aria-hidden
    >
      {initialsForName(name)}
    </span>
  );
}
