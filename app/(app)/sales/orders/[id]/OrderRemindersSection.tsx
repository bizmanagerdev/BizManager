"use client";

// תזכורות as a card whose "+" sits on the title line, like every other section
// header. EntityReminders owns the list and the dialog; this only lifts the
// "add" trigger up to the header (its own full-width button is hidden).

import { useState } from "react";
import { Bell, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
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
      icon={<Bell className="h-4 w-4" />}
      title="תזכורות"
      aside={
        canManage ? (
          <Button
            type="button"
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
