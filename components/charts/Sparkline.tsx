import { cn } from "@/lib/utils";

/** A zero day's stub, in viewBox units (~3px at the drawn size). */
const MIN_BAR = 3;

/**
 * A SPARKLINE: the shape of the last few days, and nothing else — no axes, no
 * gridlines, no labels, no tooltip. It costs ~28px of card height and turns
 * "3 on shift" into "3 on shift, and that's lower than usual".
 *
 * It also fits the board's privacy rule: a shape exposes no numbers, so a card
 * can show a trend over money or people without putting a figure on the screen
 * for whoever is standing behind you.
 *
 * RTL: time runs RIGHT TO LEFT — oldest on the right, NEWEST ON THE LEFT, where
 * a Hebrew reader's eye lands last and where the highlighted dot sits. Pass the
 * series oldest-first (the natural way to build it) and this reverses it.
 *
 * Hand-drawn SVG rather than a chart library: at this size a library would ship
 * a renderer, a legend system and a tooltip layer to draw seven points, and the
 * result would still need every one of its defaults turned off.
 */
export default function Sparkline({
  points,
  variant = "line",
  label,
  value,
  valueLabel,
  className,
}: {
  /** The series, OLDEST first. Fewer than two points draws nothing. */
  points: number[];
  /** A line for a level that flows (people on shift), bars for counts of things. */
  variant?: "line" | "bar";
  /** The quiet caption under it — e.g. "7 הימים האחרונים". */
  label?: string;
  /**
   * THE ANCHOR: the current value, printed beside the line. Defaults to the last
   * point. Without it a trend line floating on its own reads as decoration —
   * a shape with nothing to be the shape OF.
   */
  value?: number | string;
  /** What the anchor counts, in two or three words, under the number. */
  valueLabel?: string;
  className?: string;
}) {
  if (points.length < 2) return null;

  // RTL: reverse so index 0 is drawn at the RIGHT edge and the newest value ends
  // up at the left, under the reader's eye.
  const series = [...points].reverse();
  const width = 100;
  const height = 26;
  const max = Math.max(...series);
  const min = Math.min(...series);
  // A flat series would divide by zero and draw at the floor; sit it mid-height.
  const span = max - min || 1;
  const x = (i: number) => (i / (series.length - 1)) * width;
  const y = (value: number) => height - 2 - ((value - min) / span) * (height - 4);

  const anchor = value ?? points[points.length - 1];

  return (
    <div className={cn("min-w-0", className)}>
      {/* The number FIRST (RTL: the reader's side), then the shape it belongs to. */}
      <div className="flex items-center gap-2.5">
        <div className="shrink-0 leading-none">
          <div className="text-xl font-bold tabular-nums">{anchor}</div>
          {valueLabel ? <div className="mt-0.5 text-[11px] text-muted-foreground">{valueLabel}</div> : null}
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-7 min-w-0 flex-1"
          role="img"
          aria-label={label ?? "מגמה"}
        >
          {variant === "line" ? (
            <>
              <polyline
                points={series.map((point, i) => `${x(i)},${y(point)}`).join(" ")}
                fill="none"
                stroke="rgb(var(--secondary))"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {/* The newest point, on the left — the one the anchor number is. */}
              <circle cx={x(series.length - 1)} cy={y(series[series.length - 1])} r={2.5} fill="rgb(var(--secondary))" />
            </>
          ) : (
            series.map((point, i) => {
              const barWidth = width / (series.length * 1.6);
              const top = y(point);
              const newest = i === series.length - 1;
              // A day with nothing still gets a STUB, not a hairline: a 1px line
              // at the baseline reads as a rendering fault rather than as a zero.
              // Lighter, too, so it says "nothing here" rather than "a little".
              const zero = point === 0;
              const drawn = Math.max(height - 2 - top, zero ? MIN_BAR : 2);
              return (
                <rect
                  key={i}
                  x={x(i) - barWidth / 2}
                  y={height - 2 - drawn}
                  width={barWidth}
                  height={drawn}
                  rx={1}
                  className={zero ? "fill-secondary/15" : newest ? "fill-secondary" : "fill-secondary/35"}
                />
              );
            })
          )}
        </svg>
      </div>
      {label ? <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div> : null}
    </div>
  );
}
