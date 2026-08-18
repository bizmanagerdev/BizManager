import Link from "next/link";
import { ArrowLeftIcon } from "@/components/ui/icons";

/**
 * THE way out of a card: one quiet line at its foot — "כל הנוכחות ←" — on every
 * card, in the same place, saying the same kind of thing.
 *
 * The card as a whole is still a link, and that's the shortcut. This is the
 * SIGNPOST: a card shows the first four of something and nothing on it says how
 * many there are or that a fuller list exists. Hence the count in the label —
 * "כל המשלוחים (10)" answers "is there more?" before you click.
 *
 * It is NOT the "button to a page" that got pulled out of the headers earlier
 * (2026-08-17). That was a filled control competing with the card's own title;
 * this is a text link at the bottom, which is where a list has always put its
 * "see the rest".
 *
 * `relative` + `pointer-events-auto`: the card's overlay link covers everything
 * under it, and this has to sit above it to take its own click. It's a SIBLING
 * of that link, not a child, so there's no nested <a>.
 */
export default function DashboardCardFooter({
  href,
  label,
  count,
}: {
  href: string;
  /** "כל הנוכחות" — the destination in the card's own words. */
  label: string;
  /** How many there are in total, when the card shows only the head of a list. */
  count?: number | null;
}) {
  return (
    <div className="pointer-events-auto relative mt-auto border-t border-border/50 px-4 py-2">
      <Link
        href={href}
        className="flex items-center gap-1 text-xs font-medium text-secondary transition-colors hover:text-secondary/80"
      >
        {label}
        {count != null && count > 0 ? <span className="tabular-nums">({count})</span> : null}
        {/* RTL: forward is leftward, so the arrow points the way the link goes. */}
        <ArrowLeftIcon className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
