"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Search, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { CustomerForm } from "@/components/customers/CustomerForm";
import {
  invalidateCustomerSearchIndex,
  useCustomerSearchIndex,
} from "@/hooks/useCustomerSearchIndex";

export type PickedCustomer = { id: string; name: string; phone: string | null };

/**
 * Searchable customer dropdown (instant, cached fuzzy search) with an inline
 * "add new customer" flow. Stores the selected customer's id + name.
 */
export function CustomerPicker({
  value,
  onChange,
  placeholder = "חיפוש לקוח...",
  disabled = false,
}: {
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { search, loading } = useCustomerSearchIndex();
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo(() => (open ? search(query, 30) : []), [open, query, search]);

  function pick(customer: { id: string; name: string; phone: string | null }) {
    onChange({ id: customer.id, name: customer.name, phone: customer.phone });
    setQuery(customer.name);
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
    setOpen(true);
  }

  return (
    <div className="relative">
      <div className="relative">
        <Input
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          placeholder={placeholder}
          className="pe-9"
        />
        {query ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            aria-label="ניקוי"
            className="absolute end-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>

      {open && !disabled ? (
        <div
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border bg-background shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="max-h-64 overflow-auto p-1">
            {loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">טוען לקוחות...</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">לא נמצאו לקוחות.</div>
            ) : (
              results.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => pick(customer)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm hover:bg-muted",
                    value?.id === customer.id && "bg-primary/5"
                  )}
                >
                  {value?.id === customer.id ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{customer.name}</span>
                    {customer.phone ? (
                      <span className="block text-xs text-muted-foreground">{customer.phone}</span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="border-t p-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full justify-center"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
            >
              <UserPlus className="h-4 w-4" />
              לקוח חדש
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <AdaptiveDialog size="form2xl">
          <DialogHeader>
            <DialogTitle>לקוח חדש</DialogTitle>
          </DialogHeader>
          <CustomerForm
            mode="create"
            onCancel={() => setCreateOpen(false)}
            onSaved={({ customer }) => {
              invalidateCustomerSearchIndex();
              onChange({ id: customer.id, name: customer.name, phone: customer.phone });
              setQuery(customer.name);
              setCreateOpen(false);
            }}
            onUseExisting={({ customer }) => {
              onChange({ id: customer.id, name: customer.name, phone: customer.phone });
              setQuery(customer.name);
              setCreateOpen(false);
            }}
          />
        </AdaptiveDialog>
      </Dialog>
    </div>
  );
}
