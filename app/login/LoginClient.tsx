"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState<string>(
    (searchParams.get("email") ?? "").trim()
  );
  const [password, setPassword] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [showSignUpPrompt, setShowSignUpPrompt] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [navTarget, setNavTarget] = useState<"forgot" | "register" | null>(null);

  function navigateWithProgress(href: string, target: "forgot" | "register") {
    if (loading) return;
    setNavTarget(target);
    emitNavigationStart();
    router.push(href);
  }

  async function signIn() {
    if (loading) return;

    setErr(null);
    setShowSignUpPrompt(false);
    setLoading(true);

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setErr("Email and password are required.");
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
        const data = (await res.json().catch(() => ({}))) as Partial<{
          error: string;
        }>;

        const message = data.error ?? "Sign in failed.";
        setErr(message);
        setShowSignUpPrompt(
          message.toLowerCase().includes("invalid email or password")
        );
        setLoading(false);
        return;
      }

      emitNavigationStart();
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setErr("Sign in failed.");
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
      footer={
        <>
          אין לך חשבון?{" "}
          <Link
            className="font-semibold text-destructive hover:underline"
            href={
              email.trim()
                ? `/register?email=${encodeURIComponent(email.trim())}`
                : "/register"
            }
          >
            יצירת חשבון
          </Link>
        </>
      }
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
            placeholder="name@company.com"
            type="email"
            value={email}
            onChange={onEmailChange}
            autoComplete="email"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">סיסמה</label>
          <Input
            placeholder="הקלד/י סיסמה"
            type="password"
            value={password}
            onChange={onPasswordChange}
            autoComplete="current-password"
            disabled={loading}
          />
        </div>

        {err ? (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {err}
          </p>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">מתחבר/ת...</p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "מתחבר/ת..." : "התחברות"}
        </Button>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              navigateWithProgress(
                `/forgot-password${
                  email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""
                }`,
                "forgot"
              )
            }
            disabled={loading || navTarget !== null}
          >
            שכחתי סיסמה
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              navigateWithProgress(
                `/register${
                  email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""
                }`,
                "register"
              )
            }
            disabled={loading || navTarget !== null}
          >
            יצירת חשבון
          </Button>
        </div>
      </form>

      {showSignUpPrompt ? (
        <p className="rounded-xl bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
          עדיין אין לך חשבון?{" "}
          <button
            type="button"
            className="font-semibold text-destructive hover:underline"
            onClick={() => navigateWithProgress(`/register?email=${encodeURIComponent(email.trim())}`, "register")}
            disabled={loading || navTarget !== null}
          >
            להרשמה
          </button>
        </p>
      ) : null}
    </AuthScreen>
  );
}
