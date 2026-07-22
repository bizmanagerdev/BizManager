"use client";

// The customer's standing arrival details, shown where they belong — on the
// customer, not only on a live delivery.
//
// Until now these columns were only visible to a driver with an open delivery in
// the queue: once the delivery was confirmed the instructions someone had just
// worked out went invisible until that customer's next order. The office could
// neither check them nor fix them.
//
// Local state rather than router.refresh(): the dialog hands back exactly what it
// saved, so the block updates instantly without re-running the page's queries.

import { useState } from "react";
import { MapPin, Navigation, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeliveryLocationDialog } from "@/components/orders/DeliveryLocationDialog";
import { wazeLinkForPin, type DeliveryPin } from "@/lib/delivery-location";

export function CustomerDeliveryDetails({
  customerId,
  customerName,
  instructions: initialInstructions,
  pin: initialPin,
}: {
  customerId: string;
  customerName: string;
  instructions: string | null;
  pin: DeliveryPin | null;
}) {
  const [instructions, setInstructions] = useState(initialInstructions);
  const [pin, setPin] = useState(initialPin);
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 space-y-1.5 rounded-xl border border-border/70 bg-background/70 p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">הוראות הגעה</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3 w-3" />
          עריכה
        </Button>
      </div>

      <p className={instructions ? "whitespace-pre-wrap" : "text-muted-foreground"}>
        {instructions || "לא הוגדרו הוראות הגעה"}
      </p>

      {pin ? (
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-success" />
          <span className="font-medium">נשמרה נקודת מסירה</span>
          <a
            href={wazeLinkForPin(pin)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-secondary hover:underline"
          >
            <Navigation className="h-3 w-3" />
            ניווט
          </a>
        </div>
      ) : (
        <div className="text-muted-foreground">לא נשמרה נקודת מסירה — הניווט לפי הכתובת בלבד</div>
      )}

      <DeliveryLocationDialog
        open={open}
        onOpenChange={setOpen}
        customerId={customerId}
        customerName={customerName}
        initialInstructions={instructions}
        initialPin={pin}
        onSaved={(next) => {
          setInstructions(next.instructions);
          setPin(next.pin);
        }}
      />
    </div>
  );
}

export default CustomerDeliveryDetails;
