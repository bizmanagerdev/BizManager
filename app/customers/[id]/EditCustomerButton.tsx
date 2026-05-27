"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditCustomerDialog, type EditCustomerInput } from "@/components/customers/EditCustomerDialog";

export default function EditCustomerButton({
  customer,
  iconOnly = false,
  className,
}: {
  customer: EditCustomerInput;
  iconOnly?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      {iconOnly ? (
        <Button
          variant="outline"
          size="icon"
          className={className ?? "h-9 w-9 rounded-xl"}
          onClick={() => setOpen(true)}
          aria-label="עריכת לקוח"
          title="עריכת לקוח"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" className={className} onClick={() => setOpen(true)}>
          עריכת לקוח
        </Button>
      )}
      <EditCustomerDialog
        open={open}
        onOpenChange={setOpen}
        customer={customer}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
