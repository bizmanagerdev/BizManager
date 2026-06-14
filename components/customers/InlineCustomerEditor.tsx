"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { offlineFetch } from "@/lib/offline-queue";

export type InlineCustomerUpdate = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
};

export interface InlineCustomerEditorProps {
  customerId: string;
  name?: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  disabled?: boolean;
  onUpdated?: (customer: InlineCustomerUpdate) => void;
}

type FieldKey = "name" | "phone" | "whatsapp" | "email" | "address";

const FIELD_LABELS: Record<FieldKey, string> = {
  name: "שם לקוח",
  phone: "טלפון",
  whatsapp: "וואטסאפ",
  email: "אימייל",
  address: "כתובת",
};

export function InlineCustomerEditor({
  customerId,
  name,
  phone,
  whatsapp,
  email,
  address,
  disabled = false,
  onUpdated,
}: InlineCustomerEditorProps) {
  const initial: Record<FieldKey, string> = {
    name: name ?? "",
    phone: phone ?? "",
    whatsapp: whatsapp ?? "",
    email: email ?? "",
    address: address ?? "",
  };
  const [values, setValues] = useState<Record<FieldKey, string>>(initial);
  const savedRef = useRef<Record<FieldKey, string>>(initial);
  const [savingField, setSavingField] = useState<FieldKey | null>(null);
  const [savedField, setSavedField] = useState<FieldKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Refetch the canonical customer record whenever the selected id changes,
  // so we don't show stale or partial values from the parent.
  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSavedField(null);
    void (async () => {
      try {
        const res = await fetch(`/api/customers/${customerId}`, { signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as {
          customer?: {
            id: string;
            name: string | null;
            phone: string | null;
            whatsapp: string | null;
            email: string | null;
            address: string | null;
          };
        };
        if (!json.customer) return;
        const toStr = (v: string | null | undefined) =>
          typeof v === "number" ? String(v) : (v ?? "");
        const next: Record<FieldKey, string> = {
          name: toStr(json.customer.name),
          phone: toStr(json.customer.phone),
          whatsapp: toStr(json.customer.whatsapp),
          email: toStr(json.customer.email),
          address: toStr(json.customer.address),
        };
        setValues(next);
        savedRef.current = next;
      } catch {
        // ignore — aborted or network error
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [customerId]);

  async function commit(field: FieldKey) {
    const next = values[field].trim();
    const prev = savedRef.current[field];
    if (next === prev) return;
    if (field === "name" && !next) {
      setValues((current) => ({ ...current, name: prev }));
      setError("שם לקוח לא יכול להיות ריק.");
      return;
    }
    setSavingField(field);
    setError(null);
    try {
      const result = await offlineFetch(
        "/api/customers/update",
        { id: customerId, [field]: next || null },
        "עדכון לקוח"
      );
      if (result.queued) {
        // Saved on the device; reflect it locally so the field shows "saved".
        savedRef.current = { ...savedRef.current, [field]: next };
        setSavedField(field);
        setTimeout(() => {
          setSavedField((current) => (current === field ? null : current));
        }, 1500);
        return;
      }
      const json = result.ok
        ? (result.data as {
            customer?: {
              id: string;
              name: string;
              phone: string | null;
              whatsapp: string | null;
              email: string | null;
              address: string | null;
            };
          } | null)
        : null;
      if (!result.ok || !json?.customer) {
        setError((result.ok ? "עדכון לקוח נכשל." : result.error) || "עדכון לקוח נכשל.");
        setValues((current) => ({ ...current, [field]: prev }));
        return;
      }
      savedRef.current = {
        ...savedRef.current,
        [field]: next,
      };
      setSavedField(field);
      setTimeout(() => {
        setSavedField((current) => (current === field ? null : current));
      }, 1500);
      onUpdated?.({
        id: json.customer.id,
        name: json.customer.name,
        phone: json.customer.phone,
        whatsapp: json.customer.whatsapp,
        email: json.customer.email,
        address: json.customer.address,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה לא ידועה");
      setValues((current) => ({ ...current, [field]: prev }));
    } finally {
      setSavingField((current) => (current === field ? null : current));
    }
  }

  function renderField(field: FieldKey) {
    const inline =
      savingField === field ? (
        <span className="text-xs text-muted-foreground">שומר...</span>
      ) : savedField === field ? (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">נשמר</span>
      ) : null;

    return (
      <label className="space-y-1 text-sm">
        <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
          {FIELD_LABELS[field]}
          {inline}
        </span>
        <Input
          value={values[field]}
          disabled={disabled || loading || savingField === field}
          onChange={(e) => setValues((current) => ({ ...current, [field]: e.target.value }))}
          onBlur={() => void commit(field)}
        />
      </label>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">עריכת פרטי הלקוח</div>
        <span className="text-[10px] text-muted-foreground">שמירה אוטומטית ביציאה מהשדה</span>
      </div>
      {renderField("name")}
      <AdaptiveGrid variant="formTwo">
        {renderField("phone")}
        {renderField("whatsapp")}
      </AdaptiveGrid>
      {renderField("email")}
      {renderField("address")}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
