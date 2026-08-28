"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { HideIcon, ShowIcon } from "@/components/ui/icons";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { toHebrewError } from "@/lib/error-messages";

export default function RegisterClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const prefillEmail = useMemo(() => {
    return (searchParams.get("email") ?? "").trim();
  }, [searchParams]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(prefillEmail);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [navLoading, setNavLoading] = useState(false);

  function onChange(setter: (v: string) => void) {
    return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setter(e.target.value);
  }

  function navigateToLogin() {
    if (loading || navLoading) return;
    setNavLoading(true);
    emitNavigationStart();
    router.push(
      `/login${
        email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""
      }`
    );
  }

  async function register() {
    if (loading) return;

    setErr(null);
    setInfo(null);
    setLoading(true);

    const trimmedEmail = email.trim();
    const trimmedFullName = fullName.trim();
    const trimmedPhone = phone.trim();
    const trimmedNotes = notes.trim();

    if (!trimmedEmail || !password) {
      setErr("יש להזין אימייל וסיסמה.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          full_name: trimmedFullName,
          phone: trimmedPhone,
          notes: trimmedNotes,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as Partial<{
        error: string;
        needsEmailConfirmation: boolean;
      }>;

      if (!res.ok) {
        const msg = data.error?.toLowerCase() ?? "";
        if (msg.includes("already registered") || msg.includes("already exists")) {
          setInfo("האימייל כבר רשום במערכת. יש להתחבר.");
          emitNavigationStart();
          router.replace(`/login?email=${encodeURIComponent(trimmedEmail)}`);
          return;
        }

        setErr(toHebrewError(data.error, "ההרשמה נכשלה."));
        setLoading(false);
        return;
      }

      if (data.needsEmailConfirmation) {
        setInfo("החשבון נוצר. יש לאשר את כתובת האימייל ואז להתחבר.");
        emitNavigationStart();
        router.replace(`/login?email=${encodeURIComponent(trimmedEmail)}`);
        return;
      }

      emitNavigationStart();
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setErr("ההרשמה נכשלה.");
      setLoading(false);
    }
  }

  return (
    <AuthScreen
      title="יצירת חשבון"
      description="פתיחת חשבון חדש והתחלה מהירה עם BizH."
      footer={
        <>
          כבר יש לך חשבון?{" "}
          <Link
            className="font-semibold text-destructive hover:underline"
            href={
              email.trim()
                ? `/login?email=${encodeURIComponent(email.trim())}`
                : "/login"
            }
          >
            התחברות
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">שם מלא</label>
          <Input
            placeholder="שם מלא"
            value={fullName}
            onChange={onChange(setFullName)}
            autoComplete="name"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">אימייל</label>
          <Input
            type="email"
            value={email}
            onChange={onChange(setEmail)}
            autoComplete="email"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">טלפון</label>
          <Input
            placeholder="אופציונלי"
            value={phone}
            onChange={onChange(setPhone)}
            autoComplete="tel"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">סיסמה</label>
          <div className="relative">
            <Input
              placeholder="יצירת סיסמה"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={onChange(setPassword)}
              autoComplete="new-password"
              disabled={loading}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showPassword ? <HideIcon className="h-4 w-4" /> : <ShowIcon className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">הערות</label>
          <div className="relative">
            <Textarea
              placeholder="אופציונלי"
              value={notes}
              onChange={onChange(setNotes)}
              rows={3}
              disabled={loading}
              className="pe-11"
            />
            <DictateButton
              onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
              disabled={loading}
              className="absolute bottom-1 end-1 h-8 w-8"
            />
          </div>
        </div>

        {info ? (
          <p className="rounded-xl bg-success/10 px-4 py-3 text-sm text-success">
            {info}
          </p>
        ) : null}
        {err ? (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {err}
          </p>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">
            יוצר/ת חשבון...
          </p>
        ) : null}

        <Button onClick={register} className="w-full" disabled={loading || navLoading}>
          {loading ? "יוצר/ת חשבון..." : "יצירת חשבון"}
        </Button>

        <Button
          variant="outline"
          className="w-full"
          onClick={navigateToLogin}
          disabled={loading || navLoading}
        >
          חזרה להתחברות
        </Button>
      </div>
    </AuthScreen>
  );
}
