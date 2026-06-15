"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { toHebrewError } from "@/lib/error-messages";

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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [navLoading, setNavLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setErr(null);
      setInfo(null);

      const code = searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled && error) setErr(toHebrewError(error.message));
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
        if (!cancelled && error) setErr(toHebrewError(error.message));
        if (!cancelled) setReady(true);
        return;
      }

      if (!cancelled) {
        setErr("קישור האיפוס אינו תקין או שפג תוקפו. יש לבקש קישור חדש.");
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
        setErr("יש להזין ולאשר סיסמה חדשה.");
        return;
      }

      if (password !== confirm) {
        setErr("הסיסמאות אינן תואמות.");
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErr(toHebrewError(error.message));
        return;
      }

      setInfo("הסיסמה עודכנה. יש להתחבר עם הסיסמה החדשה.");
      await supabase.auth.signOut();
      emitNavigationStart();
      router.replace("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <AuthScreen
        title="איפוס סיסמה"
        description="מאמתים את קישור האיפוס המאובטח."
      >
        <p className="text-sm text-muted-foreground">טוען...</p>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="בחירת סיסמה חדשה"
      description="הגדר/י סיסמה חדשה לחשבון שלך וחזור/י למערכת."
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">סיסמה חדשה</label>
          <div className="relative">
            <Input
              placeholder="הקלד/י סיסמה חדשה"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={onPasswordChange}
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            אימות סיסמה
          </label>
          <div className="relative">
            <Input
              placeholder="הקלד/י שוב את הסיסמה"
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={onConfirmChange}
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
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
          disabled={loading || navLoading || Boolean(err)}
        >
          {loading ? "מעדכן/ת..." : "עדכון סיסמה"}
        </Button>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            if (loading || navLoading) return;
            setNavLoading(true);
            emitNavigationStart();
            router.replace("/login");
          }}
          disabled={loading || navLoading}
        >
          חזרה להתחברות
        </Button>
      </div>
    </AuthScreen>
  );
}
