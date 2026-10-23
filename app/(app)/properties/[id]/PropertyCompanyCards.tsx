"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditButton } from "@/components/ui/icon-button";
import { FormDialog } from "@/components/ui/form-dialog";
import { StatActionCard } from "@/components/ui/stat-action-card";
import {
  ExternalSiteLink,
  externalHref,
} from "@/components/ui/external-site-link";
import { BusinessIcon, ExternalLinkIcon, KeyIcon } from "@/components/ui/icons";
import { updateProperty } from "../actions";
import {
  PropertyManagementFields,
  PropertyOwnerCompanyFields,
  propertyToForm,
  type PropertyInput,
} from "../PropertyFormFields";
import type { Property } from "@/lib/properties";
import { scheduleDeferredAction } from "@/lib/undo-engine";

// A property whose rent a management company collects (owner, 2026-10-23, the Canada buildings): in its head row,
// beside "נכס", who manages it and the company that owns it — in place of the renter and this month's rent. Each
// edited on its own, as the page's other cards: only its keys are taken from the draft, onto a FRESH
// propertyToForm(property), so it never undoes another card's saved edit.

const MANAGEMENT_KEYS = [
  "rent_managed_by_company",
  "management_company_name",
  "management_portal_url",
  "management_notes",
] as const satisfies readonly (keyof PropertyInput)[];

const OWNER_COMPANY_KEYS = [
  "owner_company_name",
  "owner_company_number",
  "owner_company_type",
  "owner_company_url",
  "owner_company_notes",
] as const satisfies readonly (keyof PropertyInput)[];

const trimmed = (value: string) => value.trim() || null;

function managementPatch(input: PropertyInput): Partial<Property> {
  return {
    rentManagedByCompany: input.rent_managed_by_company,
    managementCompanyName: trimmed(input.management_company_name),
    managementPortalUrl: trimmed(input.management_portal_url),
    managementNotes: trimmed(input.management_notes),
  };
}

function ownerCompanyPatch(input: PropertyInput): Partial<Property> {
  return {
    ownerCompanyName: trimmed(input.owner_company_name),
    ownerCompanyNumber: trimmed(input.owner_company_number),
    ownerCompanyType: trimmed(input.owner_company_type),
    ownerCompanyUrl: trimmed(input.owner_company_url),
    ownerCompanyNotes: trimmed(input.owner_company_notes),
  };
}

/** Its fields in a dialog, saved with the undo window — shown as saved at once. */
function useCardEdit(
  propertyId: string,
  property: Property,
  key: string,
  keys: readonly (keyof PropertyInput)[],
  toPatch: (input: PropertyInput) => Partial<Property>,
) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState<Partial<Property> | null>(null);
  const shown: Property = override ? { ...property, ...override } : property;
  const [draft, setDraft] = useState<PropertyInput>(() =>
    propertyToForm(property),
  );

  function set<K extends keyof PropertyInput>(
    field: K,
    value: PropertyInput[K],
  ) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function openEdit() {
    setDraft(propertyToForm(shown));
    setOpen(true);
  }

  function save() {
    const saved = draft;
    const patch = toPatch(saved);
    setOpen(false);
    scheduleDeferredAction({
      key: `${key}:${propertyId}`,
      message: "הנכס עודכן.",
      onApplyOptimistic: () => setOverride(patch),
      onRevert: () => setOverride(null),
      onCommit: async () => {
        const fresh = propertyToForm(property);
        for (const k of keys) (fresh as Record<string, unknown>)[k] = saved[k];
        const result = await updateProperty(propertyId, fresh);
        if (!result.ok) return { ok: false, error: result.error };
        startTransition(() => {
          router.refresh();
        });
        return { ok: true };
      },
    });
  }

  return { shown, open, setOpen, draft, set, openEdit, save };
}

function Notes({ text }: { text: string | null }) {
  return text ? (
    <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
      {text}
    </p>
  ) : null;
}

/** "חברת ניהול" — its name, its owner portal a tap away, and what else is known about it. */
export function PropertyManagementCard({
  propertyId,
  property,
}: {
  propertyId: string;
  property: Property;
}) {
  const edit = useCardEdit(
    propertyId,
    property,
    "property-management",
    MANAGEMENT_KEYS,
    managementPatch,
  );
  const p = edit.shown;
  const portal = externalHref(p.managementPortalUrl);
  return (
    <>
      <StatActionCard
        id="management"
        icon={<KeyIcon className="h-5 w-5" />}
        label="חברת ניהול"
        value={p.managementCompanyName ?? "לא הוזנה"}
        valueClassName={
          p.managementCompanyName ? undefined : "text-muted-foreground"
        }
        subtitles={["השכירות מנוהלת על ידי החברה"]}
        details={
          p.managementPortalUrl
            ? [
                {
                  label: "פורטל",
                  value: <ExternalSiteLink url={p.managementPortalUrl} />,
                },
              ]
            : undefined
        }
        action={
          <div className="flex items-center gap-1.5">
            {portal ? (
              <Button asChild size="sm" className="flex-1">
                <a href={portal} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon className="h-4 w-4" />
                  לפורטל
                </a>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={edit.openEdit}
              >
                הוספת פרטי החברה
              </Button>
            )}
            {portal ? (
              <EditButton onClick={edit.openEdit} label="עריכת חברת הניהול" />
            ) : null}
          </div>
        }
      >
        {p.managementNotes ? <Notes text={p.managementNotes} /> : null}
      </StatActionCard>
      <FormDialog
        open={edit.open}
        onOpenChange={edit.setOpen}
        title="חברת ניהול"
        size="form2xl"
        onSubmit={edit.save}
        submitLabel="שמירה"
      >
        <div className="mt-4">
          <PropertyManagementFields form={edit.draft} set={edit.set} />
        </div>
      </FormDialog>
    </>
  );
}

/** The company that bought it, its facts beyond its name: its number and its registry page. */
function ownerCompanyFacts(p: Property): { label: string; value: ReactNode }[] {
  const facts: { label: string; value: ReactNode }[] = [];
  if (p.ownerCompanyNumber) {
    facts.push({
      label: "מספר חברה",
      value: (
        <span dir="ltr" className="tabular-nums">
          {p.ownerCompanyNumber}
        </span>
      ),
    });
  }
  if (p.ownerCompanyUrl)
    facts.push({
      label: "רשם החברות",
      value: <ExternalSiteLink url={p.ownerCompanyUrl} />,
    });
  return facts;
}

/** "חברה בעלת הנכס" — in the head row of a property a management company runs. */
export function PropertyOwnerCompanyCard({
  propertyId,
  property,
}: {
  propertyId: string;
  property: Property;
}) {
  const edit = useCardEdit(
    propertyId,
    property,
    "property-owner-company",
    OWNER_COMPANY_KEYS,
    ownerCompanyPatch,
  );
  const p = edit.shown;
  const facts = ownerCompanyFacts(p);
  return (
    <>
      <StatActionCard
        id="owner-company"
        icon={<BusinessIcon className="h-5 w-5" />}
        label="חברה בעלת הנכס"
        value={p.ownerCompanyName ?? "לא הוזנה"}
        valueClassName={
          p.ownerCompanyName ? undefined : "text-muted-foreground"
        }
        badges={
          p.ownerCompanyType ? (
            <Badge variant="neutral">{p.ownerCompanyType}</Badge>
          ) : null
        }
        details={facts.length > 0 ? facts : undefined}
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={edit.openEdit}
          >
            {p.ownerCompanyName ? "עריכת פרטי החברה" : "הוספת פרטי החברה"}
          </Button>
        }
      >
        {p.ownerCompanyNotes ? <Notes text={p.ownerCompanyNotes} /> : null}
      </StatActionCard>
      <OwnerCompanyDialog edit={edit} />
    </>
  );
}

/** The same, as a block of the "פרטים" card — a property with its own renters that a company owns. */
export function PropertyOwnerCompanyBlock({
  propertyId,
  property,
}: {
  propertyId: string;
  property: Property;
}) {
  const edit = useCardEdit(
    propertyId,
    property,
    "property-owner-company",
    OWNER_COMPANY_KEYS,
    ownerCompanyPatch,
  );
  const p = edit.shown;
  return (
    <section className="space-y-2" aria-label="חברה בעלת הנכס">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">חברה בעלת הנכס</h3>
        <EditButton onClick={edit.openEdit} label="עריכת החברה בעלת הנכס" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{p.ownerCompanyName}</span>
        {p.ownerCompanyType ? (
          <Badge variant="neutral">{p.ownerCompanyType}</Badge>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {ownerCompanyFacts(p).map((fact) => (
          <div key={fact.label} className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-muted-foreground">{`${fact.label}: `}</span>
            {fact.value}
          </div>
        ))}
      </div>
      <Notes text={p.ownerCompanyNotes} />
      <OwnerCompanyDialog edit={edit} />
    </section>
  );
}

function OwnerCompanyDialog({
  edit,
}: {
  edit: ReturnType<typeof useCardEdit>;
}) {
  return (
    <FormDialog
      open={edit.open}
      onOpenChange={edit.setOpen}
      title="חברה בעלת הנכס"
      size="form2xl"
      onSubmit={edit.save}
      submitLabel="שמירה"
    >
      <div className="mt-4">
        <PropertyOwnerCompanyFields form={edit.draft} set={edit.set} />
      </div>
    </FormDialog>
  );
}
