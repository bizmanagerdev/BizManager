// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The loading screen's shell: only whether the screen itself waits matters here.
vi.mock("@/components/layout/AppShell", () => ({ default: ({ children }: { children: unknown }) => children }));
import {
  BANK_STRIP_COOKIE,
  BANK_STRIP_SCRIPT,
  bankStripStyle,
  parseBankStripHeight,
  rememberBankStripHeight,
} from "@/lib/ui/bank-strip-height";

// The accounts page's loading screen took a strip of 132px where the page's
// stood at 155 (an account name on two lines makes every tile taller), and the
// register jumped down 23px as the page came in (owner, 2026-10-20). The page
// keeps its strip's height on the device; the loading screen draws at it —
// set before the first paint, so the loading screen itself never waits (when it
// waited, /financial's cash-flow placeholder showed first, 2026-10-28).

const read = () => document.cookie.split("; ").find((c) => c.startsWith(`${BANK_STRIP_COOKIE}=`))?.split("=")[1];

describe("the accounts strip's kept height", () => {
  beforeEach(() => {
    document.cookie = `${BANK_STRIP_COOKIE}=; path=/; max-age=0`;
    document.documentElement.style.removeProperty("--bank-strip-h");
  });

  const stripVar = () => document.documentElement.style.getPropertyValue("--bank-strip-h");

  it("is kept on the device and handed to the loading screen's strip", () => {
    rememberBankStripHeight(154.6);
    expect(read()).toBe("155");
    expect(bankStripStyle(read())).toEqual({ "--bank-strip-h": "155px" });
  });

  it("nothing kept, or nonsense: the loading screen's own height", () => {
    expect(bankStripStyle(undefined)).toBeUndefined();
    expect(parseBankStripHeight("abc")).toBeNull();
    expect(parseBankStripHeight("12")).toBeNull();
    rememberBankStripHeight(5000);
    expect(read()).toBeUndefined();
  });

  it("before the first paint, the kept height goes on the page (the loading screen's strip reads it)", () => {
    document.cookie = `${BANK_STRIP_COOKIE}=162; path=/`;
    new Function(BANK_STRIP_SCRIPT)();
    expect(stripVar()).toBe("162px");
  });

  it("nothing kept, or nonsense in the cookie: nothing set, and nothing thrown", () => {
    new Function(BANK_STRIP_SCRIPT)();
    expect(stripVar()).toBe("");
    document.cookie = `${BANK_STRIP_COOKIE}=9999; path=/`;
    new Function(BANK_STRIP_SCRIPT)();
    expect(stripVar()).toBe("");
  });

  it("a new height kept on the page at once too, for the next loading screen before a reload", () => {
    rememberBankStripHeight(171);
    expect(stripVar()).toBe("171px");
  });
});

describe("the accounts page's loading screen", () => {
  it("never waits for anything (a waiting one shows /financial's cash-flow placeholder first)", async () => {
    const { default: BankLoading } = await import("@/app/(app)/financial/bank/loading");
    expect(BankLoading()).not.toBeInstanceOf(Promise);
  });
});
