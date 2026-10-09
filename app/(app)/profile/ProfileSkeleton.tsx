"use client";

import type { ComponentType, ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ClockIcon, DesktopIcon, MobileIcon, NotificationIcon, UserIcon, WalletIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/lib/i18n/t";
import { profileDict, type ProfileKey } from "@/lib/i18n/dictionaries/profile";

// The profile page before its data, from ProfileClient's own pieces: its tab
// bar (full-bleed on a phone, the tabs splitting the width; centred from sm)
// with the open tab from ?tab=, and that tab's cards — the details, the
// password, the board's chips, the text sizes, the colours — their titles and
// hints written, blanks where the person's own values go. Which tabs a person
// has depends on his pay type, which the loading screen doesn't know: it draws
// the two everyone has, plus נוכחות / משכורת when the address opens one.
// Shown while the page streams (loading.tsx) and while ProfileClient's code
// loads (page.tsx's dynamic() fallback).

type ProfileTab = "profile" | "notifications" | "sessions" | "salary";

const he = (key: ProfileKey) => t(profileDict, "he", key);

const FONT_SCALES: { key: ProfileKey; scale: number }[] = [
  { key: "fontScaleSmall", scale: 0.9 },
  { key: "fontScaleNormal", scale: 1 },
  { key: "fontScaleLarge", scale: 1.15 },
  { key: "fontScaleXLarge", scale: 1.3 },
  { key: "fontScaleHuge", scale: 1.5 },
];

const FONT_SCALE_DEVICES: { key: ProfileKey; icon: ComponentType<{ className?: string }> }[] = [
  { key: "deviceDesktop", icon: DesktopIcon },
  { key: "deviceMobile", icon: MobileIcon },
];

// The dashboard customizer's chips (one per board card) — rough widths.
const CHIP_WIDTHS = ["w-32", "w-32", "w-24", "w-32", "w-36", "w-24", "w-36", "w-48", "w-24", "w-36"];

/** A Card > CardContent py-5 with a section title and its hint line. */
function SettingCard({
  title,
  hint,
  hintClassName = "mb-3",
  children,
}: {
  title: ReactNode;
  hint: string;
  hintClassName?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">{title}</div>
        <div className={`${hintClassName} text-xs text-muted-foreground`}>{hint}</div>
        {children}
      </CardContent>
    </Card>
  );
}

function ProfileTabSkeleton() {
  return (
    <>
      {/* Your details: avatar and name, the edit pencil; phone and email. */}
      <Card>
        <CardContent className="py-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 text-base font-semibold">
                <Skeleton className="inline-block h-4 w-28 align-middle" />
              </div>
            </div>
            <Skeleton className="h-9 w-9 rounded-xl" />
          </div>
          <dl className="space-y-2 text-sm">
            {(["phoneLabel", "emailLabel"] as const).map((key) => (
              <div key={key} className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                <dt className="text-muted-foreground">{he(key)}</dt>
                <dd>
                  <Skeleton className="inline-block h-3.5 w-32 align-middle" />
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{he("passwordSectionTitle")}</div>
            <Skeleton className="h-9 w-24 rounded-xl" />
          </div>
          <p className="text-xs text-muted-foreground">{he("passwordHint")}</p>
        </CardContent>
      </Card>

      {/* The board's cards (not a worker's — he has no such card). */}
      <SettingCard title={he("dashboardCustomizerTitle")} hint={he("dashboardCustomizerHint")}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {CHIP_WIDTHS.map((width, i) => (
              <Skeleton key={i} className={`h-[calc(2rem+2px)] rounded-full ${width}`} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
            <Skeleton className="h-9 w-28 rounded-xl" />
            <span className="text-xs text-muted-foreground">השינויים נשמרים אוטומטית</span>
          </div>
        </div>
      </SettingCard>

      {/* Text size: the two devices' rows of five sizes, none marked yet. */}
      <SettingCard title={he("fontSizeTitle")} hint={he("fontSizeHint")} hintClassName="mb-4">
        <div className="space-y-4">
          {FONT_SCALE_DEVICES.map(({ key, icon: Icon }) => (
            <div key={key}>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Icon className="h-4 w-4" />
                {he(key)}
              </div>
              <div className="flex flex-wrap gap-2">
                {FONT_SCALES.map((option) => (
                  <div
                    key={option.key}
                    className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-background px-4 py-3 text-foreground"
                  >
                    <span style={{ fontSize: `${17 * option.scale}px`, lineHeight: 1 }}>א</span>
                    <span className="text-xs font-medium">{he(option.key)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SettingCard>

      <SettingCard
        title={
          <>
            {he("avatarColorTitle")}
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          </>
        }
        hint={he("avatarColorHint")}
      >
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 36 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-8 rounded-full" />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground">
            <span className="h-5 w-5 rounded-full border" />
            {he("customColorLabel")}
          </span>
          <span className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground">{he("autoColorLabel")}</span>
        </div>
      </SettingCard>
    </>
  );
}

// The push switch and the notification preferences, their titles written.
function NotificationsTabSkeleton() {
  return (
    <>
      <Card>
        <CardContent className="py-5">
          <div className="mb-3 text-right">
            <div className="text-base font-semibold">{he("pushTitle")}</div>
            <div className="text-sm text-muted-foreground">{he("pushHint")}</div>
          </div>
          <Skeleton className="h-11 w-48 rounded-xl" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-5">
          <div className="mb-3 text-right">
            <div className="text-base font-semibold">{he("prefsTitle")}</div>
            <div className="text-sm text-muted-foreground">{he("prefsHint")}</div>
          </div>
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// The clock card, then the month's card: the month select, the export
// buttons, the three figures and the shifts.
function SessionsTabSkeleton() {
  return (
    <section className="space-y-4">
      <Card>
        <CardContent className="space-y-3 py-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardContent className="space-y-4 px-3 py-5 text-right md:px-6">
          <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-xl" />
          </div>
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {(["totalHoursStatLabel", "sessionCountLabel", "openSessionCountLabel"] as const).map((key) => (
              <div key={key} className="rounded-2xl border bg-muted/20 p-3 text-right md:p-4">
                <div className="text-xs text-muted-foreground md:text-sm">{he(key)}</div>
                <div className="mt-1 text-base font-semibold md:text-xl">
                  <Skeleton className="inline-block h-4 w-12 align-middle" />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// The two summary cards, the three totals, the salary history and payslips.
function SalaryTabSkeleton() {
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(["currentSalaryTitle", "lastPayslipTitle"] as const).map((key) => (
          <Card key={key}>
            <CardContent className="space-y-1 py-5">
              <div className="text-sm text-muted-foreground">{he(key)}</div>
              <div className="text-2xl font-semibold">
                <Skeleton className="inline-block h-6 w-28 align-middle" />
              </div>
              <div className="text-xs text-muted-foreground">
                <Skeleton className="inline-block h-2.5 w-24 align-middle" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["earnedLabel", "paidLabel", "owedLabel"] as const).map((key) => (
          <div key={key} className="rounded-lg border border-border/60 p-3">
            <div className="text-xs text-muted-foreground">{he(key)}</div>
            <div className="text-base font-semibold">
              <Skeleton className="inline-block h-4 w-16 align-middle" />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-4">
        {(["salaryHistoryTitle", "payslipsTitle"] as const).map((key) => (
          <Card key={key}>
            <CardContent className="space-y-3 px-3 py-5 md:px-6">
              <div className="text-lg font-semibold">{he(key)}</div>
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default function ProfileSkeleton() {
  const tabParam = useSearchParams()?.get("tab");
  const tabs: { key: ProfileTab; label: ProfileKey; icon: ComponentType<{ className?: string }> }[] = [
    { key: "profile", label: "tabProfile", icon: UserIcon },
    { key: "notifications", label: "tabNotifications", icon: NotificationIcon },
    ...(tabParam === "sessions" || tabParam === "salary"
      ? [{ key: "sessions" as const, label: "tabAttendance" as const, icon: ClockIcon }]
      : []),
    ...(tabParam === "salary" ? [{ key: "salary" as const, label: "tabSalary" as const, icon: WalletIcon }] : []),
  ];
  const activeTab: ProfileTab = tabs.find((tab) => tab.key === tabParam)?.key ?? "profile";

  return (
    <div className="space-y-4" aria-busy="true">
      <div>
        <Tabs value={activeTab}>
          <TabsList
            variant="underline"
            className="-mx-3 w-[calc(100%+1.5rem)] gap-0 px-1 sm:mx-0 sm:w-full sm:justify-center sm:gap-3 sm:px-0"
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className="min-w-0 flex-1 gap-1 px-0.5 text-[0.8125rem] sm:flex-none sm:gap-1 sm:px-2 sm:text-base"
              >
                <tab.icon className="h-4 w-4 shrink-0" />
                {he(tab.label)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {activeTab === "profile" ? <ProfileTabSkeleton /> : null}
      {activeTab === "notifications" ? <NotificationsTabSkeleton /> : null}
      {activeTab === "sessions" ? <SessionsTabSkeleton /> : null}
      {activeTab === "salary" ? <SalaryTabSkeleton /> : null}
    </div>
  );
}
