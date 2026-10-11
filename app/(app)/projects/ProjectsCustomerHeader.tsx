import { CallIconButton } from "@/components/ui/contact-link";

/** "לקוח: <name>" above the projects list of one customer, with their phone to call. */
export default function ProjectsCustomerHeader({ customerName, phone }: { customerName: string; phone: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-medium">
      <span>לקוח: {customerName}</span>
      {/* The number as plain text and the green phone to call (owner,
          2026-10-11: one look for "call" everywhere) — it was a tel: link of
          its own, and on a computer one that did nothing. */}
      {phone ? (
        <span className="inline-flex items-center gap-2">
          <span dir="ltr" className="text-sm font-normal text-muted-foreground">
            {phone}
          </span>
          <CallIconButton phone={phone} name={customerName} />
        </span>
      ) : null}
    </div>
  );
}
