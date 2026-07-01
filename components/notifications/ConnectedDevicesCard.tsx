"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Smartphone, Tablet, Monitor } from "lucide-react";
import type { DeviceIcon } from "@/lib/notifications/devices";

export type ConnectedDevice = {
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
  if (icon === "phone") return <Smartphone className={cls} />;
  if (icon === "tablet") return <Tablet className={cls} />;
  return <Monitor className={cls} />;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ConnectedDevicesCard({ devices, unavailable }: Props) {
  // Group by user so an admin can scan per person.
  const byUser = new Map<string, ConnectedDevice[]>();
  for (const d of devices) {
    const list = byUser.get(d.userLabel) ?? [];
    list.push(d);
    byUser.set(d.userLabel, list);
  }
  const groups = [...byUser.entries()].sort((a, b) => a[0].localeCompare(b[0], "he"));

  return (
    <Card>
      <CardHeader>
        <CardTitle>מכשירים מחוברים</CardTitle>
        <CardDescription>
          כל הטלפונים והמחשבים שהפעילו התראות. אם מכשיר של משתמש לא מופיע כאן — הוא לא באמת מחובר,
          גם אם הכפתור אצלו מראה שההתראות פעילות.
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
            {groups.map(([user, list]) => (
              <div key={user} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{user}</span>
                  <Badge variant="outline">{list.length} מכשירים</Badge>
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
                        <span className="text-muted-foreground">
                          · חובר {formatDate(d.connectedAt)}
                        </span>
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
