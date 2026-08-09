"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EditButton } from "@/components/ui/icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LoadingDots from "@/app/(app)/sales/orders/LoadingDots";
import NewOrderClient from "@/app/(app)/sales/orders/new/NewOrderClient";
import OrderConfirmDialog from "@/app/(app)/sales/orders/OrderConfirmDialog";

type Row = Record<string, unknown>;

type EditPayload = {
  customers: Row[];
  products: Row[];
  initialOrder: {
    id: string;
    customer_id: string;
    order_date: string;
    status: string;
    payment_status: string;
    discount_amount: number;
    needs_invoice: boolean | null;
    notes: string;
    items: {
      product_id: string;
      product_name: string;
      description?: string;
      quantity_ordered: number;
      unit_price: number;
      discount_amount: number;
      notes: string;
    }[];
  };
  initialPayments: {
    id: string;
    payment_date: string | null;
    amount_total: number;
    payment_method: string;
    reference_number: string;
    notes: string;
  }[];
};

export default function OrderEditDialog({
  orderId,
  triggerLabel = "עריכה",
  title = "עריכת הזמנה",
  description = "עדכון לקוח, פריטים ותשלומים בלי לעזוב את רשימת ההזמנות.",
  initialStatusOverride,
  allowOrderStatusEdit = false,
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  orderId: string;
  /** Tooltip on the pencil — says WHAT is edited. Never renders as text. */
  triggerLabel?: string;
  title?: string;
  description?: string;
  initialStatusOverride?: string;
  allowOrderStatusEdit?: boolean;
  /** Render only the dialog — for callers that trigger it from their own menu. */
  hideTrigger?: boolean;
  /** Control the dialog from outside (pairs with hideTrigger). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EditPayload | null>(null);
  const shouldUseConfirmDialog = allowOrderStatusEdit || initialStatusOverride === "delivered";

  useEffect(() => {
    if (shouldUseConfirmDialog) return;
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/orders/${orderId}/edit-data`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as EditPayload & { error?: string };
        if (!res.ok) {
          throw new Error(toHebrewError(json.error, "טעינת נתוני העריכה נכשלה."));
        }
        if (!cancelled) setData(json);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(toHebrewError(err, "טעינת נתוני העריכה נכשלה."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, orderId, shouldUseConfirmDialog]);

  if (shouldUseConfirmDialog) {
    return (
      <OrderConfirmDialog orderId={orderId} title={title} description={description} />
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : <EditButton onClick={() => setOpen(true)} label={triggerLabel} />}
      {/* Once the wizard is up it owns the frame: pinned step bar (with its own
          close button, hence hideClose), scrolling middle, pinned action bar.
          While loading there's no wizard yet, so the dialog keeps its own X. */}
      <DialogContent
        hideClose={Boolean(data)}
        className="flex max-h-[92svh] w-[calc(100%-1rem)] max-w-5xl flex-col gap-0 overflow-y-hidden p-0 sm:p-0"
      >
        {/* Visible only before the wizard mounts — it renders its own step heading. */}
        <DialogHeader className={data ? "sr-only" : "p-4 pb-0 sm:p-6 sm:pb-0"}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="p-4 sm:p-6">
            <LoadingDots
              label="טוען נתוני עריכה"
              description="מכין את פרטי הלקוח, המוצרים והתשלומים לעריכה."
            />
          </div>
        ) : null}
        {error ? <p className="p-4 text-sm text-destructive sm:p-6">{error}</p> : null}

        {data ? (
          <NewOrderClient
            customers={data.customers}
            products={data.products}
            customersError={null}
            productsError={null}
            mode="edit"
            initialOrder={data.initialOrder}
            initialPayments={data.initialPayments}
            initialStatusOverride={initialStatusOverride}
            allowOrderStatusEdit={allowOrderStatusEdit}
            embedded
            onCancel={() => setOpen(false)}
            onSubmitted={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
