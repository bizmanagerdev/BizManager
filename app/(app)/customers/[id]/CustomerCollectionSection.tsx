"use client";

import { useRouter } from "next/navigation";
import CollectionTrackingPanel from "@/components/collections/CollectionTrackingPanel";

// Inline (non-dialog) מעקב גבייה panel for the customer details page: shows what
// the customer owes, the call log and reminders, and lets the user add both.
// Refreshes the server-rendered stat cards after any mutation.
export default function CustomerCollectionSection({
  customerId,
  customerName,
  customerPhone,
}: {
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
}) {
  const router = useRouter();
  return (
    <CollectionTrackingPanel
      customerId={customerId}
      customerName={customerName}
      customerPhone={customerPhone}
      onChanged={() => router.refresh()}
      collapsibleForms
    />
  );
}
