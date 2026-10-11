// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Fingerprint sign-in on the login page (phone app 1.2+). The password form is
// always there; on a phone with a fingerprint, a password sign-in offers to turn
// fingerprint sign-in on once; a saved one is asked for at once.

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/layout/TopNavigationProgress", () => ({ emitNavigationStart: () => {} }));

const fp = vi.hoisted(() => ({
  status: null as null | Record<string, unknown>,
  signIn: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/native-fingerprint", () => ({
  fingerprintStatus: async () => fp.status,
  fingerprintSignIn: () => fp.signIn(),
  saveFingerprintSignIn: (email: string, password: string) => fp.save(email, password),
  deleteFingerprintSignIn: () => fp.remove(),
}));

import LoginClient from "@/app/login/LoginClient";

const PHONE = { canSignIn: true, signInSaved: false, signInEmail: null, canLock: true, lockOn: false };

function loginAnswers(ok: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ok
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify({ error: "Invalid email or password." }), { status: 400 })
    )
  );
}

function typeAndSubmit(email: string, password: string) {
  const [emailInput] = document.querySelectorAll<HTMLInputElement>('input[type="email"]');
  const passwordInput = document.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!;
  fireEvent.change(emailInput, { target: { value: email } });
  fireEvent.change(passwordInput, { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "התחברות" }));
}

describe("LoginClient — fingerprint", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    router.replace.mockReset();
    fp.signIn.mockReset();
    fp.save.mockReset().mockResolvedValue(true);
    fp.remove.mockReset().mockResolvedValue(undefined);
    window.localStorage.clear();
  });

  it("in a browser: just the password form, straight to the dashboard", async () => {
    fp.status = null;
    loginAnswers(true);
    render(<LoginClient />);
    typeAndSubmit("a@b.co", "pw");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText("כניסה עם טביעת אצבע")).toBeNull();
  });

  it("on a phone with a fingerprint: offers it once after the password; yes keeps the sign-in", async () => {
    fp.status = PHONE;
    loginAnswers(true);
    render(<LoginClient />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    typeAndSubmit("a@b.co", "pw");
    fireEvent.click(await screen.findByRole("button", { name: "כן, להפעיל" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(fp.save).toHaveBeenCalledWith("a@b.co", "pw");
  });

  it("'not now' isn't asked again on this phone", async () => {
    fp.status = PHONE;
    loginAnswers(true);
    render(<LoginClient />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    typeAndSubmit("a@b.co", "pw");
    fireEvent.click(await screen.findByRole("button", { name: "לא עכשיו" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(fp.save).not.toHaveBeenCalled();
    cleanup();
    router.replace.mockReset();

    render(<LoginClient />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    typeAndSubmit("a@b.co", "pw");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByRole("button", { name: "כן, להפעיל" })).toBeNull();
  });

  it("a saved sign-in is asked for at once, and signs in with it", async () => {
    fp.status = { ...PHONE, signInSaved: true, signInEmail: "a@b.co" };
    fp.signIn.mockResolvedValue({ email: "a@b.co", password: "pw" });
    loginAnswers(true);
    render(<LoginClient />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ body: JSON.stringify({ email: "a@b.co", password: "pw" }) }));
  });

  it("a saved password that no longer works is forgotten, and says so", async () => {
    fp.status = { ...PHONE, signInSaved: true, signInEmail: "a@b.co" };
    fp.signIn.mockResolvedValue({ email: "a@b.co", password: "old" });
    loginAnswers(false);
    render(<LoginClient />);
    expect(await screen.findByText(/הסיסמה השתנתה/)).toBeTruthy();
    expect(fp.remove).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("כניסה עם טביעת אצבע")).toBeNull();
  });

  it("cancel at the prompt: the password form, no error", async () => {
    fp.status = { ...PHONE, signInSaved: true, signInEmail: "a@b.co" };
    fp.signIn.mockResolvedValue("cancelled");
    loginAnswers(true);
    render(<LoginClient />);
    expect(await screen.findByText("כניסה עם טביעת אצבע")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector(".text-destructive")).toBeNull();
  });
});
