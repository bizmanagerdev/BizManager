"use client";

// תזכורות as a collapsible section whose "+" lives on the header, like every
// other section on the page. EntityReminders owns the list and the dialog; this
// only lifts the "add" trigger up to the header (its own button is hidden).

import { useCallback, useState } from "react";
import { Bell, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
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
      summary={count && count > 0 ? <span className="text-muted-foreground">{count}</span> : null}
      title="תזכורות"
      icon={<Bell className="h-4 w-4 text-primary" />}
      contentClassName="space-y-3"
      action={
        canManage ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="הוספת תזכורת"
            title="הוספת תזכורת"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-4 w-4" />
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
