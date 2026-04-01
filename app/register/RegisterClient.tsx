"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function RegisterClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const prefillEmail = useMemo(() => {
    return (searchParams.get("email") ?? "").trim();
  }, [searchParams]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (prefillEmail) setEmail(prefillEmail);
  }, [prefillEmail]);

  function onChange(setter: (v: string) => void) {
    return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setter(e.target.value);
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
      setErr("Email and password are required.");
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
          setInfo("That email already has an account. Please sign in.");
          router.replace(`/login?email=${encodeURIComponent(trimmedEmail)}`);
          return;
        }

        setErr(data.error ?? "Registration failed.");
        setLoading(false);
        return;
      }

      if (data.needsEmailConfirmation) {
        setInfo(
          "Account created. Check your email to confirm your account, then sign in."
        );
        router.replace(`/login?email=${encodeURIComponent(trimmedEmail)}`);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setErr("Registration failed.");
      setLoading(false);
    }
  }

  return (
    <AuthScreen
      title="יצירת חשבון"
      description="פתיחת חשבון חדש והתחלה מהירה עם BizManager."
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
            placeholder="name@company.com"
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
          <Input
            placeholder="יצירת סיסמה"
            type="password"
            value={password}
            onChange={onChange(setPassword)}
            autoComplete="new-password"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">הערות</label>
          <Textarea
            placeholder="אופציונלי"
            value={notes}
            onChange={onChange(setNotes)}
            rows={3}
            disabled={loading}
          />
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

        <Button onClick={register} className="w-full" disabled={loading}>
          {loading ? "יוצר/ת חשבון..." : "יצירת חשבון"}
        </Button>

        <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            router.push(
              `/login${
                email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""
              }`
            )
          }
          disabled={loading}
        >
          חזרה להתחברות
        </Button>
      </div>
    </AuthScreen>
  );
}
