"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { FingerprintIcon, HideIcon, ShowIcon } from "@/components/ui/icons";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toHebrewError } from "@/lib/error-messages";
import {
  deleteFingerprintSignIn,
  fingerprintSignIn,
  fingerprintStatus,
  saveFingerprintSignIn,
  type FingerprintStatus,
} from "@/lib/native-fingerprint";

/** "Not now" on the offer to sign in with a fingerprint: asked once per phone (the profile page can still turn it on). */
const FINGERPRINT_OFFER_DECLINED_KEY = "bizh-fingerprint-offer-declined";
/** The login API's answer to a wrong email or password (app/api/auth/login). */
const WRONG_PASSWORD_ERROR = "Invalid email or password.";

export default function LoginClient() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  // ?email= is read here, after mount, NOT with useSearchParams(): that hook
  // made Next bail the whole page out of its static prerender, so /login
  // shipped as empty HTML and stayed blank until all of its JS had loaded
  // (~1.4 s on a mid-range phone, before the network). Now the form is in the
  // HTML from the first byte — which means it can be typed into, or filled by
  // a password manager, before React takes over. Keep whatever is already in
  // the fields, or the state would disagree with what the user sees.
  useEffect(() => {
    const typedEmail = emailRef.current?.value ?? "";
    const linkedEmail = (new URLSearchParams(window.location.search).get("email") ?? "").trim();
    // A one-time sync from outside React (the URL and pre-hydration DOM input)
    // on mount — a legitimate effect-driven setState, not a render cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (typedEmail || linkedEmail) setEmail(typedEmail || linkedEmail);
    const typedPassword = passwordRef.current?.value ?? "";
    if (typedPassword) setPassword(typedPassword);
  }, []);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [navTarget, setNavTarget] = useState<"forgot" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // Fingerprint sign-in (phone app 1.2+, lib/native-fingerprint.ts): null in a
  // browser or an older app, and then nothing below shows.
  const [fingerprint, setFingerprint] = useState<FingerprintStatus | null>(null);
  // After a password sign-in on a phone that could use the fingerprint: the
  // one-time offer to turn it on, holding what was just typed.
  const [fingerprintOffer, setFingerprintOffer] = useState<{ email: string; password: string } | null>(null);
  const autoPrompted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void fingerprintStatus().then((status) => {
      if (cancelled || !status) return;
      setFingerprint(status);
      // A saved sign-in: ask for the fingerprint straight away, once per visit
      // (cancel → the password form, as always).
      if (status.signInSaved && !autoPrompted.current) {
        autoPrompted.current = true;
        void signInWithFingerprint();
      }
    });
    return () => {
      cancelled = true;
    };
    // Once, on mount: signInWithFingerprint is a plain function of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goToDashboard() {
    emitNavigationStart();
    router.replace("/dashboard");
    router.refresh();
  }

  /** Sends the sign-in; null when signed in, else the server's error ("" when it couldn't be reached). */
  async function submitLogin(loginEmail: string, loginPassword: string): Promise<string | null> {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (res.ok) return null;
      const data = (await res.json().catch(() => ({}))) as Partial<{ error: string }>;
      return data.error ?? "";
    } catch {
      return "";
    }
  }

  async function signInWithFingerprint() {
    if (loading) return;
    setErr(null);
    const saved = await fingerprintSignIn();
    if (typeof saved === "string") {
      if (saved === "invalidated") {
        setFingerprint((prev) => (prev ? { ...prev, signInSaved: false, signInEmail: null } : prev));
        setErr("טביעות האצבע בטלפון השתנו, ולכן הכניסה בטביעת אצבע כובתה. יש להיכנס עם הסיסמה, ואפשר להפעיל אותה שוב.");
      } else if (saved === "lockout") {
        setErr("יותר מדי ניסיונות. יש להיכנס עם הסיסמה.");
      }
      // Cancelled ("סיסמה"): the form is right there.
      return;
    }
    setEmail(saved.email);
    setLoading(true);
    const error = await submitLogin(saved.email, saved.password);
    if (error === null) {
      goToDashboard();
      return;
    }
    if (error === WRONG_PASSWORD_ERROR) {
      // The password was changed since it was saved: forget it.
      await deleteFingerprintSignIn();
      setFingerprint((prev) => (prev ? { ...prev, signInSaved: false, signInEmail: null } : prev));
      setErr("הסיסמה השתנתה מאז שהופעלה טביעת האצבע. יש להיכנס עם הסיסמה החדשה, ואפשר להפעיל אותה שוב.");
    } else {
      setErr(toHebrewError(error || undefined, "ההתחברות נכשלה."));
    }
    setLoading(false);
  }

  function fingerprintOfferDeclined(): boolean {
    try {
      return window.localStorage.getItem(FINGERPRINT_OFFER_DECLINED_KEY) === "1";
    } catch {
      return false;
    }
  }

  async function answerFingerprintOffer(yes: boolean) {
    const offer = fingerprintOffer;
    if (!offer) return;
    if (yes) {
      // Whatever happens at the prompt, the sign-in itself is done.
      await saveFingerprintSignIn(offer.email, offer.password);
    } else {
      try {
        window.localStorage.setItem(FINGERPRINT_OFFER_DECLINED_KEY, "1");
      } catch {
        // No storage: it may ask again next time.
      }
    }
    setFingerprintOffer(null);
    goToDashboard();
  }

  function navigateWithProgress(href: string) {
    if (loading) return;
    setNavTarget("forgot");
    emitNavigationStart();
    router.push(href);
  }

  async function signIn() {
    if (loading) return;

    setErr(null);
    setLoading(true);

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setErr("יש להזין אימייל וסיסמה.");
      setLoading(false);
      return;
    }

    const error = await submitLogin(trimmedEmail, password);
    if (error !== null) {
      setErr(toHebrewError(error || undefined, "ההתחברות נכשלה."));
      setLoading(false);
      return;
    }

    // On a phone with a fingerprint and no fingerprint sign-in yet: offer it, once.
    if (fingerprint?.canSignIn && !fingerprint.signInSaved && !fingerprintOfferDeclined()) {
      setFingerprintOffer({ email: trimmedEmail, password });
      return;
    }
    goToDashboard();
  }

  function onEmailChange(e: ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value);
  }

  function onPasswordChange(e: ChangeEvent<HTMLInputElement>) {
    setPassword(e.target.value);
  }

  if (fingerprintOffer) {
    return (
      <AuthScreen title="כניסה עם טביעת אצבע" description="בפעם הבאה אפשר להיכנס בלי להקליד סיסמה.">
        <div className="space-y-4">
          <div className="flex justify-center text-primary">
            <FingerprintIcon className="h-14 w-14" />
          </div>
          <p className="text-sm text-muted-foreground">
            הסיסמה נשמרת מוצפנת בטלפון הזה בלבד, ורק טביעת האצבע שלך פותחת אותה. הכניסה עם הסיסמה תמיד עובדת גם.
          </p>
          <Button type="button" className="w-full" onClick={() => void answerFingerprintOffer(true)}>
            כן, להפעיל
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={() => void answerFingerprintOffer(false)}>
            לא עכשיו
          </Button>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="התחברות"
      description="גישה מהירה למערכת וניהול העסק ממקום אחד."
    >
      {fingerprint?.signInSaved ? (
        <div className="mb-4 space-y-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full gap-2"
            disabled={loading}
            onClick={() => void signInWithFingerprint()}
          >
            <FingerprintIcon className="h-5 w-5" />
            כניסה עם טביעת אצבע
          </Button>
          {fingerprint.signInEmail ? (
            <p className="text-center text-xs text-muted-foreground" dir="ltr">
              {fingerprint.signInEmail}
            </p>
          ) : null}
        </div>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          signIn();
        }}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">אימייל</label>
          <Input
            ref={emailRef}
            type="email"
            value={email}
            onChange={onEmailChange}
            autoComplete="email"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">סיסמה</label>
          <div className="relative">
            <Input
              ref={passwordRef}
              placeholder="הקלד/י סיסמה"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={onPasswordChange}
              autoComplete="current-password"
              disabled={loading}
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

        {err ? (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</p>
        ) : null}
        {loading ? <p className="text-sm text-muted-foreground">מתחבר/ת...</p> : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "מתחבר/ת..." : "התחברות"}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            navigateWithProgress(
              `/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`
            )
          }
          disabled={loading || navTarget !== null}
          className="w-full"
        >
          שכחתי סיסמה
        </Button>
      </form>
    </AuthScreen>
  );
}
