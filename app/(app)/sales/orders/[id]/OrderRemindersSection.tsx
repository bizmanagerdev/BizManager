"use client";

// תזכורות as a card whose "+" sits on the title line, like every other section
// header. EntityReminders owns the list and the dialog; this only lifts the
// "add" trigger up to the header (its own full-width button is hidden).

import { useState } from "react";
import { AddIcon, NotificationIcon } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/icon-button";
import { SECTION_ICON_CLASS, SectionCard } from "@/components/ui/section-card";
import EntityReminders from "@/components/reminders/EntityReminders";

export default function OrderRemindersSection({
  id,
  orderId,
  customerId,
  canManage,
}: {
  id?: string;
  orderId: string;
  customerId?: string;
  canManage: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <SectionCard
      id={id}
      icon={<NotificationIcon className={SECTION_ICON_CLASS} />}
      title="תזכורות"
      aside={
        // A section's "+" is a less important action: the soft style (dashed outline), the
        // same square as the delivery card's (owner, 2026-10-11).
        canManage ? (
          <IconButton icon={AddIcon} variant="soft" label="הוספת תזכורת" onClick={() => setAddOpen(true)} />
        ) : null
      }
    >
      <EntityReminders
        queryKey="order_id"
        queryId={orderId}
        links={{ order_id: orderId, customer_id: customerId }}
        category="order"
        canManage={canManage}
        hideAddButton
        addOpen={addOpen}
        onAddOpenChange={setAddOpen}
      />
    </SectionCard>
  );
}
