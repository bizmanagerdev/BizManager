"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
    <div
      style={{ maxWidth: 520, margin: "40px auto", display: "grid", gap: 10 }}
    >
      <h1>שחזור סיסמה</h1>

      <p style={{ margin: 0, color: "#555" }}>
        הזן/י אימייל ונשלח קישור לאיפוס סיסמה.
      </p>

      <input
        placeholder="אימייל"
        type="email"
        value={email}
        onChange={onEmailChange}
        autoComplete="email"
      />

      <button onClick={sendResetEmail} disabled={loading}>
        {loading ? "שולח..." : "שליחת קישור איפוס"}
      </button>

      <button
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
      </button>

      {info && <p style={{ color: "#155724" }}>{info}</p>}
      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}
