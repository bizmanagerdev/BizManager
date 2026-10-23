import { ExternalLinkIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** A typed-in web address as a link: "https://…" as it is, "site.com/…" with https:// before it — anything else
 *  (a space, another scheme) is not a link. */
export function externalHref(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text || /\s/.test(text)) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]|$)/i.test(text))
    return `https://${text}`;
  return null;
}

/** The site's name — "redleafmanagement.managebuilding.com", not a line-long address. */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A link to another site, shown by its site's name, opening in a new tab. Not a link: the text as it is. */
export function ExternalSiteLink({
  url,
  label,
  className,
}: {
  url: string;
  /** Shown instead of the site's name. */
  label?: string;
  className?: string;
}) {
  const href = externalHref(url);
  if (!href) return <span className={cn("break-words", className)}>{url}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-w-0 items-center gap-1 font-medium text-secondary hover:underline",
        className,
      )}
    >
      <span dir="ltr" className="min-w-0 truncate">
        {label ?? siteName(href)}
      </span>
      <ExternalLinkIcon className="h-3 w-3 shrink-0" />
    </a>
  );
}
