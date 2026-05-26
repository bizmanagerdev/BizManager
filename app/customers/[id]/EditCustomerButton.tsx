"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EditCustomerDialog, type EditCustomerInput } from "@/components/customers/EditCustomerDialog";

export default function EditCustomerButton({ customer }: { customer: EditCustomerInput }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        עריכת לקוח
      </Button>
      <EditCustomerDialog
        open={open}
        onOpenChange={setOpen}
        customer={customer}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
