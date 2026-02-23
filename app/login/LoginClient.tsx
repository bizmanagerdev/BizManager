"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
    <form
      onSubmit={(e) => {
        e.preventDefault();
        signIn();
      }}
      style={{ maxWidth: 420, margin: "40px auto", display: "grid", gap: 10 }}
    >
      <h1>Login</h1>
      <input
        placeholder="Email"
        type="email"
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

      <button type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Sign in"}
      </button>

      <button
        onClick={() =>
          router.push(
            `/forgot-password${
              email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""
            }`
          )
        }
        disabled={loading}
      >
        Forgot password?
      </button>

      <button
        onClick={() =>
          router.push(
            `/register${
              email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""
            }`
          )
        }
        disabled={loading}
      >
        Create an account
      </button>

      {err && <p style={{ color: "red" }}>{err}</p>}

      {showSignUpPrompt && (
        <p style={{ margin: 0, color: "#555" }}>
          Don&apos;t have an account?{" "}
          <button
            type="button"
            onClick={() =>
              router.push(`/register?email=${encodeURIComponent(email.trim())}`)
            }
            disabled={loading}
          >
            Sign up
          </button>
        </p>
      )}
    </form>
  );
}

