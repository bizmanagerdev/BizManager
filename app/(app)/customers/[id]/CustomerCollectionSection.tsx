"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PhoneCallIcon } from "@/components/ui/icons";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import CollectionTrackingPanel, { type CollectionPanelData } from "@/components/collections/CollectionTrackingPanel";
import { AddActionButton, SECTION_IDS, openSection } from "@/app/(app)/customers/[id]/customerSectionUi";

export type CollectionFormRequest = { form: "call" | "reminder"; key: number };

/**
 * גבייה ושיחות on the customer page: what the customer owes, the open
 * reminders, the call log and the forms to add to them (CollectionTrackingPanel,
 * inline). It starts from what the page already read — the panel used to fetch
 * it all again after the page, the receivables included. Open when there's a
 * debt or an open reminder; folded to its header otherwise.
 *
 * A call or a reminder updates the panel in place; only a payment marked
 * collected — which changes the debt itself — has the page read again, for
 * the money card.
 */
export default function CustomerCollectionSection({
  customerId,
  customerName,
  customerPhone,
  initialData,
  hasDebt,
  formRequest,
  onRequestForm,
  today,
}: {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  initialData: CollectionPanelData;
  hasDebt: boolean;
  formRequest: CollectionFormRequest | null;
  /** The header's "+" asks the page for the call form (the page's ⋮ does the same). */
  onRequestForm: (form: CollectionFormRequest["form"]) => void;
  /** Israel's today on the server (the first paint's "באיחור"). */
  today: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const initialOpen = initialData.reminders.filter((r) => r.status === "pending").length;
  const [openReminders, setOpenReminders] = useState(initialOpen);
  const handleCount = useCallback((count: number) => setOpenReminders(count), []);

  return (
    <CollapsibleSection
      id={SECTION_IDS.collection}
      title="גבייה ושיחות"
      icon={<PhoneCallIcon className={SECTION_ICON_CLASS} />}
      summary={<SectionCount count={openReminders} />}
      defaultOpen={hasDebt || initialOpen > 0}
      action={
        <AddActionButton
          label="שיחה"
          ariaLabel="תיעוד שיחה"
          onClick={() => {
            openSection(SECTION_IDS.collection);
            onRequestForm("call");
          }}
        />
      }
    >
      <CollectionTrackingPanel
        customerId={customerId}
        customerName={customerName}
        customerPhone={customerPhone}
        initialData={initialData}
        today={today}
        formRequest={formRequest}
        onOpenRemindersChange={handleCount}
        onChanged={(what) => {
          if (what === "money") startTransition(() => router.refresh());
        }}
        collapsibleForms
      />
    </CollapsibleSection>
  );
}
