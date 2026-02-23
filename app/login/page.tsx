"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createSupabaseBrowserClient();
  const router = useRouter();

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  async function signIn() {
    setErr(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErr(error.message);
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
    <div style={{ maxWidth: 420, margin: "40px auto", display: "grid", gap: 10 }}>
      <h1>Login</h1>

      <input
        placeholder="Email"
        value={email}
        onChange={onEmailChange}
        autoComplete="email"
      />

      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={onPasswordChange}
        autoComplete="current-password"
      />

      <button onClick={signIn} disabled={loading}>
        {loading ? "Signing in..." : "Sign in"}
      </button>

      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}
