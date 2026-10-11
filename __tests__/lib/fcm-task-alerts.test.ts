import { beforeEach, describe, expect, it, vi } from "vitest";

// Task alerts with buttons (APK 1.2): a phone on build 6+ gets an alert about a
// task as a data-only message its app draws with "בוצע" / "לטיפול מחר" /
// "פתיחה"; every other phone, and every other alert, keeps the plain message.

const sent: Array<Record<string, unknown>> = [];
vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: () => ({}),
  cert: () => ({}),
}));
vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({
    sendEachForMulticast: async (message: { tokens: string[] } & Record<string, unknown>) => {
      sent.push(message);
      return { responses: message.tokens.map(() => ({ success: true })) };
    },
  }),
}));

process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{}";

import { appBuildOf, sendFcmToRecipients, TASK_ALERT_BUTTONS_BUILD } from "@/lib/fcm";

const OLD_APP = "Mozilla/5.0 (Linux; Android 15; wv) Chrome/140 Mobile Safari/537.36";
const rows = [
  { id: "1", token: "tok-old", user_id: "u", user_agent: OLD_APP },
  { id: "2", token: "tok-111", user_id: "u", user_agent: `${OLD_APP} BizHApp/5` },
  { id: "3", token: "tok-12", user_id: "u", user_agent: `${OLD_APP} BizHApp/6` },
];

function supabaseWith(tokens: typeof rows) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.in = () => builder;
  builder.delete = () => builder;
  builder.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: tokens, error: null }).then(onF);
  return { from: () => builder } as never;
}

describe("appBuildOf", () => {
  it("reads the build the phone app adds to its user agent", () => {
    expect(appBuildOf(`${OLD_APP} BizHApp/6`)).toBe(6);
    expect(appBuildOf(`${OLD_APP} BizHApp/12`)).toBe(12);
  });
  it("is 0 when it doesn't say", () => {
    expect(appBuildOf(OLD_APP)).toBe(0);
    expect(appBuildOf(null)).toBe(0);
    expect(TASK_ALERT_BUTTONS_BUILD).toBe(6);
  });
});

describe("sendFcmToRecipients — task alerts", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("sends a task alert to APK 1.2+ as data only, with the task, and to older phones as before", async () => {
    const res = await sendFcmToRecipients(supabaseWith(rows), ["u"], {
      title: "🔔 תזכורת: להתקשר לספק",
      body: "הגיע מועד התזכורת למשימה.",
      url: "/tasks/11111111-2222-3333-4444-555555555555",
      tag: "reminder-r1",
      taskId: "11111111-2222-3333-4444-555555555555",
    });
    expect(res).toEqual({ sent: 3, failed: 0 });

    const plain = sent.find((m) => (m.tokens as string[]).includes("tok-old"));
    const buttons = sent.find((m) => (m.tokens as string[]).includes("tok-12"));
    expect(plain?.tokens).toEqual(["tok-old", "tok-111"]);
    expect(plain?.notification).toEqual({ title: "🔔 תזכורת: להתקשר לספק", body: "הגיע מועד התזכורת למשימה." });

    expect(buttons?.tokens).toEqual(["tok-12"]);
    expect(buttons?.notification).toBeUndefined();
    expect(buttons?.android).toEqual({ priority: "high" });
    expect(buttons?.data).toEqual({
      type: "task_alert",
      title: "🔔 תזכורת: להתקשר לספק",
      body: "הגיע מועד התזכורת למשימה.",
      url: "/tasks/11111111-2222-3333-4444-555555555555",
      taskId: "11111111-2222-3333-4444-555555555555",
      tag: "reminder-r1",
    });
  });

  it("an alert that isn't about a task goes plain to every phone", async () => {
    await sendFcmToRecipients(supabaseWith(rows), ["u"], { title: "סיכום יומי", body: "3 דברים", url: "/inbox" });
    expect(sent).toHaveLength(1);
    expect(sent[0].tokens).toEqual(["tok-old", "tok-111", "tok-12"]);
    expect(sent[0].notification).toBeDefined();
  });
});
