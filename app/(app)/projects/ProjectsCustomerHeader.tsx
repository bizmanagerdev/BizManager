/** "לקוח: <name>" above the projects list of one customer, with their phone to call. */
export default function ProjectsCustomerHeader({ customerName, phone }: { customerName: string; phone: string | null }) {
  return (
    <div className="text-lg font-medium">
      לקוח: {customerName}
      {phone ? (
        <a href={`tel:${phone}`} className="mr-2 text-sm font-normal text-muted-foreground hover:underline">
          {phone}
        </a>
      ) : null}
    </div>
  );
}
