import * as React from "react";
import Link from "next/link";
import { UserIcon, WazeIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { ContactLink } from "@/components/ui/contact-link";
import { AddressLink } from "@/components/ui/address-link";
import { StatActionCard } from "@/components/ui/stat-action-card";

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
  phone?: string | null;
  /** Only rendered when it differs from the phone — otherwise it's the same row twice. */
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
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
  phone,
  whatsapp,
  email,
  address,
}: CustomerContactCardProps) {
  const subtitle = [
    invoiceName && invoiceName !== name ? `שם לחשבונית: ${invoiceName}` : null,
    registrationNumber ? `ח.פ / ת.ז: ${registrationNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
        <ContactLink kind="tel" value={phone} className="hover:text-secondary hover:underline">
          <span dir="ltr">{phone}</span>
        </ContactLink>
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
        <ContactLink kind="mailto" value={email} className="hover:text-secondary hover:underline">
          <span dir="ltr" className="break-all">
            {email}
          </span>
        </ContactLink>
      ),
    });
  }

  if (address) {
    details.push({
      label: "כתובת",
      value: (
        // The Waze mark stays — it's what says "tapping this navigates".
        <AddressLink address={address} className="flex items-center gap-1.5 hover:text-secondary">
          <WazeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>{address}</span>
        </AddressLink>
      ),
    });
  }

  return (
    <StatActionCard
      icon={<UserIcon className="h-5 w-5" />}
      label="לקוח"
      value={name}
      subtitles={[subtitle || null]}
      details={details}
      action={
        customerId ? (
          <Button asChild size="sm" variant="secondary" className="w-full">
            <Link href={`/customers/${customerId}`}>כרטיס הלקוח</Link>
          </Button>
        ) : null
      }
    />
  );
}
