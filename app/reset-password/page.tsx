"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function getHashParams() {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

export default function ResetPasswordPage() {
  const supabase = createSupabaseBrowserClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setErr(null);
      setInfo(null);

      const code = searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled && error) setErr(error.message);
        if (!cancelled) setReady(true);
        return;
      }

      const hashParams = getHashParams();
      const access_token = hashParams.get("access_token");
      const refresh_token = hashParams.get("refresh_token");

      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (!cancelled && error) setErr(error.message);
        if (!cancelled) setReady(true);
        return;
      }

      if (!cancelled) {
        setErr("Invalid or expired reset link. Please request a new one.");
        setReady(true);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [searchParams, supabase]);

  function onPasswordChange(e: ChangeEvent<HTMLInputElement>) {
    setPassword(e.target.value);
  }

  function onConfirmChange(e: ChangeEvent<HTMLInputElement>) {
    setConfirm(e.target.value);
  }

  async function updatePassword() {
    setErr(null);
    setInfo(null);
    setLoading(true);

    try {
      if (!password || !confirm) {
        setErr("Please enter and confirm your new password.");
        return;
      }

      if (password !== confirm) {
        setErr("Passwords do not match.");
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErr(error.message);
        return;
      }

      setInfo("Password updated. Please sign in with your new password.");
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", display: "grid", gap: 10 }}>
      <h1>Reset password</h1>

      <input
        placeholder="New password"
        type="password"
        value={password}
        onChange={onPasswordChange}
        autoComplete="new-password"
      />

      <input
        placeholder="Confirm new password"
        type="password"
        value={confirm}
        onChange={onConfirmChange}
        autoComplete="new-password"
      />

      <button onClick={updatePassword} disabled={loading || Boolean(err)}>
        {loading ? "Updating..." : "Update password"}
      </button>

      <button onClick={() => router.replace("/login")} disabled={loading}>
        Back to login
      </button>

      {info && <p style={{ color: "#155724" }}>{info}</p>}
      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}

