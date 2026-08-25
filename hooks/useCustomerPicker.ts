"use client";

// The customer search/select state NewOrderClient and NewProjectClient each
// carried as an identical block of ~9 state atoms + a search effect + two
// derived values — found the same way `useStepFlow` was: reading both wizards
// side by side. Extracted here for that reason only; the JSX around it (the
// tab switcher, the result cards, the detail panel) stays in each file since
// it genuinely differs (a "requires prepayment" badge and an extra summary
// row only make sense for an order) — forcing that into one shared component
// would need a heavier prop surface than the markup it would save.
//
// Deliberately does NOT try to unify every tail behavior either: which field
// gets cleared after picking or saving a customer differs between the two
// callers on purpose (or at least, differently enough for long enough that
// changing it here would be a real behavior change, not a refactor) — this
// hook exposes the raw setters so each caller keeps doing that its own way.

import { useEffect, useMemo, useState } from "react";
import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";

export type CustomerPickerOption = {
  id: string;
  name: string;
  nameForInvoice: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  requiresPrepayment?: boolean;
  contacts?: Array<{ full_name: string; phone: string | null; email: string | null }>;
};

export function useCustomerPicker<T extends CustomerPickerOption>({
  initial,
  preselectedId = "",
  mapSearchResult,
}: {
  /** The caller's own already-mapped starting list (server-seeded). */
  initial: T[];
  preselectedId?: string;
  /** The caller's own mapper from a raw search-index entry to its option shape
   *  (`mapCustomerSearchResult` / `mapProjectCustomer`) — kept per-caller since
   *  the two option shapes aren't identical (only one carries `requiresPrepayment`). */
  mapSearchResult: (entry: Record<string, unknown>) => T | null;
}) {
  const [customerId, setCustomerId] = useState(preselectedId);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerTab, setCustomerTab] = useState<"existing" | "new">("existing");
  const [editingCustomer, setEditingCustomer] = useState(false);
  // Mobile master→detail: after a customer is picked the results list collapses
  // so the detail/edit card isn't buried under a long list (lg shows both).
  const [mobileListCollapsed, setMobileListCollapsed] = useState(false);
  // Held independently of the search results, so searching again doesn't drop
  // the current selection out of view.
  const [pickedCustomer, setPickedCustomer] = useState<T | null>(
    preselectedId ? initial.find((c) => c.id === preselectedId) ?? null : null
  );
  const [customerOptions, setCustomerOptions] = useState<T[]>(initial);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const { search: searchCustomerIndex, loading: customerIndexLoading } = useCustomerSearchIndex();

  useEffect(() => {
    setCustomerOptions(initial);
  }, [initial]);

  // Instant in-memory search over the cached customer index — no per-keystroke
  // network round-trip. Falls back to the caller's server-seeded list while it loads.
  useEffect(() => {
    setCustomerSearchError(null);
    if (customerIndexLoading) {
      setCustomerSearchLoading(true);
      if (!customerQuery.trim()) setCustomerOptions(initial);
      return;
    }
    setCustomerSearchLoading(false);
    const results = searchCustomerIndex(customerQuery, 50)
      .map((entry) => mapSearchResult(entry as Record<string, unknown>))
      .filter((row): row is T => Boolean(row));
    setCustomerOptions(results.length === 0 && !customerQuery.trim() ? initial : results);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerQuery, searchCustomerIndex, customerIndexLoading, initial]);

  // The search index already filters by name/email/phone/address/contacts —
  // just cap the result count, don't re-filter locally (that would incorrectly
  // exclude a contact-matched customer whose own fields don't contain the query).
  const filteredCustomers = useMemo(() => customerOptions.slice(0, 50), [customerOptions]);
  const selectedCustomer =
    pickedCustomer && pickedCustomer.id === customerId
      ? pickedCustomer
      : customerOptions.find((c) => c.id === customerId) ?? null;

  /** Merge a freshly created/edited customer into the local list and select it
   *  — the part that's identical between callers. Post-save cleanup that
   *  ISN'T identical (resetting the search query, switching the tab back) is
   *  left to the caller's own `onSaved`. */
  function mergeSavedCustomer(option: T) {
    setCustomerOptions((prev) => {
      if (prev.some((c) => c.id === option.id)) {
        return prev.map((c) => (c.id === option.id ? ({ ...option, contacts: c.contacts } as T) : c));
      }
      return [option, ...prev];
    });
    setPickedCustomer((prev) => (prev && prev.id === option.id ? ({ ...option, contacts: prev.contacts } as T) : option));
    setCustomerId(option.id);
    setEditingCustomer(false);
  }

  return {
    customerId,
    setCustomerId,
    customerQuery,
    setCustomerQuery,
    customerTab,
    setCustomerTab,
    editingCustomer,
    setEditingCustomer,
    mobileListCollapsed,
    setMobileListCollapsed,
    pickedCustomer,
    setPickedCustomer,
    customerOptions,
    customerSearchError,
    customerSearchLoading,
    filteredCustomers,
    selectedCustomer,
    mergeSavedCustomer,
  };
}
