"use client";

import { useState, useTransition } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type SalaryProtectedProps = {
  unlocked: boolean;
  hasPasswordConfigured: boolean;
  canUnlock: boolean;
  title?: string;
  description?: string;
  onUnlockSuccess?: () => void | Promise<void>;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export default function SalaryProtected({
  unlocked,
  hasPasswordConfigured,
  canUnlock,
  title = "נתוני שכר מוגנים",
  description = "פתחו את אזור השכר כדי לראות סכומים, תלושים ופעולות שכר.",
  onUnlockSuccess,
  children,
  fallback,
}: SalaryProtectedProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (unlocked) {
    return <>{children}</>;
  }

  async function unlock() {
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/payroll/admin/unlock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setError(json.error ?? "פתיחת אזור השכר נכשלה.");
          return;
        }

        setOpen(false);
        setPassword("");
        setError("");
        await onUnlockSuccess?.();
      } catch (unlockError: unknown) {
        setError(unlockError instanceof Error ? unlockError.message : "Unknown error");
      }
    });
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <>
      <div className="rounded-[1.5rem] border border-dashed border-primary/30 bg-background/70 p-5 text-right">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              <LockKeyhole className="h-3.5 w-3.5" />
              {"מוגן"}
            </div>
            <div className="text-base font-semibold">{title}</div>
            <div className="text-sm text-muted-foreground">{description}</div>
          </div>
          <ShieldCheck className="mt-1 h-5 w-5 text-muted-foreground" />
        </div>

        {!hasPasswordConfigured ? (
          <div className="mt-4 text-sm text-muted-foreground">
            {"אין כרגע סיסמת שכר מוגדרת בשרת, לכן הנתונים נשארים מוסתרים."}
          </div>
        ) : canUnlock ? (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setOpen(true)}>{"פתיחת אזור השכר"}</Button>
          </div>
        ) : (
          <div className="mt-4 text-sm text-muted-foreground">
            {"רק מנהל עם פתיחת שכר פעילה יכול לראות את הנתונים האלה."}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>{"פתיחת נתוני שכר"}</DialogTitle>
            <DialogDescription>
              {"הנתונים ייטענו רק אחרי אימות הסיסמה, ולא לפני כן."}
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-3"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            <input
              type="text"
              name="salary_unlock_username"
              autoComplete="username"
              tabIndex={-1}
              className="hidden"
              aria-hidden="true"
            />
            <Input
              type="password"
              name="salary_unlock_password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="סיסמה או PIN"
              autoComplete="new-password"
              data-lpignore="true"
              autoFocus
            />
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              {"ביטול"}
            </Button>
            <Button onClick={() => void unlock()} disabled={isPending || !password.trim()}>
              {"אישור"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
