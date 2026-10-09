"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MorningAutoIssueFormSkeleton, MorningLinksCardSkeleton } from "./integrations/morning/MorningSkeletons";

// The settings page before its data, from SettingsTabs' own classes and words:
// the segmented tab bar in its bordered box (the open tab from ?tab=, as the
// page reads it) and that tab's cards — titles, descriptions and labels
// written, blanks only where the saved values go. The notifications tab's
// rules list is the page's own "loading" line, as the page arrives with it
// (NotificationSettings fetches the rules itself). Shown while the page
// streams (loading.tsx, via SettingsLoadingBody) and as page.tsx's Suspense
// fallback.

const TABS = [
  { key: "notifications", label: "התראות" },
  { key: "finance", label: "כספים" },
  { key: "morning", label: "Morning" },
  { key: "backup", label: "גיבוי" },
  { key: "system", label: "מערכת" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function tabOf(value: string | null): TabKey {
  return TABS.find((tab) => tab.key === value)?.key ?? "notifications";
}

/** A Card with the page's own title and description, the body under them. */
function TitledCard({
  title,
  description,
  contentClassName,
  children,
}: {
  title: string;
  description: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

// NotificationSettings as it first draws (its rules still being fetched), then
// ConnectedDevicesCard — per person: the name, a count, "שלח בדיקה", the devices.
function NotificationsTabSkeleton() {
  return (
    <div className="space-y-4">
      <TitledCard title="התראות אוטומטיות" description="מה המערכת מזהה לבד, ולמי זה מגיע.">
        <div className="py-4 text-sm text-muted-foreground">טוען הגדרות...</div>
      </TitledCard>
      <TitledCard
        title="מכשירים מחוברים"
        description="כל הטלפונים והמחשבים שהפעילו התראות. אם מכשיר של משתמש לא מופיע כאן — הוא לא באמת מחובר, גם אם הכפתור אצלו מראה שההתראות פעילות. לחצו ״שלח בדיקה״ כדי לוודא שההתראות מגיעות אליו."
      >
        <div className="space-y-4">
          {[2, 1, 1].map((devices, group) => (
            <div key={group} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-[calc(1.5rem+2px)] w-20 rounded-full" />
                <Skeleton className="ms-auto h-9 w-20 rounded-xl" />
              </div>
              <ul className="space-y-1.5 ps-1">
                {Array.from({ length: devices }).map((_, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border bg-secondary/30 px-3 py-2 text-sm">
                    <span>
                      <Skeleton className="inline-block h-3.5 w-48 align-middle" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </TitledCard>
    </div>
  );
}

// BooksStartDateCard, AccountsCard (its accounts list and add button),
// VatRateCard.
function FinanceTabSkeleton() {
  return (
    <div className="space-y-4">
      <TitledCard
        title="תחילת ספירת הכספים"
        description="החודש שממנו התחלתם להשתמש במערכת באמת. הדוחות ותרשים ההכנסות וההוצאות בדשבורד סופרים רק מה-1 בחודש הזה והלאה. שום נתון לא נמחק — היומן, דפי הלקוחות, ההזמנות והפרויקטים ויתרות החשבונות ממשיכים להציג הכול."
      >
        <div className="flex flex-wrap items-end gap-3">
          <Skeleton className="h-11 w-56 rounded-xl" />
          <Skeleton className="h-11 w-20 rounded-xl" />
        </div>
      </TitledCard>
      <TitledCard
        title="חשבונות"
        description="הגדר את חשבונות הבנק והמזומן של העסק. כל חשבון מחזיק יתרת פתיחה נכון לתאריך מסוים, ועליה מצטברות התנועות שמשויכות אליו — כך מתקבלת היתרה העדכנית."
        contentClassName="space-y-3"
      >
        <ul className="divide-y rounded-lg border">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex h-6 items-center gap-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-[calc(1.25rem+2px)] w-12 rounded-full" />
                </div>
                <div className="mt-0.5 flex h-4 items-center">
                  <Skeleton className="h-2.5 w-48" />
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <Skeleton className="h-9 w-9 rounded-xl" />
              </div>
            </li>
          ))}
        </ul>
        <Skeleton className="h-11 w-28 rounded-xl" />
      </TitledCard>
      <TitledCard
        title="שיעור מע״מ"
        description="שיעור המע״מ הנוכחי. משמש לחישוב החלק נטו בתשלומים רשמיים על פרויקטים. שינוי השיעור משפיע רק על תשלומים חדשים — תשלומים קיימים שומרים את השיעור שבו נרשמו."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <span className="text-sm font-medium">שיעור (%)</span>
            <div className="flex items-center gap-1">
              <Skeleton className="h-11 w-28 rounded-xl" />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <Skeleton className="h-11 w-20 rounded-xl" />
        </div>
      </TitledCard>
    </div>
  );
}

function BackupTabSkeleton() {
  return (
    <TitledCard
      title="גיבוי נתונים"
      description="הורד עותק מלא של כל נתוני המערכת כקובץ Excel — גיליון לכל טבלה."
      contentClassName="space-y-3"
    >
      <p className="text-sm text-muted-foreground">
        הקובץ כולל לקוחות, הזמנות, פרויקטים, תשלומים, הוצאות, מלאי, נוכחות, שכר ועוד. מומלץ להוריד גיבוי באופן קבוע
        ולשמור עותק מחוץ למערכת.
      </p>
      <Skeleton className="h-11 w-52 rounded-xl" />
    </TitledCard>
  );
}

function SystemTabSkeleton() {
  return (
    <div className="space-y-4">
      <TitledCard
        title="תיעוד פעולות (יומן פעילות)"
        description="המערכת מתעדת כל יצירה, עדכון ומחיקה בכל הטבלאות ליומן הפעילות. התיעוד מכפיל בקירוב את עלות כל שמירה. ניתן לכבות אותו זמנית כדי לבדוק את מהירות השמירה — בזמן שהוא כבוי לא יירשמו רשומות חדשות ביומן הפעילות."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            מצב נוכחי: <Skeleton className="inline-block h-3.5 w-10 align-middle" />
          </div>
          <Skeleton className="h-11 w-28 rounded-xl" />
        </div>
      </TitledCard>
    </div>
  );
}

export default function SettingsSkeleton() {
  const activeTab = tabOf(useSearchParams()?.get("tab") ?? null);
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex gap-1 rounded-xl border bg-secondary/40 p-1">
        {TABS.map((tab) => (
          <span
            key={tab.key}
            className={`flex-1 rounded-lg px-3 py-1.5 text-center text-sm font-medium ${
              activeTab === tab.key ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            {tab.label}
          </span>
        ))}
      </div>

      {activeTab === "notifications" ? <NotificationsTabSkeleton /> : null}
      {activeTab === "finance" ? <FinanceTabSkeleton /> : null}
      {activeTab === "morning" ? (
        <div className="space-y-4">
          <MorningAutoIssueFormSkeleton />
          <MorningLinksCardSkeleton title="פעולות נוספות" description="התאמת לקוחות Morning ובדיקת חיבור." />
        </div>
      ) : null}
      {activeTab === "backup" ? <BackupTabSkeleton /> : null}
      {activeTab === "system" ? <SystemTabSkeleton /> : null}
    </div>
  );
}
