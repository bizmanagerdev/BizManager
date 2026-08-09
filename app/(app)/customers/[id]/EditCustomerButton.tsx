"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EditCustomerDialog, type EditCustomerInput } from "@/components/customers/EditCustomerDialog";
import { EditButton } from "@/components/ui/icon-button";

// Always the shared pencil — there is no labelled variant, because "edit" looks
// the same on every screen in this app.
export default function EditCustomerButton({
  customer,
  className,
}: {
  customer: EditCustomerInput;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <EditButton onClick={() => setOpen(true)} label="עריכת לקוח" className={className} />
      <EditCustomerDialog
        open={open}
        onOpenChange={setOpen}
        customer={customer}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
