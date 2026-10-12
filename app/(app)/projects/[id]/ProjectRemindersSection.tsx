"use client";

// תזכורות as a collapsible section whose "+" lives on the header, like every
// other section on the page. EntityReminders owns the list and the dialog; this
// only lifts the "add" trigger up to the header (its own button is hidden).

import { useCallback, useState } from "react";
import { AddIcon, NotificationIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import EntityReminders from "@/components/reminders/EntityReminders";

export default function ProjectRemindersSection({
  id,
  projectId,
  customerId,
  canManage,
}: {
  id: string;
  projectId: string;
  customerId?: string;
  canManage: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  // The count only exists after EntityReminders fetches — an empty section then
  // stays folded, a non-empty one opens itself.
  const [count, setCount] = useState<number | null>(null);
  const handleCountChange = useCallback((next: number) => setCount(next), []);

  return (
    <CollapsibleSection
      id={id}
      openWhenEmptyKnown={count === null ? undefined : count > 0}
      // Every section's count and icon: the grey pill, the grey glyph (owner,
      // 2026-10-11 — the count was plain grey text, the icon navy).
      summary={count && count > 0 ? <SectionCount count={count} /> : null}
      title="תזכורות"
      icon={<NotificationIcon className={SECTION_ICON_CLASS} />}
      contentClassName="space-y-3"
      action={
        canManage ? (
          // A section's "+" is a less important action: the soft style (dashed outline), not the
          // page's bold main button (owner, 2026-10-11). The ::before takes its
          // 32px to 44 to tap.
          <Button
            type="button"
            variant="soft"
            size="sm"
            className="relative h-8 w-8 p-0 before:absolute before:-inset-1.5 before:content-['']"
            aria-label="הוספת תזכורת"
            title="הוספת תזכורת"
            onClick={() => setAddOpen(true)}
          >
            <AddIcon className="h-4 w-4" />
          </Button>
        ) : null
      }
    >
      <EntityReminders
        queryKey="project_id"
        queryId={projectId}
        links={{ project_id: projectId, customer_id: customerId }}
        category="project"
        canManage={canManage}
        hideAddButton
        addOpen={addOpen}
        onAddOpenChange={setAddOpen}
        onCountChange={handleCountChange}
      />
    </CollapsibleSection>
  );
}
