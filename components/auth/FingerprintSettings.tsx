"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FingerprintIcon, LockIcon } from "@/components/ui/icons";
import {
  deleteFingerprintSignIn,
  fingerprintStatus,
  saveFingerprintSignIn,
  setAppLock,
  type FingerprintStatus,
} from "@/lib/native-fingerprint";

// The profile page's "טביעת אצבע" card: fingerprint sign-in and the app lock,
// for THIS phone (phone app 1.2+; nothing shows in a browser or an older app).
// Owner, 2026-10-11: sign in with the fingerprint, and a lock when the app
// opens; the password always works too.

const TEXT = {
  he: {
    title: "טביעת אצבע",
    hint: "לטלפון הזה בלבד. הכניסה עם הסיסמה תמיד עובדת גם.",
    signInTitle: "כניסה עם טביעת אצבע",
    signInOn: "פעילה: במסך הכניסה נוגעים באצבע במקום להקליד סיסמה.",
    signInOff: "כבויה.",
    signInNoFinger: "אין טביעת אצבע מוגדרת בטלפון. אפשר להוסיף אחת בהגדרות הטלפון.",
    passwordPrompt: "הסיסמה שלך, כדי לשמור אותה מוצפנת לטביעת האצבע",
    lockTitle: "נעילה בפתיחת האפליקציה",
    lockOn: "פעילה: בכל פתיחה מחדש, ואחרי 5 דקות מחוץ לאפליקציה. פותחים בטביעת אצבע או בקוד הטלפון.",
    lockOff: "כבויה.",
    lockNoScreenLock: "צריך קודם נעילת מסך בטלפון (קוד, תבנית או טביעת אצבע).",
    turnOn: "הפעלה",
    turnOff: "כיבוי",
    confirm: "אישור",
    cancel: "ביטול",
    wrongPassword: "הסיסמה לא נכונה.",
    failed: "לא הצליח. נסו שוב.",
    signInSaved: "כניסה עם טביעת אצבע הופעלה",
    lockSaved: "הנעילה הופעלה",
  },
  ar: {
    title: "بصمة الإصبع",
    hint: "لهذا الهاتف فقط. الدخول بكلمة المرور يعمل دائمًا أيضًا.",
    signInTitle: "الدخول ببصمة الإصبع",
    signInOn: "مفعّل: في شاشة الدخول تلمس الإصبع بدل كتابة كلمة المرور.",
    signInOff: "غير مفعّل.",
    signInNoFinger: "لا توجد بصمة إصبع في الهاتف. يمكن إضافتها في إعدادات الهاتف.",
    passwordPrompt: "كلمة المرور، لحفظها مشفّرة لبصمة الإصبع",
    lockTitle: "قفل عند فتح التطبيق",
    lockOn: "مفعّل: عند كل فتح جديد وبعد 5 دقائق خارج التطبيق. يُفتح ببصمة الإصبع أو برمز الهاتف.",
    lockOff: "غير مفعّل.",
    lockNoScreenLock: "يجب أولًا قفل شاشة في الهاتف (رمز أو نمط أو بصمة).",
    turnOn: "تفعيل",
    turnOff: "إيقاف",
    confirm: "تأكيد",
    cancel: "إلغاء",
    wrongPassword: "كلمة المرور غير صحيحة.",
    failed: "لم ينجح. حاول مرة أخرى.",
    signInSaved: "تم تفعيل الدخول ببصمة الإصبع",
    lockSaved: "تم تفعيل القفل",
  },
} as const;

export default function FingerprintSettings({ email, locale = "he" }: { email: string | null; locale?: "he" | "ar" }) {
  const text = TEXT[locale];
  const [status, setStatus] = useState<FingerprintStatus | null>(null);
  const [askingPassword, setAskingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => fingerprintStatus().then(setStatus);

  useEffect(() => {
    void refresh();
  }, []);

  if (!status) return null;

  async function turnOnSignIn() {
    if (!email || !password || busy) return;
    setBusy(true);
    setError(null);
    // The password is checked by signing in with it again (the same account,
    // so nothing changes), and only a right one is kept.
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(res?.status === 400 ? text.wrongPassword : text.failed);
      setBusy(false);
      return;
    }
    const saved = await saveFingerprintSignIn(email, password);
    if (saved === true) {
      toast.success(text.signInSaved);
      setAskingPassword(false);
      setPassword("");
    } else if (saved !== "cancelled") {
      setError(text.failed);
    }
    await refresh();
    setBusy(false);
  }

  async function turnOffSignIn() {
    await deleteFingerprintSignIn();
    await refresh();
  }

  async function toggleLock(on: boolean) {
    if (busy) return;
    setBusy(true);
    const result = await setAppLock(on);
    if (result === true && on) toast.success(text.lockSaved);
    else if (result !== true && result !== "cancelled") toast.error(text.failed);
    await refresh();
    setBusy(false);
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div>
          <div className="text-sm font-semibold">{text.title}</div>
          <div className="text-xs text-muted-foreground">{text.hint}</div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FingerprintIcon className="h-4 w-4 text-primary" />
              {text.signInTitle}
            </div>
            {status.signInSaved ? (
              <Button variant="secondary" size="sm" onClick={() => void turnOffSignIn()}>
                {text.turnOff}
              </Button>
            ) : status.canSignIn && email && !askingPassword ? (
              <Button size="sm" onClick={() => setAskingPassword(true)}>
                {text.turnOn}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {status.signInSaved ? text.signInOn : status.canSignIn ? text.signInOff : text.signInNoFinger}
          </p>
          {askingPassword && !status.signInSaved ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void turnOnSignIn();
              }}
            >
              <label className="text-xs font-medium text-muted-foreground">{text.passwordPrompt}</label>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              {error ? <div className="text-sm text-destructive">{error}</div> : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setAskingPassword(false);
                    setPassword("");
                    setError(null);
                  }}
                >
                  {text.cancel}
                </Button>
                <Button type="submit" size="sm" disabled={busy || !password}>
                  {text.confirm}
                </Button>
              </div>
            </form>
          ) : null}
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <LockIcon className="h-4 w-4 text-primary" />
              {text.lockTitle}
            </div>
            {status.lockOn ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void toggleLock(false)}>
                {text.turnOff}
              </Button>
            ) : status.canLock ? (
              <Button size="sm" disabled={busy} onClick={() => void toggleLock(true)}>
                {text.turnOn}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {status.lockOn ? text.lockOn : status.canLock ? text.lockOff : text.lockNoScreenLock}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
