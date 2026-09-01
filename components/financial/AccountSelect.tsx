"use client";

import { useEffect, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { getAccountKindLabel, type Account } from "@/lib/accounts";
import { fetchAccountsDirect } from "@/lib/accounts/accountsClient";

// Module-level cache so multiple pickers on one page (and re-mounts) share a
// single fetch of the accounts list.
let cache: Account[] | null = null;
let inflight: Promise<Account[]> | null = null;

async function fetchAccounts(): Promise<Account[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetchAccountsDirect()
      .then((accounts) => {
        cache = accounts.filter((a) => a.isActive);
        return cache;
      })
      .catch(() => {
        cache = [];
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Invalidate the cache after accounts are created/edited in settings. */
export function invalidateAccountsCache() {
  cache = null;
}

/** Shared loader (cache-aware) for callers that render their own account UI. */
export function loadAccounts(): Promise<Account[]> {
  return fetchAccounts();
}

type Props = {
  value: string;
  onChange: (accountId: string) => void;
  /** Called once accounts load, so the parent can apply a method-based default. */
  onLoaded?: (accounts: Account[]) => void;
  disabled?: boolean;
  className?: string;
  /** Show a "*" on the label to signal the field is required. */
  required?: boolean;
  /** Render with a red border (e.g. submit attempted with no account chosen). */
  invalid?: boolean;
};

/**
 * Optional account assignment dropdown — which bank/cash container this money
 * moves through. Self-fetches the active accounts; renders nothing until they
 * load and nothing at all if no accounts are configured (the feature is opt-in).
 */
export default function AccountSelect({
  value,
  onChange,
  onLoaded,
  disabled,
  className,
  required,
  invalid,
}: Props) {
  const [accounts, setAccounts] = useState<Account[]>(cache ?? []);
  const [loaded, setLoaded] = useState<boolean>(cache != null);

  useEffect(() => {
    let active = true;
    void fetchAccounts().then((list) => {
      if (!active) return;
      setAccounts(list);
      setLoaded(true);
      onLoaded?.(list);
    });
    return () => {
      active = false;
    };
    // onLoaded intentionally excluded — parents pass an inline callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded || accounts.length === 0) return null;

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">חשבון{required ? " *" : ""}</label>
      <SearchableSelect
        ariaLabel="חשבון"
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={cn(invalid && "border-destructive focus-visible:ring-destructive", className)}
        emptyOptionLabel={required ? undefined : "ללא שיוך"}
        placeholder=""
        options={accounts.map((a) => ({
          value: a.id,
          label: a.name,
          hint: getAccountKindLabel(a.kind),
        }))}
      />
      {invalid ? <div className="text-xs text-destructive">יש לבחור חשבון.</div> : null}
    </div>
  );
}
