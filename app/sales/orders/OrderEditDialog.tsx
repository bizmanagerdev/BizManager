"use client";

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
import NewOrderClient from "@/app/sales/orders/new/NewOrderClient";

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
  title = "עריכת הזמנה",
  description = "עדכון לקוח, פריטים ותשלומים בלי לעזוב את רשימת ההזמנות.",
  initialStatusOverride,
  allowOrderStatusEdit = false,
}: {
  orderId: string;
  buttonLabel?: string;
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

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/orders/${orderId}/edit-data`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as EditPayload & { error?: string };
        if (!res.ok) {
          throw new Error(json.error ?? "טעינת נתוני העריכה נכשלה.");
        }
        if (!cancelled) setData(json);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "טעינת נתוני העריכה נכשלה.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        {buttonLabel}
      </Button>
      <DialogContent className="max-h-[92svh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loading ? <p className="text-sm text-muted-foreground">טוען נתוני עריכה...</p> : null}
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
