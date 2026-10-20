// The slices of a category donut (components/charts/CategoryDonut.tsx): the
// five biggest and "אחר" for the rest, in a fixed order of validated colours
// (dataviz skill, references/palette.md — blue, orange, aqua, yellow,
// magenta; checked with scripts/validate_palette.js on white: every gate
// passes, the contrast warning is met by the labelled list). Kept apart from
// the chart so the list can draw before the chart's code arrives.

export type CategoryDonutDatum = { label: string; value: number };
export type DonutSlice = { label: string; value: number; color: string; share: number };

export const SLICE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;
export const OTHER_COLOR = "#a8a7a0";
const OTHER_LABEL = "אחר";

export function donutSlices(data: CategoryDonutDatum[], maxSlices = SLICE_COLORS.length): DonutSlice[] {
  const positive = data.filter((d) => d.value > 0);
  const total = positive.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) return [];
  // Biggest first; a tie keeps one order (the name).
  const sorted = [...positive].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "he"));
  const head = sorted.slice(0, Math.min(maxSlices, SLICE_COLORS.length));
  const rest = sorted.slice(head.length);
  const slices: DonutSlice[] = head.map((d, i) => ({
    label: d.label,
    value: d.value,
    color: SLICE_COLORS[i],
    share: d.value / total,
  }));
  if (rest.length > 0) {
    const value = rest.reduce((sum, d) => sum + d.value, 0);
    slices.push({ label: OTHER_LABEL, value, color: OTHER_COLOR, share: value / total });
  }
  return slices;
}
