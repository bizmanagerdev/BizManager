"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function RegisterPage() {
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
    setErr(null);
    setInfo(null);
    setLoading(true);

    const trimmedEmail = email.trim();
    const trimmedFullName = fullName.trim();
    const trimmedPhone = phone.trim();
    const trimmedNotes = notes.trim();

    try {
      if (!trimmedEmail || !password) {
        setErr("Email and password are required.");
        return;
      }

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
        return;
      }

      if (data.needsEmailConfirmation) {
        setInfo("Account created. Check your email to confirm your account, then sign in.");
        router.replace(`/login?email=${encodeURIComponent(trimmedEmail)}`);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", display: "grid", gap: 10 }}>
      <h1>Register</h1>

      <input
        placeholder="Full name"
        value={fullName}
        onChange={onChange(setFullName)}
        autoComplete="name"
      />

      <input
        placeholder="Email"
        type="email"
        value={email}
        onChange={onChange(setEmail)}
        autoComplete="email"
      />

      <input
        placeholder="Phone (optional)"
        value={phone}
        onChange={onChange(setPhone)}
        autoComplete="tel"
      />

      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={onChange(setPassword)}
        autoComplete="new-password"
      />

      <textarea
        placeholder="Notes (optional)"
        value={notes}
        onChange={onChange(setNotes)}
        rows={3}
      />

      <button onClick={register} disabled={loading}>
        {loading ? "Creating account..." : "Create account"}
      </button>

      <button
        onClick={() =>
          router.push(
            `/login${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`
          )
        }
        disabled={loading}
      >
        Back to login
      </button>

      {info && <p style={{ color: "#155724" }}>{info}</p>}
      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}
