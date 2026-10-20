// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  BANK_STRIP_COOKIE,
  bankStripStyle,
  parseBankStripHeight,
  rememberBankStripHeight,
} from "@/lib/ui/bank-strip-height";

// The accounts page's loading screen took a strip of 132px where the page's
// stood at 155 (an account name on two lines makes every tile taller), and the
// register jumped down 23px as the page came in (owner, 2026-10-20). The page
// keeps its strip's height on the device; the loading screen draws at it.

const read = () => document.cookie.split("; ").find((c) => c.startsWith(`${BANK_STRIP_COOKIE}=`))?.split("=")[1];

describe("the accounts strip's kept height", () => {
  beforeEach(() => {
    document.cookie = `${BANK_STRIP_COOKIE}=; path=/; max-age=0`;
  });

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
});
