"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PhoneIcon, UserIcon, WazeIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CallIconButton, ContactTapZone } from "@/components/ui/contact-link";
import { AddressLink } from "@/components/ui/address-link";
import { MetaRow } from "@/components/ui/meta-row";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { whatsappHref } from "@/lib/whatsapp";
import type { CustomerProfile } from "@/app/(app)/customers/[id]/customerPageModel";

// The "לקוח" card at the top of the customer page — the project and order
// pages' customer card (components/customers/CustomerContactCard.tsx) in the
// customer's own version: the name with what marks this customer (a worker of
// the business, pays up front, inactive), how to reach them — every row the
// tap target of the app it belongs to — the green call button beside "תיעוד
// שיחה", and under them the tags and the arrival details.

export default function CustomerProfileCard({
  customer,
  active,
  linkedWorker,
  onLogCall,
  children,
}: {
  customer: CustomerProfile;
  /** As it stands on the page (marked inactive from the ⋮ without a reload). */
  active: boolean;
  linkedWorker: { id: string; name: string } | null;
  /** Opens the call log's form on the page; null when the viewer may not log calls. */
  onLogCall: (() => void) | null;
  /** Under the rows: the tags and the arrival details. */
  children?: ReactNode;
}) {
  const { name, invoiceName, registrationNumber, phone, whatsapp, email, address } = customer;

  const subtitle =
    (invoiceName && invoiceName !== name) || registrationNumber ? (
      <MetaRow
        items={[
          invoiceName && invoiceName !== name ? `שם לחשבונית: ${invoiceName}` : null,
          registrationNumber ? (
            <>
              ח.פ / ת.ז: <span dir="ltr">{registrationNumber}</span>
            </>
          ) : null,
        ]}
      />
    ) : null;

  // A row with nothing in it says nothing — missing details are dropped rather
  // than printed as "—".
  const details: { label: string; value: ReactNode }[] = [];
  if (phone) {
    details.push({
      label: "טלפון",
      value: (
        // Not a tel: link — it would claim the long-press a copy needs. A tap
        // dials on a phone and copies on a computer; the green phone calls.
        <ContactTapZone kind="tel" value={phone} as="span" className="inline-block hover:text-secondary hover:underline">
          <span dir="ltr">{phone}</span>
        </ContactTapZone>
      ),
    });
  }
  const waHref = whatsappHref(whatsapp);
  if (waHref && whatsapp) {
    details.push({
      label: "וואטסאפ",
      value: (
        <a href={waHref} target="_blank" rel="noreferrer" title="וואטסאפ ללקוח" className="hover:text-secondary hover:underline">
          <span dir="ltr">{whatsapp}</span>
        </a>
      ),
    });
  }
  if (email) {
    details.push({
      label: "אימייל",
      value: (
        <ContactTapZone kind="mailto" value={email} as="span" className="inline-block min-w-0 hover:text-secondary hover:underline">
          <span dir="ltr" className="break-all">
            {email}
          </span>
        </ContactTapZone>
      ),
    });
  }
  if (address || customer.deliveryPin) {
    details.push({
      label: "כתובת",
      value: (
        // The Waze mark is what says "tapping this navigates". A saved
        // drop-off point wins over the address (owner, 2026-10-16).
        <AddressLink
          address={address}
          pin={customer.deliveryPin}
          fallback="—"
          className="inline-flex items-center gap-1.5 hover:text-secondary"
        >
          <WazeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">{address || "נקודה שמורה"}</span>
        </AddressLink>
      ),
    });
  }
  // Present whatever the balances — the identity link matters on its own.
  if (linkedWorker) {
    details.push({
      label: "עובד בעסק",
      value: (
        <Link href={`/payroll/workers/${encodeURIComponent(linkedWorker.id)}`} className="hover:text-secondary hover:underline">
          {linkedWorker.name}
        </Link>
      ),
    });
  }

  const badges =
    linkedWorker || customer.requiresPrepayment || !active ? (
      <span className="flex flex-wrap items-center gap-1.5">
        {linkedWorker ? <Badge variant="info">עובד בעסק</Badge> : null}
        {customer.requiresPrepayment ? <Badge variant="destructive">תשלום מראש</Badge> : null}
        {/* A state, not an alarm: the quiet grey pill. */}
        {!active ? <Badge variant="neutral">לא פעיל</Badge> : null}
      </span>
    ) : null;

  const logCall = onLogCall ? (
    <Button type="button" size="sm" variant="outline" className="h-9 w-full" onClick={onLogCall}>
      <PhoneIcon className="h-4 w-4 text-success" />
      <span>תיעוד שיחה</span>
    </Button>
  ) : null;

  return (
    <StatActionCard
      icon={<UserIcon className="h-5 w-5" />}
      label="לקוח"
      value={<div className="min-w-0 break-words text-lg font-bold leading-snug">{name}</div>}
      badges={badges}
      subtitles={[subtitle]}
      details={details}
      action={
        // The app's one call button (the green phone) on the button line, as on
        // the project and order pages' customer card.
        phone ? (
          <div className="flex items-center gap-2">
            <CallIconButton phone={phone} name={name} />
            {logCall ? <div className="min-w-0 flex-1">{logCall}</div> : null}
          </div>
        ) : (
          logCall
        )
      }
    >
      {children}
    </StatActionCard>
  );
}
