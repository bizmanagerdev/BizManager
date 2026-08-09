"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DesktopIcon, MobileIcon, TabletIcon } from "@/components/ui/icons";
import type { DeviceIcon } from "@/lib/notifications/devices";

export type ConnectedDevice = {
  userId: string;
  userLabel: string;
  os: string;
  browser: string;
  icon: DeviceIcon;
  connectedAt: string | null;
  lastSeenAt: string | null;
};

type Props = {
  devices: ConnectedDevice[];
  /** True when the service-role key is missing, so the list can't be read. */
  unavailable: boolean;
};

function Icon({ icon }: { icon: DeviceIcon }) {
  const cls = "h-4 w-4 text-muted-foreground";
  if (icon === "phone") return <MobileIcon className={cls} />;
  if (icon === "tablet") return <TabletIcon className={cls} />;
  return <DesktopIcon className={cls} />;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ConnectedDevicesCard({ devices, unavailable }: Props) {
  const [pendingUser, setPendingUser] = useState<string | null>(null);

  async function sendTest(userId: string, userLabel: string) {
    setPendingUser(userId);
    try {
      const res = await fetch("/api/notifications/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json().catch(() => ({}))) as { sent?: number; failed?: number };
      if (!res.ok) {
        toast.error("שליחת הבדיקה נכשלה.");
        return;
      }
      const sent = data.sent ?? 0;
      const failed = data.failed ?? 0;
      if (sent > 0) {
        toast.success(
          `נשלחה בדיקה ל-${sent} מכשירים של ${userLabel}. אם לא הגיעה — הבעיה בהגדרות ההתראות במכשיר שלו (חסימה/מצב שקט/חיסכון בסוללה).`
        );
      } else if (failed > 0) {
        toast.error(
          `המנוי של ${userLabel} אינו תקין (כנראה כובה במכשיר) והוסר. שיפעיל התראות מחדש מהמכשיר.`
        );
      } else {
        toast.message(`אין מכשירים פעילים ל-${userLabel}.`);
      }
    } catch {
      toast.error("שליחת הבדיקה נכשלה.");
    } finally {
      setPendingUser(null);
    }
  }

  // Group by user so an admin can scan per person.
  const byUser = new Map<string, { label: string; list: ConnectedDevice[] }>();
  for (const d of devices) {
    const entry = byUser.get(d.userId) ?? { label: d.userLabel, list: [] };
    entry.list.push(d);
    byUser.set(d.userId, entry);
  }
  const groups = [...byUser.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "he"));

  return (
    <Card>
      <CardHeader>
        <CardTitle>מכשירים מחוברים</CardTitle>
        <CardDescription>
          כל הטלפונים והמחשבים שהפעילו התראות. אם מכשיר של משתמש לא מופיע כאן — הוא לא באמת מחובר,
          גם אם הכפתור אצלו מראה שההתראות פעילות. לחצו ״שלח בדיקה״ כדי לוודא שההתראות מגיעות אליו.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <p className="text-sm text-muted-foreground">
            לא ניתן לטעון את רשימת המכשירים (חסר מפתח שירות). פנה למנהל המערכת.
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין כרגע מכשירים מחוברים.</p>
        ) : (
          <div className="space-y-4">
            {groups.map(([userId, { label, list }]) => (
              <div key={userId} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{label}</span>
                  <Badge variant="outline">{list.length} מכשירים</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ms-auto"
                    disabled={pendingUser === userId}
                    onClick={() => sendTest(userId, label)}
                  >
                    {pendingUser === userId ? "שולח..." : "שלח בדיקה"}
                  </Button>
                </div>
                <ul className="space-y-1.5 ps-1">
                  {list.map((d, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-secondary/30 px-3 py-2 text-sm"
                    >
                      <Icon icon={d.icon} />
                      <span className="font-medium">{d.os}</span>
                      {d.browser && <span className="text-muted-foreground">· {d.browser}</span>}
                      {d.connectedAt && (
                        <span className="text-muted-foreground">· חובר {formatDate(d.connectedAt)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
