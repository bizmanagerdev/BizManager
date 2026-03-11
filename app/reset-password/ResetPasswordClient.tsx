"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function getHashParams() {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

export default function ResetPasswordClient() {
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
    return (
      <AuthScreen
        title="׳׳™׳₪׳•׳¡ ׳¡׳™׳¡׳׳”"
        description="טוען את קישור האיפוס המאובטח."
      >
        <p className="text-sm text-muted-foreground">Loading...</p>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="׳׳™׳₪׳•׳¡ ׳¡׳™׳¡׳׳”"
      description="בחרו סיסמה חדשה והמשיכו חזרה למערכת."
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">׳¡׳™׳¡׳׳” ׳—׳“׳©׳”</label>
          <Input
            placeholder="••••••••"
            type="password"
            value={password}
            onChange={onPasswordChange}
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">׳׳™׳׳•׳× ׳¡׳™׳¡׳׳”</label>
          <Input
            placeholder="••••••••"
            type="password"
            value={confirm}
            onChange={onConfirmChange}
            autoComplete="new-password"
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

        <Button
          onClick={updatePassword}
          className="w-full"
          disabled={loading || Boolean(err)}
        >
          {loading ? "׳׳¢׳“׳›׳..." : "׳¢׳“׳›׳•׳ ׳¡׳™׳¡׳׳”"}
        </Button>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => router.replace("/login")}
          disabled={loading}
        >
          ׳—׳–׳¨׳” ׳׳”׳×׳—׳‘׳¨׳•׳×
        </Button>
      </div>
    </AuthScreen>
  );
}
