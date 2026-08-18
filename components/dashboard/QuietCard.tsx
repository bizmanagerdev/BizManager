import Link from "next/link";
import type { IconComponent } from "@/components/ui/icons";
import { Card } from "@/components/ui/card";

/**
 * A card with nothing to report, collapsed to ONE LINE: its glyph, its name, and
 * the answer. No header, no rule, no list — just enough to say "this one is
 * clear" and keep its place in the column.
 *
 * The alternative is a card that VANISHES, and then you're left wondering where
 * אספקות went — did it break, did I hide it, or is there simply nothing? A board
 * whose contents change shape with the data teaches you to distrust it. This
 * costs one line and answers the question.
 *
 * It stays a link, so the empty state is still the way in: "no deliveries today"
 * is exactly when you want to open the queue and see what's coming.
 */
export default function QuietCard({
  icon: Icon,
  title,
  note,
  href,
  label,
}: {
  icon: IconComponent;
  /** The card's own name — the same one it wears when it has something. */
  title: string;
  /** What there isn't, in the card's own words: "אין משלוחים פתוחים". */
  note: string;
  href: string;
  /** For the link, when the title alone doesn't say where it goes. */
  label?: string;
}) {
  return (
    <Card>
      <Link
        href={href}
        aria-label={label ?? title}
        className="flex items-center gap-2.5 rounded-[1.125rem] px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* The same plain glyph DashboardCardHeader uses, so a quiet card reads
            as the same card — just with nothing in it. */}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{note}</span>
      </Link>
    </Card>
  );
}
