"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordClient() {
  const supabase = createSupabaseBrowserClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState<string>(
    (searchParams.get("email") ?? "").trim()
  );
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  function onEmailChange(e: ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value);
  }

  async function sendResetEmail() {
    setErr(null);
    setInfo(null);
    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setErr("Email is required.");
        return;
      }

      const redirectTo = `${window.location.origin}/reset-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo,
      });

      if (error) {
        setErr(error.message);
        return;
      }

      setInfo("If an account exists for that email, a reset link was sent.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScreen
      title="איפוס סיסמה"
      description="הזן/י את כתובת האימייל ונשלח קישור לאיפוס הסיסמה."
      footer={
        <Link
          className="font-semibold text-destructive hover:underline"
          href={
            email.trim()
              ? `/login?email=${encodeURIComponent(email.trim())}`
            : "/login"
          }
        >
          חזרה להתחברות
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">אימייל</label>
          <Input
            placeholder="name@company.com"
            type="email"
            value={email}
            onChange={onEmailChange}
            autoComplete="email"
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

        <Button onClick={sendResetEmail} className="w-full" disabled={loading}>
          {loading ? "שולח/ת..." : "שליחת קישור לאיפוס"}
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
