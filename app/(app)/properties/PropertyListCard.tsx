"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Painted } from "@/components/search/Painted";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  DeleteIcon,
  EditIcon,
  MoreIcon,
  NotificationIcon,
  UserIcon,
  type IconComponent,
} from "@/components/ui/icons";
import { formatCurrency } from "@/lib/payroll";
import { formatShortDate } from "@/lib/date";
import { propertyDisplayName, type PropertyWithLease } from "@/lib/properties";
import { israelDateKey } from "@/lib/timezone";
import { rowNavigateProps } from "@/lib/ui/row-navigation";
import { cn } from "@/lib/utils";
import { PropertyPhotoThumb } from "./PropertyPhotoTile";

/** A lease this close to its end is shown so (the rent page's own threshold). */
const ENDING_DAYS = 90;

// A property on the list (owner, 2026-10-21: "like the cars cards"): its
// photo (added on its page), name and address, and one row for who rents it,
// what they pay and until when, opening that part of the property's page. The
// whole card opens the property. Whether this month's rent is in isn't here
// (owner, 2026-10-22: "the user could just go to the rent tab and see all
// information about the rent"), an empty one says so once ("I don't need one
// row to say that it's empty and the next row to say that there's no
// renter"), and its net, tasks and documents count are its page's to say
// ("should we remove the whole bottom row — does it do anything for the user?").

/**
 * One "bar", like a car's טסט / ביטוח / רישוי: the label and its icon at one end, the value at the other — and
 * under the value, a smaller line. Always two lines' room, so every card's bar is the same height with or
 * without it.
 */
function CardRow({
  href,
  icon: Icon,
  label,
  empty = false,
  sub,
  children,
}: {
  href: string;
  icon: IconComponent;
  label: string;
  /** Nothing there (no tenant): the dashed, muted look of a car's unset date. */
  empty?: boolean;
  /** The line under the value. */
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors",
        empty
          ? "border border-dashed border-border/70 bg-muted/30 text-muted-foreground hover:bg-muted/50"
          : "bg-muted/40 hover:bg-muted/70"
      )}
    >
      <span className="flex shrink-0 items-center gap-2 text-sm font-medium">
        <span>{label}</span>
        <Icon className={cn("h-4 w-4 shrink-0", empty ? "text-muted-foreground/50" : "text-muted-foreground")} />
      </span>
      <span className="min-w-0 text-end">
        <span className="flex min-w-0 items-center justify-end gap-2 text-sm">{children}</span>
        {sub ? <span className="block truncate text-xs tabular-nums text-muted-foreground">{sub}</span> : null}
      </span>
    </Link>
  );
}

export default function PropertyListCard({
  property: p,
  photoUrl,
  handle,
  onEdit,
  onReminder,
  onDelete,
}: {
  property: PropertyWithLease;
  photoUrl: string | null;
  /** The drag handle, in the card's corner (null while the order can't change). */
  handle: ReactNode;
  onEdit: () => void;
  onReminder: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const href = `/properties/${p.id}`;
  const name = propertyDisplayName(p);
  const lease = p.currentLease?.status === "active" ? p.currentLease : null;
  const renters = p.renters && p.renters.count > 0 ? p.renters : null;

  return (
    <Card className="relative flex flex-1 cursor-pointer flex-col transition-colors hover:bg-muted/20" {...rowNavigateProps(router, href)}>
      {handle ? <div className="absolute start-0.5 top-0.5 z-10">{handle}</div> : null}
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3 ps-3">
          <PropertyPhotoThumb url={photoUrl} name={name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold">
              <Painted text={name} />
            </div>
            {/* Always two lines' room, at most two lines (owner, 2026-10-21: "the address should
                have a set height … all the blues the same height"), so every card's rows start level. */}
            <div className="line-clamp-2 h-[2lh] text-sm text-muted-foreground">
              {p.name ? <Painted text={p.address} /> : null}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                aria-label={`פעולות ל${name}`}
              >
                <MoreIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onReminder}>
                <NotificationIcon className="me-2 h-4 w-4 text-warning" />
                תזכורת
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <EditIcon className="me-2 h-4 w-4" />
                עריכה
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <DeleteIcon className="me-2 h-4 w-4" />
                מחיקה
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Who rents it, what they pay and until when — it opens that part of its page. */}
        <div className="space-y-2">
          {renters ? (
            <CardRow
              href={`${href}#renters`}
              icon={UserIcon}
              label="שוכרים"
              sub={[
                renters.monthly > 0 ? `${formatCurrency(renters.monthly)}/חודש` : null,
                renters.yearly > 0 ? `${formatCurrency(renters.yearly)}/שנה` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <span className="truncate font-medium">{renters.count === 1 ? "שוכר אחד" : `${renters.count} שוכרים`}</span>
            </CardRow>
          ) : lease ? (
            <CardRow
              href={`${href}#tenant`}
              icon={UserIcon}
              label="שוכר"
              sub={
                <>
                  <Painted text={formatCurrency(lease.monthlyRentAmount)} />
                  {lease.periodMonths === 12 ? "/שנה" : "/חודש"}
                  {lease.endDate ? <LeaseEnd end={lease.endDate} /> : null}
                </>
              }
            >
              <span className="truncate font-medium">
                <Painted text={lease.customerName ?? "שוכר"} />
              </span>
            </CardRow>
          ) : (
            <CardRow href={`${href}#tenant`} icon={UserIcon} label="שוכר" empty>
              <span className="font-medium">פנוי</span>
            </CardRow>
          )}
          {!p.isActive ? <Badge variant="neutral">לא פעיל</Badge> : null}
        </div>

      </CardContent>
    </Card>
  );
}

/** " · עד 06/06/27" — in the warning colour once it's close (or past). */
function LeaseEnd({ end }: { end: string }) {
  const day = end.slice(0, 10);
  const days = Math.round((Date.parse(day) - Date.parse(israelDateKey())) / 86_400_000);
  return (
    <span className={days <= ENDING_DAYS ? "font-medium text-warning-strong" : undefined}> · עד {formatShortDate(day)}</span>
  );
}
