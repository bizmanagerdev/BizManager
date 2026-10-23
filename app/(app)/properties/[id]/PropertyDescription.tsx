"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { siteName } from "@/components/ui/external-site-link";
import { cn } from "@/lib/utils";

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Its links pressable, each shown by its site's name — not a line-long address. */
function withLinks(text: string) {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        dir="ltr"
        className="font-medium text-secondary underline-offset-2 hover:underline"
      >
        {siteName(part)}
      </a>
    ) : (
      part
    ),
  );
}

/** A property's description under its address: its first line, as always; the rest, when there is more (a
 *  Canada building's company, links and down payment — owner, 2026-10-23: "save the money details in the
 *  comments or description of the property"), under "עוד פרטים", line by line, so the card stays its height. */
export function PropertyDescription({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [first, ...rest] = text.split("\n");
  const more = rest.join("\n").trim();
  return (
    <>
      <span className="break-words">{withLinks(first)}</span>
      {more ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="ms-1.5 inline-flex items-center gap-0.5 font-medium text-secondary hover:underline"
          >
            {open ? "פחות" : "עוד פרטים"}
            <ChevronDownIcon
              className={cn(
                "h-3 w-3 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
          {open ? (
            <div className="mt-1.5 whitespace-pre-line break-words leading-relaxed">
              {withLinks(more)}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
