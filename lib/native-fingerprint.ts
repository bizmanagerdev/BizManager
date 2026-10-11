// Fingerprint sign-in and the app lock — the website's half (the phone app's
// half: android/app/src/main/java/com/bizh/app/Fingerprint.java, APK 1.2).
//
// Owner, 2026-10-11: "signing in with your fingerprint is also very valuable";
// the password always works too. The email and password are kept by the phone
// app, encrypted with a key only a matching fingerprint opens; the website never
// stores them. Everything here answers "not available" outside the phone app or
// on an APK before 1.2, so callers just hide their buttons.

export type FingerprintStatus = {
  /** A fingerprint is set up on this phone. */
  canSignIn: boolean;
  /** A sign-in is saved for fingerprint use on this phone. */
  signInSaved: boolean;
  signInEmail: string | null;
  /** The phone has a screen lock or biometric the app lock can ask for. */
  canLock: boolean;
  lockOn: boolean;
};

export type FingerprintFailure = "none" | "invalidated" | "cancelled" | "lockout" | "unavailable" | "error";

type FingerprintPlugin = {
  fingerprintStatus(): Promise<FingerprintStatus>;
  saveFingerprintSignIn(options: { email: string; password: string }): Promise<{ saved: boolean }>;
  fingerprintSignIn(): Promise<{ email: string; password: string }>;
  deleteFingerprintSignIn(): Promise<void>;
  setAppLock(options: { on: boolean }): Promise<{ lockOn: boolean }>;
};

type CapacitorGlobal = {
  PluginHeaders?: Array<{ name: string; methods?: Array<{ name: string }> }>;
  Plugins?: Record<string, unknown>;
};

/** The phone app's helper, if it has the fingerprint part (APK 1.2+). */
async function plugin(): Promise<FingerprintPlugin | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Capacitor, registerPlugin } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    const headers = capacitor?.PluginHeaders;
    const hasFingerprint = headers
      ?.find((header) => header.name === "BizHNative")
      ?.methods?.some((method) => method.name === "fingerprintStatus");
    if (!hasFingerprint) return null;
    // One registration for the whole page (lib/native-app.ts may have made it).
    const registered = capacitor?.Plugins?.BizHNative as FingerprintPlugin | undefined;
    return registered ?? registerPlugin<FingerprintPlugin>("BizHNative");
  } catch {
    return null;
  }
}

function failureOf(err: unknown): FingerprintFailure {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "none" ||
    code === "invalidated" ||
    code === "cancelled" ||
    code === "lockout" ||
    code === "unavailable"
    ? code
    : "error";
}

/** What this phone can do, or null outside the phone app / before APK 1.2. */
export async function fingerprintStatus(): Promise<FingerprintStatus | null> {
  const bizh = await plugin();
  if (!bizh) return null;
  try {
    return await bizh.fingerprintStatus();
  } catch {
    return null;
  }
}

/** Keep this sign-in for the fingerprint (asks for the fingerprint now). */
export async function saveFingerprintSignIn(email: string, password: string): Promise<true | FingerprintFailure> {
  const bizh = await plugin();
  if (!bizh) return "unavailable";
  try {
    await bizh.saveFingerprintSignIn({ email, password });
    return true;
  } catch (err) {
    return failureOf(err);
  }
}

/** The saved email and password, once the fingerprint matches. */
export async function fingerprintSignIn(): Promise<{ email: string; password: string } | FingerprintFailure> {
  const bizh = await plugin();
  if (!bizh) return "unavailable";
  try {
    return await bizh.fingerprintSignIn();
  } catch (err) {
    return failureOf(err);
  }
}

export async function deleteFingerprintSignIn(): Promise<void> {
  const bizh = await plugin();
  await bizh?.deleteFingerprintSignIn().catch(() => {});
}

/** Turn the app lock on (asks for the fingerprint / PIN once) or off. */
export async function setAppLock(on: boolean): Promise<true | FingerprintFailure> {
  const bizh = await plugin();
  if (!bizh) return "unavailable";
  try {
    await bizh.setAppLock({ on });
    return true;
  } catch (err) {
    return failureOf(err);
  }
}
