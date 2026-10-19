import * as React from "react";
import Link from "next/link";
import { UserIcon, WazeIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { CallIconButton, ContactTapZone } from "@/components/ui/contact-link";
import { AddressLink } from "@/components/ui/address-link";
import type { DeliveryPin } from "@/lib/delivery-location";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { MetaRow } from "@/components/ui/meta-row";
import LogCommunicationButton, { type CommEntityType } from "@/components/communications/LogCommunicationButton";

// The "who is this for" card, shared by every entity that belongs to a customer
// (an order, a project, …). One component so the two can't drift apart — and
// built on StatActionCard, so it reads as a sibling of the תשלום card beside it:
// icon, small label, the name as the headline, then label→value rows. Every row
// is still the tap target for the app it belongs to — dialer, WhatsApp, mail,
// Waze.

export type CustomerContactCardProps = {
  customerId?: string | null;
  name: string;
  /** Billing name, shown only when it differs from the display name. */
  invoiceName?: string | null;
  registrationNumber?: string | null;
  /** Set only when this order/project is for a specific one of the customer's branches. */
  branchName?: string | null;
  phone?: string | null;
  /** Only rendered when it differs from the phone — otherwise it's the same row twice. */
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  /** The saved drop-off point: Waze goes there instead of to the address. */
  pin?: DeliveryPin | null;
  /** The saved address was not found on Google Maps: Waze says so instead of opening. */
  addressNotFound?: boolean;
  /** The apartment / entrance / floor, shown after the address. */
  addressUnit?: string | null;
  /** When both are set, the card's own action becomes "תיעוד שיחה" for THIS
   *  entity (a project, an order…) instead of the plain link to the
   *  customer's page — which moves to a small corner arrow instead, so the
   *  two don't compete as two same-weight buttons. Omit either to keep the
   *  card's original behavior (a caller not opting into logging calls here). */
  entityType?: CommEntityType;
  entityId?: string;
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function whatsappUrl(number: string) {
  let digits = digitsOnly(number);
  if (!digits) return null;
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  else if (!digits.startsWith("972")) digits = `972${digits}`;
  return `https://wa.me/${digits}`;
}

export function CustomerContactCard({
  customerId,
  name,
  invoiceName,
  registrationNumber,
  branchName,
  phone,
  whatsapp,
  email,
  address,
  pin,
  addressNotFound = false,
  addressUnit = null,
  entityType,
  entityId,
}: CustomerContactCardProps) {
  const logsCallsHere = Boolean(entityType && entityId);
  const subtitleParts = [
    branchName ? `סניף: ${branchName}` : null,
    invoiceName && invoiceName !== name ? `שם לחשבונית: ${invoiceName}` : null,
    registrationNumber ? `ח.פ / ת.ז: ${registrationNumber}` : null,
  ].filter(Boolean);
  const subtitle = subtitleParts.length > 0 ? <MetaRow items={subtitleParts} /> : null;

  const waNumber =
    whatsapp && phone && digitsOnly(whatsapp) === digitsOnly(phone) ? null : whatsapp ?? null;
  const waHref = waNumber ? whatsappUrl(waNumber) : null;

  // A row with nothing in it says nothing — missing contact details are dropped
  // rather than printed as "-".
  const details: { label: string; value: React.ReactNode }[] = [];

  if (phone) {
    details.push({
      label: "טלפון",
      value: (
        // A <div> (ContactTapZone), not an <a href="tel:…"> — a real tel: link
        // claims the long-press gesture for the browser's own menu, which
        // doesn't surface a copy option everywhere this app runs. Plain text
        // long-presses into normal selection instead; a click copies on a
        // computer, like the email below. The way to call is the green phone
        // on the button line (see `action`).
        <ContactTapZone kind="tel" value={phone} className="inline-block hover:text-secondary hover:underline">
          <span dir="ltr">{phone}</span>
        </ContactTapZone>
      ),
    });
  }

  if (waHref && waNumber) {
    details.push({
      label: "וואטסאפ",
      value: (
        <a
          href={waHref}
          target="_blank"
          rel="noreferrer"
          title="וואטסאפ ללקוח"
          className="hover:text-secondary hover:underline"
        >
          <span dir="ltr">{waNumber}</span>
        </a>
      ),
    });
  }

  if (email) {
    details.push({
      label: "אימייל",
      value: (
        <ContactTapZone kind="mailto" value={email} className="inline-block hover:text-secondary hover:underline">
          <span dir="ltr" className="break-all">
            {email}
          </span>
        </ContactTapZone>
      ),
    });
  }

  if (address || pin) {
    details.push({
      label: "כתובת",
      value: (
        // The Waze mark stays — it's what says "tapping this navigates".
        <AddressLink address={address} pin={pin} notFound={addressNotFound} className="flex items-center gap-1.5 hover:text-secondary">
          <WazeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>{[address || "נקודה שמורה", addressUnit?.trim()].filter(Boolean).join(" · ")}</span>
        </AddressLink>
      ),
    });
  }

  const cardAction =
    logsCallsHere && entityType && entityId ? (
      <LogCommunicationButton
        entityType={entityType}
        entityId={entityId}
        customerId={customerId ?? undefined}
        defaultTopic="general"
        className="h-9 w-full"
      />
    ) : customerId ? (
      <Button asChild size="sm" variant="outline" className="w-full">
        <Link href={`/customers/${customerId}`}>כרטיס הלקוח</Link>
      </Button>
    ) : null;

  return (
    <StatActionCard
      icon={<UserIcon className="h-5 w-5" />}
      label="לקוח"
      value={name}
      subtitles={[subtitle]}
      details={details}
      cornerHref={logsCallsHere && customerId ? `/customers/${customerId}` : undefined}
      cornerLabel="כרטיס הלקוח"
      action={
        // The app's one call button — the green phone (owner, 2026-10-11:
        // "make them all the same, so the user knows: when I see this, it means
        // to call"). On the button line, beside "תיעוד שיחה": the circle is as
        // tall as the button, so the card keeps the height its loading
        // placeholder has (OrderPageSkeleton); in the "טלפון" row it would have
        // made the card taller.
        phone ? (
          <div className="flex items-center gap-2">
            <CallIconButton phone={phone} name={name} />
            {cardAction ? <div className="min-w-0 flex-1">{cardAction}</div> : null}
          </div>
        ) : (
          cardAction
        )
      }
    />
  );
}
