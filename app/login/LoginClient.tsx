"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

  async function signIn() {
    if (loading) return;

    setErr(null);
    setShowSignUpPrompt(false);
    setLoading(true);

    try {
      const trimmedEmail = email.trim();

      if (!trimmedEmail || !password) {
        setErr("Email and password are required.");
        return;
      }
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
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } finally {
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
      title="׳”׳×׳—׳‘׳¨׳•׳×"
      description="גישה מהירה למערכת הניהול עם מראה חדש ועקבי."
      footer={
        <>
          ׳׳“׳©/׳” ׳›׳׳?{" "}
          <Link
            className="font-semibold text-destructive hover:underline"
            href={
              email.trim()
                ? `/register?email=${encodeURIComponent(email.trim())}`
                : "/register"
            }
          >
            ׳™׳¦׳™׳¨׳× ׳—׳©׳‘׳•׳
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
          <label className="text-sm font-medium text-foreground">׳׳™׳׳™׳™׳</label>
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
          <label className="text-sm font-medium text-foreground">׳¡׳™׳¡׳׳”</label>
          <Input
            placeholder="••••••••"
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
          <p className="text-sm text-muted-foreground">
            ׳׳×׳—׳‘׳¨, ׳ ׳ ׳׳”׳׳×׳™׳...
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "׳׳×׳—׳‘׳¨..." : "׳”׳×׳—׳‘׳¨/׳™"}
        </Button>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              router.push(
                `/forgot-password${
                  email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""
                }`
              )
            }
            disabled={loading}
          >
            ׳©׳›׳—׳× ׳¡׳™׳¡׳׳”?
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              router.push(
                `/register${
                  email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""
                }`
              )
            }
            disabled={loading}
          >
            ׳™׳¦׳™׳¨׳× ׳—׳©׳‘׳•׳
          </Button>
        </div>
      </form>

      {showSignUpPrompt ? (
        <p className="rounded-xl bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
          ׳׳™׳ ׳׳ ׳—׳©׳‘׳•׳?{" "}
          <button
            type="button"
            className="font-semibold text-destructive hover:underline"
            onClick={() =>
              router.push(`/register?email=${encodeURIComponent(email.trim())}`)
            }
            disabled={loading}
          >
            ׳”׳¨׳©׳׳”
          </button>
        </p>
      ) : null}
    </AuthScreen>
  );
}
