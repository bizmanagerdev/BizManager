import { afterEach, describe, expect, it } from "vitest";
import { requireCronSecret } from "@/lib/auth/requireCronSecret";

const call = (authorization?: string) =>
  requireCronSecret(new Request("http://test/api/cron/x", { headers: authorization ? { authorization } : {} }));

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("requireCronSecret", () => {
  it("refuses every call while CRON_SECRET isn't set", async () => {
    const res = call("Bearer anything");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(500);
      expect(await res.response.json()).toEqual({ error: "CRON_SECRET not configured" });
    }
  });

  it("refuses a missing or wrong secret", () => {
    process.env.CRON_SECRET = "s3cret";
    for (const header of [undefined, "Bearer wrong", "s3cret", "Bearer s3cre", "Bearer s3cret2"]) {
      const res = call(header);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.response.status).toBe(401);
    }
  });

  it("lets Vercel's scheduler through", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(call("Bearer s3cret")).toEqual({ ok: true });
  });
});
