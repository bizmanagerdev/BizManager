import type React from "react";

/**
 * The standard detail-page card: an icon + title on the header line, an optional
 * aside (count badge, "+" trigger) opposite it, and the section's body below.
 * Shared so every entity page's sections keep the same shell.
 */
export function SectionCard({
  id,
  icon,
  title,
  aside,
  children,
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 space-y-3 rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default SectionCard;
