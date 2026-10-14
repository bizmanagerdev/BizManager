"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  EditCustomerDialog,
  type EditCustomerInput,
  type EditCustomerSavedPayload,
} from "@/components/customers/EditCustomerDialog";

/**
 * The customer's edit dialog, for the customer page: opened by the pencil, the
 * phone's ⋮, a contact's ⋮ and the branches' pencil (all on CustomerPageView).
 * An edit can touch nearly everything on the page — the name, the contacts,
 * the branches, the tags — so after it the page is read again; `onSaved`
 * hands the page what was saved first, so the notes and the active flag
 * change at once.
 */
export default function EditCustomerButton({
  customer,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: EditCustomerInput;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (payload: EditCustomerSavedPayload) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <EditCustomerDialog
      open={open}
      onOpenChange={onOpenChange}
      customer={customer}
      onSaved={(payload) => {
        onSaved?.(payload);
        startTransition(() => {
          router.refresh();
        });
      }}
    />
  );
}
