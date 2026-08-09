"use client";

import { useMemo, useRef, useState } from "react";
import { AddUserIcon, CheckIcon, CloseIcon, SearchIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ViewDialog } from "@/components/ui/view-dialog";
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
  showCreate = true,
}: {
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Show the inline "add new customer" action. Off for filter-style use. */
  showCreate?: boolean;
}) {
  const { search, loading } = useCustomerSearchIndex();
  // `query` holds the active search text while the dropdown is open. When it is
  // closed the field shows the selected customer's name derived from `value`, so
  // external resets (e.g. a "clear filters" button) reflect automatically.
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayValue = open ? query : value?.name ?? "";
  const results = useMemo(() => (open ? search(query, 30) : []), [open, query, search]);

  function pick(customer: { id: string; name: string; phone: string | null }) {
    onChange({ id: customer.id, name: customer.name, phone: customer.phone });
    setQuery("");
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
          value={displayValue}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => {
            setQuery(value?.name ?? "");
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          placeholder={placeholder}
          className="pe-9"
        />
        {displayValue ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            aria-label="ניקוי"
            className="absolute end-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        ) : (
          <SearchIcon className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                    <CheckIcon className="h-4 w-4 shrink-0 text-primary" />
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
          {showCreate ? (
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
                <AddUserIcon className="h-4 w-4" />
                לקוח חדש
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* A ViewDialog, not a FormDialog: CustomerForm brings its own save/cancel
          buttons, so the chrome must not add a second primary action. */}
      <ViewDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="לקוח חדש"
        description="יצירת לקוח חדש בלי לצאת מהמסך."
        size="form2xl"
      >
          <CustomerForm
            mode="create"
            onCancel={() => setCreateOpen(false)}
            onSaved={({ customer }) => {
              invalidateCustomerSearchIndex();
              onChange({ id: customer.id, name: customer.name, phone: customer.phone });
              setQuery("");
              setCreateOpen(false);
            }}
            onUseExisting={({ customer }) => {
              onChange({ id: customer.id, name: customer.name, phone: customer.phone });
              setQuery("");
              setCreateOpen(false);
            }}
          />
      </ViewDialog>
    </div>
  );
}
