import type { ReactNode } from "react";
import type { IconComponent } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * THE header every dashboard card wears, so the board reads as one system rather
 * than seven cards that each invented their own title row.
 *
 * Three parts and no more: the icon in a soft chip (the only place the board uses
 * a filled accent — it's what gives each card an identity at a glance), the name,
 * and an optional count. A hairline closes it off, which is what separates the
 * header from the list BELOW it — the rows themselves carry no borders, so the
 * card has exactly one frame instead of a frame per row.
 *
 * `meta` is for a second line (a date, "החודש הנוכחי"); `action` for a chevron or
 * a control that has to sit at the far end.
 */
export default function DashboardCardHeader({
  icon: Icon,
  title,
  count,
  meta,
  spark,
  action,
  nowrap = false,
  className,
}: {
  icon: IconComponent;
  title: string;
  count?: number | null;
  meta?: ReactNode;
  /** A <Sparkline> — the shape of the last few days, under the title. */
  spark?: ReactNode;
  action?: ReactNode;
  /**
   * Keep the action on the title's LINE, whatever the width. A wrapping header
   * always drops the action to a second line the moment the two don't fit — flex
   * wraps before it shrinks — which is right for a wide control like the tasks
   * filter strip and wrong for a small one like the chart's month picker, where
   * the second line reads as a stray box. With this the title gives way instead.
   */
  nowrap?: boolean;
  className?: string;
}) {
  return (
    // NO background of its own (user, 2026-08-18: "I want the full card to be
    // white — right now the top has a hue"). The tint behind the title made the
    // card two colours, and because it painted OVER the card's hover it also
    // meant hovering coloured the header band alone instead of the whole card.
    // The rule under it is all the separation a header needs.
    <div className={cn("border-b border-border/50 px-4 py-3", className)}>
      <div className={cn("flex items-start justify-between gap-2", nowrap ? "flex-nowrap" : "flex-wrap")}>
        <div className="flex min-w-0 items-center gap-2">
          {/* A PLAIN glyph, no tinted chip behind it (user, 2026-08-18: "drop the
              title hue"). Seven blue chips down a board is seven small blocks of
              colour competing with the names beside them; the glyph alone still
              tells the card apart. */}
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h3 className={cn("text-base font-semibold leading-tight", nowrap && "min-w-0")}>{title}</h3>
        </div>
        {/* min-w-0 by default, NOT shrink-0: an action as wide as the tasks
            card's filter strip has to be allowed to wrap inside the header — at a
            large per-account text scale a fixed-width action ran off the card's
            edge. `nowrap` flips it: the action keeps its size and the title is
            what gives. */}
        {/* The count sits in the OPPOSITE corner, not against the title: beside
            the name it read as part of it ("המשימות שלי 7"), and at the far end
            it reads as the card's tally. */}
        <div className="flex shrink-0 items-center gap-2">
          {count != null && count > 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
          {action ? <div className={nowrap ? "shrink-0" : "min-w-0"}>{action}</div> : null}
        </div>
      </div>
      {meta ? <div className="mt-1 pe-10 text-xs text-muted-foreground">{meta}</div> : null}
      {/* The trend, under the title and inside the header band: a shape, no axes
          and no numbers, so it says "and that's lower than usual" without putting
          a figure on the screen. Indented past the icon so it starts under the
          words rather than under the chip. */}
      {spark ? <div className="mt-1.5 pe-10">{spark}</div> : null}
    </div>
  );
}
