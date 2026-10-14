"use client";

import { useCallback, useState } from "react";
import { CalendarCheckIcon } from "@/components/ui/icons";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import PaymentPromises from "@/components/collections/PaymentPromises";
import type { PaymentPromise } from "@/lib/promises";
import { AddActionButton, SECTION_IDS, openSection } from "@/app/(app)/customers/[id]/customerSectionUi";

/**
 * הבטחות תשלום: open when a promise is still waiting to be kept, folded to its
 * header otherwise. The add form is behind the header's "+", as every
 * section's add is.
 */
export default function CustomerPromisesSection({
  customerId,
  promises,
}: {
  customerId: string;
  promises: PaymentPromise[];
}) {
  const initialPending = promises.filter((p) => p.status === "pending").length;
  const [pending, setPending] = useState(initialPending);
  const [formOpen, setFormOpen] = useState(false);
  const handleCount = useCallback((count: number) => setPending(count), []);

  return (
    <CollapsibleSection
      id={SECTION_IDS.promises}
      title="הבטחות תשלום"
      icon={<CalendarCheckIcon className={SECTION_ICON_CLASS} />}
      summary={<SectionCount count={pending} />}
      defaultOpen={initialPending > 0}
      action={
        <AddActionButton
          label="הבטחה"
          ariaLabel="הבטחת תשלום חדשה"
          onClick={() => {
            setFormOpen(true);
            openSection(SECTION_IDS.promises);
          }}
        />
      }
    >
      <PaymentPromises
        customerId={customerId}
        promises={promises}
        formOpen={formOpen}
        onFormOpenChange={setFormOpen}
        onPendingCountChange={handleCount}
      />
    </CollapsibleSection>
  );
}
