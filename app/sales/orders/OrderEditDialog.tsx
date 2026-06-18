"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LoadingDots from "@/app/sales/orders/LoadingDots";
import NewOrderClient from "@/app/sales/orders/new/NewOrderClient";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";

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
    notes: string;
    items: {
      product_id: string;
      product_name: string;
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
  buttonLabel = "עריכה",
  buttonClassName,
  title = "עריכת הזמנה",
  description = "עדכון לקוח, פריטים ותשלומים בלי לעזוב את רשימת ההזמנות.",
  initialStatusOverride,
  allowOrderStatusEdit = false,
}: {
  orderId: string;
  buttonLabel?: React.ReactNode;
  buttonClassName?: string;
  title?: string;
  description?: string;
  initialStatusOverride?: string;
  allowOrderStatusEdit?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      <OrderConfirmDialog
        orderId={orderId}
        buttonLabel={buttonLabel}
        title={title}
        description={description}
        defaultStatus={initialStatusOverride ?? "delivered"}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={buttonClassName ?? "w-full sm:w-auto"}
        title={typeof title === "string" ? title : undefined}
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </Button>
      <DialogContent className="max-h-[92svh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <LoadingDots
            label="טוען נתוני עריכה"
            description="מכין את פרטי הלקוח, המוצרים והתשלומים לעריכה."
          />
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

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
