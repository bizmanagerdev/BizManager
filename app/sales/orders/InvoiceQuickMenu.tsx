"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { formatOrderDate } from "@/lib/orders/format";

type InvoiceState = "needs_unsent" | "needs_sent" | "no" | "undecided";

function invoiceState(needsInvoice: boolean | null, invoiceSentAt: string | null): InvoiceState {
  if (needsInvoice === false) return "no";
  if (needsInvoice === true) return invoiceSentAt ? "needs_sent" : "needs_unsent";
  return "undecided";
}

function invoiceBadge(state: InvoiceState): { label: string; className: string } {
  switch (state) {
    case "needs_sent":
      return { label: "הונפקה", className: getStatusColorClasses("success") };
    case "needs_unsent":
      return { label: "טרם הונפקה", className: getStatusColorClasses("warning") };
    case "no":
      return { label: "לא צריך חשבונית", className: getStatusColorClasses("neutral") };
    default:
      return { label: "חשבונית לא הוגדרה", className: getStatusColorClasses("neutral") };
  }
}

/** Plain colored text (no pill) matching how the other stat-card statuses render. */
function invoiceTextClass(state: InvoiceState) {
  switch (state) {
    case "needs_sent":
      return "text-success-soft-foreground";
    case "needs_unsent":
      return "text-primary";
    default:
      return "text-muted-foreground";
  }
}

/**
 * Dropdown for changing an order's invoice preference (needs / doesn't need /
 * mark issued / unmark). Shared by the orders list (badge variant) and the
 * order details stat card (text variant, styled like the other status values).
 */
export default function InvoiceQuickMenu({
  orderId,
  needsInvoice,
  invoiceSentAt,
  showSentDate = true,
  variant = "badge",
}: {
  orderId: string;
  needsInvoice: boolean | null;
  invoiceSentAt: string | null;
  showSentDate?: boolean;
  variant?: "badge" | "text";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const state = invoiceState(needsInvoice, invoiceSentAt);
  const badge = invoiceBadge(state);

  async function apply(update: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/orders/invoice-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, ...update }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "text" ? (
            <button
              type="button"
              disabled={busy}
              className={`inline-flex items-center gap-1 whitespace-nowrap text-lg font-bold leading-snug ${invoiceTextClass(state)} disabled:opacity-50`}
            >
              <span>{badge.label}</span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${badge.className} disabled:opacity-50`}
            >
              <span>{badge.label}</span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => void apply({ needs_invoice: true })}>צריך חשבונית</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void apply({ needs_invoice: false })}>לא צריך חשבונית</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={Boolean(invoiceSentAt)} onSelect={() => void apply({ invoice_sent: true })}>
            סמן כהונפקה
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!invoiceSentAt} onSelect={() => void apply({ invoice_sent: false })}>
            בטל סימון הנפקה
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {showSentDate && state === "needs_sent" && invoiceSentAt ? (
        <div className="text-[11px] text-muted-foreground">{formatOrderDate(invoiceSentAt)}</div>
      ) : null}
    </div>
  );
}
