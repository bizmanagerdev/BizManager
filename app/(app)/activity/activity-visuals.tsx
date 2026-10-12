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

// One icon and one colour per kind of entry — payment green, order blue, task
// purple, deletion red (owner's picks, 2026-10-11) — so the feed reads at a
// glance. The rest take the app's other tints, and the plumbing (logins, the
// system) stays grey so it doesn't compete.
const VISUALS: Record<ActivityKind, { icon: IconComponent; className: string; label: string }> = {
  payment: { icon: PaymentIcon, className: "bg-palette-green-9 text-palette-green-4", label: "תשלום" },
  order: { icon: OrderIcon, className: "bg-palette-blue-9 text-palette-blue-4", label: "הזמנה" },
  delivery: { icon: DeliveryIcon, className: "bg-palette-blue-9 text-palette-blue-4", label: "משלוח" },
  task: { icon: TaskIcon, className: "bg-palette-purple-9 text-palette-purple-4", label: "משימה" },
  taskDone: { icon: SuccessIcon, className: "bg-palette-purple-9 text-palette-purple-4", label: "משימה שבוצעה" },
  customer: { icon: UserIcon, className: "bg-accentSky-10 text-accentSky-4", label: "לקוח" },
  project: { icon: ProjectIcon, className: "bg-brand-10/50 text-brand-4", label: "פרויקט" },
  expense: { icon: ReceiptIcon, className: "bg-palette-orange-9 text-palette-orange-4", label: "הוצאה" },
  document: { icon: DocumentIcon, className: "bg-muted text-foreground/70", label: "מסמך" },
  attendance: { icon: TimerIcon, className: "bg-accentSky-10 text-accentSky-6", label: "שעות עבודה" },
  payroll: { icon: WalletIcon, className: "bg-brand-10/50 text-brand-6", label: "שכר" },
  login: { icon: LoginIcon, className: "bg-muted text-muted-foreground", label: "כניסה" },
  logout: { icon: LogoutIcon, className: "bg-muted text-muted-foreground", label: "יציאה" },
  system: { icon: RefreshIcon, className: "bg-muted text-muted-foreground", label: "מערכת" },
  delete: { icon: DeleteIcon, className: "bg-palette-red-9 text-palette-red-4", label: "מחיקה" },
  other: { icon: ActivityIcon, className: "bg-muted text-foreground/70", label: "פעולה" },
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
