"use client";

/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Painted } from "@/components/search/Painted";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  BuildingIcon,
  DeleteIcon,
  DocumentIcon,
  EditIcon,
  MoreIcon,
  NotificationIcon,
  PaymentIcon,
  TaskIcon,
  UserIcon,
  type IconComponent,
} from "@/components/ui/icons";
import { formatCurrency } from "@/lib/payroll";
import { propertyDisplayName, type PropertyWithLease } from "@/lib/properties";
import { RENT_STATE } from "@/lib/property-rent";
import { rowNavigateProps } from "@/lib/ui/row-navigation";
import { cn } from "@/lib/utils";

// A property on the list (owner, 2026-10-21: "like the cars cards"): its
// photo, name and address; a row for who rents it and one for this period's
// rent — each opening that part of the property's page; and under them its
// tasks, documents and money. The whole card opens the property.

/** One "bar", like a car's טסט / ביטוח / רישוי: the label and its icon at one end, the value at the other. */
function CardRow({
  href,
  icon: Icon,
  label,
  empty = false,
  children,
}: {
  href: string;
  icon: IconComponent;
  label: string;
  /** Nothing there (no tenant): the dashed, muted look of a car's unset date. */
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors",
        empty
          ? "border border-dashed border-border/70 bg-muted/30 text-muted-foreground hover:bg-muted/50"
          : "bg-muted/40 hover:bg-muted/70"
      )}
    >
      <span className="flex shrink-0 items-center gap-2 text-sm font-medium">
        <span>{label}</span>
        <Icon className={cn("h-4 w-4 shrink-0", empty ? "text-muted-foreground/50" : "text-muted-foreground")} />
      </span>
      <span className="flex min-w-0 items-center justify-end gap-2 text-sm">{children}</span>
    </Link>
  );
}

/** Its photo, or the building in a dashed tile — the same size either way, so a photo arriving never moves anything. */
function PropertyPhoto({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img src={url} alt={name} className="h-14 w-14 shrink-0 rounded-xl border border-border/70 object-cover" />
  ) : (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 text-muted-foreground">
      <BuildingIcon className="h-5 w-5" />
    </div>
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
  const rent = RENT_STATE[p.rentThisMonth.state];
  const renters = p.renters && p.renters.count > 0 ? p.renters : null;
  const net = Math.round(p.rollup.totalIncomeAmount - p.rollup.paidExpenseAmount);

  return (
    <Card className="relative flex flex-1 cursor-pointer flex-col transition-colors hover:bg-muted/20" {...rowNavigateProps(router, href)}>
      {handle ? <div className="absolute start-0.5 top-0.5 z-10">{handle}</div> : null}
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3 ps-3">
          <PropertyPhoto url={photoUrl} name={name} />
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

        {/* Who rents it, and this period's rent (note 17) — each opens that part of its page. */}
        <div className="space-y-2">
          {renters ? (
            <>
              <CardRow href={`${href}#renters`} icon={UserIcon} label="שוכרים">
                <span className="truncate font-medium">{renters.count === 1 ? "שוכר אחד" : `${renters.count} שוכרים`}</span>
                {renters.monthly > 0 ? (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatCurrency(renters.monthly)}/חודש</span>
                ) : null}
              </CardRow>
              <CardRow href={`${href}#renters`} icon={PaymentIcon} label="שכירות">
                <Badge variant={renters.paid >= renters.count ? "success" : "warning"}>
                  {renters.paid >= renters.count ? "כולם שילמו" : `${renters.paid} מתוך ${renters.count} שילמו`}
                </Badge>
              </CardRow>
            </>
          ) : lease ? (
            <>
              <CardRow href={`${href}#tenant`} icon={UserIcon} label="שוכר">
                <span className="truncate font-medium">
                  <Painted text={lease.customerName ?? "שוכר"} />
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  <Painted text={formatCurrency(lease.monthlyRentAmount)} />
                  {lease.periodMonths === 12 ? "/שנה" : "/חודש"}
                </span>
              </CardRow>
              <CardRow href={`${href}#rent`} icon={PaymentIcon} label={`שכירות ${p.rentThisMonth.periodLabel ?? "החודש"}`}>
                <Badge variant={rent.badge}>{rent.label}</Badge>
              </CardRow>
            </>
          ) : (
            <>
              <CardRow href={`${href}#tenant`} icon={UserIcon} label="שוכר" empty>
                <span className="font-medium">פנוי</span>
              </CardRow>
              <CardRow href={`${href}#rent`} icon={PaymentIcon} label="שכירות" empty>
                <span>אין שוכר</span>
              </CardRow>
            </>
          )}
          {!p.isActive ? <Badge variant="neutral">לא פעיל</Badge> : null}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span
            className={cn("flex items-center gap-1 font-semibold tabular-nums", net >= 0 ? "text-success" : "text-destructive")}
            title="נטו: הכנסות פחות הוצאות"
          >
            <PaymentIcon className="h-3.5 w-3.5" />
            נטו {formatCurrency(net)}
          </span>
          <span className="flex items-center gap-1">
            <TaskIcon className="h-3.5 w-3.5" />
            {p.counts.openTasks}/{p.counts.tasks} משימות
          </span>
          <span className="flex items-center gap-1">
            <DocumentIcon className="h-3.5 w-3.5" />
            {p.counts.documents} מסמכים
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
