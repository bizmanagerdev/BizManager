import type { ActivityKind } from "@/lib/activity/kinds";
import {
  ActivityIcon,
  DeleteIcon,
  DeliveryIcon,
  DocumentIcon,
  LoginIcon,
  LogoutIcon,
  OrderIcon,
  PaymentIcon,
  ProjectIcon,
  ReceiptIcon,
  RefreshIcon,
  SuccessIcon,
  TaskIcon,
  TimerIcon,
  UserIcon,
  WalletIcon,
  type IconComponent,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";

// One icon per kind of entry, in BizH's own colours (owner, 2026-10-21: the
// rainbow — green, blue, purple, orange, indigo — "not matching the palette of
// the whole BizH system"). As on the dashboard, the icon says what it is and
// colour is kept for what it means:
// - everyday actions: BizH's light sky with its blue icon;
// - done (delivered, a task completed): the same blue, filled — like the
//   dashboard's "סופק" / "נגבה" buttons;
// - money in: green, as paid is everywhere; a deletion: red, kept light so a
//   run of them isn't a wall of red;
// - the plumbing (logins, the system's own updates): an outline only.
const EVERYDAY = "bg-accentSky-10 text-accentSky-4";
const DONE = "bg-secondary text-secondary-foreground";
const QUIET = "bg-card text-muted-foreground ring-1 ring-inset ring-border";
const VISUALS: Record<ActivityKind, { icon: IconComponent; className: string; label: string }> = {
  payment: { icon: PaymentIcon, className: "bg-success-soft text-success-soft-foreground", label: "תשלום" },
  order: { icon: OrderIcon, className: EVERYDAY, label: "הזמנה" },
  delivery: { icon: DeliveryIcon, className: DONE, label: "משלוח" },
  task: { icon: TaskIcon, className: EVERYDAY, label: "משימה" },
  taskDone: { icon: SuccessIcon, className: DONE, label: "משימה שבוצעה" },
  customer: { icon: UserIcon, className: EVERYDAY, label: "לקוח" },
  project: { icon: ProjectIcon, className: EVERYDAY, label: "פרויקט" },
  expense: { icon: ReceiptIcon, className: EVERYDAY, label: "הוצאה" },
  document: { icon: DocumentIcon, className: EVERYDAY, label: "מסמך" },
  attendance: { icon: TimerIcon, className: EVERYDAY, label: "שעות עבודה" },
  payroll: { icon: WalletIcon, className: EVERYDAY, label: "שכר" },
  login: { icon: LoginIcon, className: QUIET, label: "כניסה" },
  logout: { icon: LogoutIcon, className: QUIET, label: "יציאה" },
  system: { icon: RefreshIcon, className: QUIET, label: "מערכת" },
  delete: { icon: DeleteIcon, className: "bg-palette-red-10 text-destructive", label: "מחיקה" },
  other: { icon: ActivityIcon, className: EVERYDAY, label: "פעולה" },
};

export function KindIcon({ kind, size = "md", className }: { kind: ActivityKind; size?: "sm" | "md"; className?: string }) {
  const { icon: Icon, className: tint, label } = VISUALS[kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        size === "md" ? "h-9 w-9" : "h-6 w-6",
        tint,
        className
      )}
      title={label}
      aria-hidden
    >
      <Icon className={size === "md" ? "h-[1.1rem] w-[1.1rem]" : "h-3.5 w-3.5"} strokeWidth={2.2} />
    </span>
  );
}
