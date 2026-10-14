"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { AddIcon, ChatIcon, MailIcon, PhoneIcon, UserIcon, WazeIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ContactLink } from "@/components/ui/contact-link";
import { AddressLink } from "@/components/ui/address-link";
import { EmptyState } from "@/components/ui/empty-state";
import { EditButton } from "@/components/ui/icon-button";
import { MetaRow } from "@/components/ui/meta-row";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { WaitingBadge } from "@/components/ui/waiting-badge";
import RowActionsMenu from "@/app/(app)/sales/RowActionsMenu";
import { offlineFetch } from "@/lib/offline-queue";
import { scheduleDeferredAction } from "@/lib/undo-engine";
import { whatsappHref } from "@/lib/whatsapp";
import { useLocalAdditions } from "@/hooks/useLocalAdditions";
import AddContactButton from "@/app/(app)/customers/[id]/AddContactButton";
import { SECTION_IDS, openSection } from "@/app/(app)/customers/[id]/customerSectionUi";
import type { CustomerBranchRow, CustomerContactRow } from "@/app/(app)/customers/[id]/customerPageModel";

// אנשי קשר וסניפים: the people to talk to at this customer and the branches it
// orders for. Every phone, WhatsApp, email and address is the tap target of
// its app, a finger's size (40px). A contact added here shows at once — with
// no connection too, marked as waiting — and one removed (the row's quiet ⋮)
// moves to the inactive list at once, back on undo. Editing a contact or a
// branch is the customer's edit dialog, where they are kept.

// A link a finger can hit: 40px tall, with room around the glyph.
const LINK_CLASS =
  "inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs text-foreground transition-colors hover:bg-muted/40 hover:text-secondary";

function ContactLinks({ phone, whatsapp, email }: { phone: string | null; whatsapp: string | null; email: string | null }) {
  const waHref = whatsappHref(whatsapp);
  if (!phone && !waHref && !email) return null;
  return (
    <div className="-mx-2 mt-0.5 flex flex-wrap items-center">
      {phone ? (
        <ContactLink kind="tel" value={phone} className={LINK_CLASS}>
          <PhoneIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span dir="ltr">{phone}</span>
        </ContactLink>
      ) : null}
      {waHref && whatsapp ? (
        <a href={waHref} target="_blank" rel="noreferrer" title="וואטסאפ" className={LINK_CLASS}>
          <ChatIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span dir="ltr">{whatsapp}</span>
        </a>
      ) : null}
      {email ? (
        <ContactLink kind="mailto" value={email} className={LINK_CLASS}>
          <MailIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span dir="ltr" className="min-w-0 break-all">
            {email}
          </span>
        </ContactLink>
      ) : null}
    </div>
  );
}

export default function CustomerContactsSection({
  customerId,
  customerName,
  contacts,
  branches,
  onEditCustomer,
}: {
  customerId: string;
  customerName: string;
  contacts: CustomerContactRow[];
  branches: CustomerBranchRow[];
  /** Opens the customer's edit dialog — where contacts and branches are edited. */
  onEditCustomer: () => void;
}) {
  const local = useLocalAdditions<CustomerContactRow>(contacts);
  // Removed here (a soft delete — the contact turns inactive), or an add undone.
  const [deactivated, setDeactivated] = useState<ReadonlySet<string>>(new Set());
  const all = local.rows.map((contact) =>
    deactivated.has(contact.id) ? { ...contact, active: false, isPrimary: false } : contact
  );
  const activeContacts = all.filter((contact) => contact.active);
  const inactiveContacts = all.filter((contact) => !contact.active);

  function setInactive(id: string, inactive: boolean) {
    setDeactivated((prev) => {
      const next = new Set(prev);
      if (inactive) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function removeContact(contact: CustomerContactRow) {
    scheduleDeferredAction({
      key: `customer-contact:deactivate:${contact.id}`,
      message: "איש הקשר הוסר",
      onApplyOptimistic: () => setInactive(contact.id, true),
      onRevert: () => setInactive(contact.id, false),
      onCommit: async () => {
        // The app's own "remove contact" (EditCustomerDialog) is this same soft delete.
        const result = await offlineFetch(
          "/api/customer-contacts/update",
          { id: contact.id, active: false, is_primary: false },
          "הסרת איש קשר"
        );
        if (!result.queued && !result.ok) return { ok: false, error: toHebrewError(result.error, "הסרת איש הקשר נכשלה.") };
        return { ok: true };
      },
    });
  }

  return (
    <CollapsibleSection
      id={SECTION_IDS.contacts}
      title="אנשי קשר וסניפים"
      icon={<UserIcon className={SECTION_ICON_CLASS} />}
      summary={<SectionCount count={activeContacts.length + branches.length} />}
      action={
        <AddContactButton
          customerId={customerId}
          customerName={customerName}
          onAdded={(contact) => {
            local.add(contact);
            openSection(SECTION_IDS.contacts);
          }}
          onUndone={(id) => setInactive(id, true)}
        />
      }
      contentClassName="space-y-4"
    >
      {activeContacts.length === 0 ? (
        <EmptyState dense>אין אנשי קשר ללקוח זה.</EmptyState>
      ) : (
        <div className="divide-y divide-border/60">
          {activeContacts.map((contact, index) => (
            <div key={contact.id} className="py-2.5 text-sm first:pt-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words font-medium">{contact.fullName || `איש קשר ${index + 1}`}</span>
                    {contact.isPrimary ? <Badge variant="success">ראשי</Badge> : null}
                    {contact.waiting ? <WaitingBadge /> : null}
                  </div>
                  <MetaRow className="mt-0.5 text-xs text-muted-foreground" items={[contact.role, contact.notes]} />
                </div>
                {contact.waiting ? null : (
                  <RowActionsMenu
                    onEdit={onEditCustomer}
                    onDelete={() => removeContact(contact)}
                    className="relative before:absolute before:-inset-1 before:content-['']"
                  />
                )}
              </div>
              <ContactLinks phone={contact.phone} whatsapp={contact.whatsapp} email={contact.email} />
            </div>
          ))}
        </div>
      )}

      {inactiveContacts.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground">לא פעילים</div>
          {inactiveContacts.map((contact, index) => (
            <div key={contact.id} className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="min-w-0 break-words">{contact.fullName || `איש קשר ${index + 1}`}</span>
              {/* A state, not an alarm: the quiet grey pill (it was a red box). */}
              <Badge variant="neutral">לא פעיל</Badge>
              {contact.phone ? (
                <ContactLink kind="tel" value={contact.phone} className={LINK_CLASS}>
                  <span dir="ltr">{contact.phone}</span>
                </ContactLink>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-1 border-t border-border/50 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">סניפים</span>
          {branches.length > 0 ? <EditButton onClick={onEditCustomer} label="עריכת סניפים" /> : null}
        </div>
        {branches.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              לקוח שמזמין עבור כמה סניפים (למשל רשת) יכול לקבל כמה — כל אחד עם כתובת וטלפון משלו.
            </p>
            <Button
              type="button"
              size="sm"
              variant="soft"
              className="relative h-8 gap-1 px-2.5 before:absolute before:-inset-1 before:content-['']"
              onClick={onEditCustomer}
            >
              <AddIcon aria-hidden />
              סניף
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {branches.map((branch, index) => (
              <div key={branch.id || `branch-${index}`} className="py-2 text-sm">
                <div className="font-medium">{branch.name || `סניף ${index + 1}`}</div>
                <div className="-mx-2 flex flex-wrap items-center">
                  {branch.address ? (
                    <AddressLink address={branch.address} fallback="—" className={LINK_CLASS}>
                      <WazeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 break-words">{branch.address}</span>
                    </AddressLink>
                  ) : null}
                  {branch.phone ? (
                    <ContactLink kind="tel" value={branch.phone} className={LINK_CLASS}>
                      <PhoneIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span dir="ltr">{branch.phone}</span>
                    </ContactLink>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
