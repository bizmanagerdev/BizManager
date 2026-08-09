"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HideIcon, ShowIcon } from "@/components/ui/icons";
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

      const hashParams = getHashParams();

      // Supabase reports link failures by REDIRECTING here with the reason in the
      // hash (e.g. #error=access_denied&error_description=Email+link+is+invalid+or+has+expired).
      // Without this we'd fall through to the generic "invalid link" message and
      // throw away the only thing that explains what actually went wrong.
      const errorDescription = hashParams.get("error_description") ?? searchParams.get("error_description");
      const errorCode = hashParams.get("error") ?? searchParams.get("error");
      if (errorDescription || errorCode) {
        if (!cancelled) {
          setErr(toHebrewError(errorDescription ?? errorCode ?? "", "קישור האיפוס אינו תקין או שפג תוקפו."));
          setReady(true);
        }
        return;
      }

      // token_hash works from ANY browser — it needs no locally-stored verifier.
      // Prefer it: recovery links are very often opened on a different device from
      // the one that asked for them.
      const tokenHash = searchParams.get("token_hash") ?? hashParams.get("token_hash");
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (!cancelled && error) setErr(toHebrewError(error.message));
        if (!cancelled) setReady(true);
        return;
      }

      const code = searchParams.get("code");
      if (code) {
        // PKCE: needs the code_verifier stored by THIS browser when the reset was
        // requested. Opening the email elsewhere fails here — say so plainly
        // instead of surfacing "code verifier should be non-empty".
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled && error) {
          const raw = error.message ?? "";
          setErr(
            /verifier/i.test(raw)
              ? "יש לפתוח את קישור האיפוס באותו דפדפן שבו ביקשת אותו. אפשר לבקש קישור חדש ולפתוח אותו כאן."
              : toHebrewError(raw)
          );
        }
        if (!cancelled) setReady(true);
        return;
      }

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

      // Go through our own origin instead of calling GoTrue from the page. The
      // link exchange above has already put the recovery session in cookies, so
      // the API route acts as this user. Doing it from the browser is what broke
      // the in-app change ("Could not parse request body as JSON: invalid
      // character 'P'") — something client-side mangles the cross-origin body.
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(json.error || "שינוי הסיסמה נכשל.");
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
              {showPassword ? <HideIcon className="h-4 w-4" /> : <ShowIcon className="h-4 w-4" />}
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
              {showConfirm ? <HideIcon className="h-4 w-4" /> : <ShowIcon className="h-4 w-4" />}
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
