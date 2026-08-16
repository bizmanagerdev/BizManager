import { cn } from "@/lib/utils";

// Curated bold avatar colors — each from a clearly different hue family (no two
// look alike, e.g. no second "green"), all strong and readable with white text
// (no muddy browns/olives). Ordered so the first users assigned get the most
// distinct colors. Assign by index (see buildColorIndexMap) for unique colors
// across a user set; the hash fallback keeps non-user avatars colorful too.
export const AVATAR_COLORS = [
  "#2563EB", // blue
  "#EA580C", // orange
  "#16A34A", // green
  "#DB2777", // pink
  "#9333EA", // purple
  "#0D9488", // teal
  "#DC2626", // red
  "#4F46E5", // indigo
] as const;

/** True if `value` is a valid 6-digit hex color (e.g. "#2563EB"). */
export function isHexColor(value: string | null | undefined): boolean {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

/**
 * A readable text color for the given background: dark text on light fills, white
 * on dark fills (perceived-luminance threshold). Returned as design tokens so we
 * never hardcode raw white. Lets users pick ANY color and keep the initials legible.
 */
export function textColorForBackground(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "rgb(var(--white))";
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "rgb(var(--foreground))" : "rgb(var(--white))";
}

const SIZES = {
  // xs is for dense rows (a board card's title line) where a 28px circle would
  // set the row height on its own.
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
} as const;

/**
 * Initials for a name: the first letter only for a single name, or the first
 * letters of the first and last names when there are two or more parts.
 * e.g. "מאיה" → "מ", "מאיה כהן" → "מכ".
 */
export function initialsForName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0];
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

function hashKey(key: string | null | undefined): number {
  const value = (key ?? "").trim();
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * Stable, collision-free color slots for a set of users. Sorting by id makes the
 * mapping deterministic and identical across every component that builds it from
 * the same user list, so a person's color matches on the card, in the picker and
 * on their comments. Wraps once there are more users than palette colors.
 */
export function buildColorIndexMap(ids: Array<string | null | undefined>): Map<string, number> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
  const map = new Map<string, number>();
  unique.forEach((id, i) => map.set(id, i));
  return map;
}

function backgroundFor(
  color: string | null | undefined,
  colorIndex: number | undefined,
  key: string | null | undefined
): string {
  // 1) An explicit, user-chosen color always wins (any valid hex). 2) Otherwise a
  // unique slot within a known user set. 3) Otherwise a stable hash of the key/name.
  if (isHexColor(color)) return (color as string).trim();
  const index =
    typeof colorIndex === "number" && colorIndex >= 0 ? colorIndex : hashKey(key) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

/**
 * Deterministic colored initials circle, reused across dashboard panels.
 * Resolution order for the fill: explicit `color` (the user's chosen color, any
 * hex) → `colorIndex` (from buildColorIndexMap, a unique slot in a known user
 * set) → `colorKey`/name hash. Text color auto-contrasts the fill.
 */
export function InitialsAvatar({
  name,
  color,
  colorKey,
  colorIndex,
  size = "sm",
  className,
}: {
  name: string | null | undefined;
  color?: string | null;
  colorKey?: string | null;
  colorIndex?: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const background = backgroundFor(color, colorIndex, colorKey ?? name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        SIZES[size],
        className
      )}
      style={{ backgroundColor: background, color: textColorForBackground(background) }}
      aria-hidden
    >
      {initialsForName(name)}
    </span>
  );
}
