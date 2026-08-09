"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HideIcon, ShowIcon } from "@/components/ui/icons";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toHebrewError } from "@/lib/error-messages";

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState<string>((searchParams.get("email") ?? "").trim());
  const [password, setPassword] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [navTarget, setNavTarget] = useState<"forgot" | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  function navigateWithProgress(href: string) {
    if (loading) return;
    setNavTarget("forgot");
    emitNavigationStart();
    router.push(href);
  }

  async function signIn() {
    if (loading) return;

    setErr(null);
    setLoading(true);

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setErr("יש להזין אימייל וסיסמה.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Partial<{ error: string }>;
        setErr(toHebrewError(data.error, "ההתחברות נכשלה."));
        setLoading(false);
        return;
      }

      emitNavigationStart();
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setErr("ההתחברות נכשלה.");
      setLoading(false);
    }
  }

  function onEmailChange(e: ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value);
  }

  function onPasswordChange(e: ChangeEvent<HTMLInputElement>) {
    setPassword(e.target.value);
  }

  return (
    <AuthScreen
      title="התחברות"
      description="גישה מהירה למערכת וניהול העסק ממקום אחד."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          signIn();
        }}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">אימייל</label>
          <Input
            type="email"
            value={email}
            onChange={onEmailChange}
            autoComplete="email"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">סיסמה</label>
          <div className="relative">
            <Input
              placeholder="הקלד/י סיסמה"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={onPasswordChange}
              autoComplete="current-password"
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

        {err ? (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</p>
        ) : null}
        {loading ? <p className="text-sm text-muted-foreground">מתחבר/ת...</p> : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "מתחבר/ת..." : "התחברות"}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            navigateWithProgress(
              `/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`
            )
          }
          disabled={loading || navTarget !== null}
          className="w-full"
        >
          שכחתי סיסמה
        </Button>
      </form>
    </AuthScreen>
  );
}
