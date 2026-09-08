import { describe, it, expect } from "vitest";
import { describeDevice } from "@/lib/notifications/devices";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE_CHROME =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36";
const ANDROID_TABLET_CHROME =
  "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36 Edg/119.0";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const SAMSUNG_BROWSER =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36";

describe("describeDevice — OS detection", () => {
  it("iPhone", () => {
    expect(describeDevice("https://x", IPHONE_SAFARI)).toMatchObject({ os: "אייפון", icon: "phone" });
  });
  it("Android phone vs Android tablet (by the 'Mobile' token)", () => {
    expect(describeDevice("https://x", ANDROID_PHONE_CHROME)).toMatchObject({ os: "אנדרואיד", icon: "phone" });
    expect(describeDevice("https://x", ANDROID_TABLET_CHROME)).toMatchObject({
      os: "אנדרואיד (טאבלט)",
      icon: "tablet",
    });
  });
  it("Windows / Mac / Linux desktops", () => {
    expect(describeDevice("https://x", WINDOWS_EDGE)).toMatchObject({ os: "Windows", icon: "desktop" });
    expect(describeDevice("https://x", MAC_SAFARI)).toMatchObject({ os: "Mac", icon: "desktop" });
    expect(describeDevice("https://x", "X11; Linux x86_64")).toMatchObject({ os: "Linux", icon: "desktop" });
  });
  it("an unrecognized non-empty UA falls back to the unknown-device label / desktop icon", () => {
    const result = describeDevice("https://x", "SomeWeirdBot/1.0");
    expect(result.os).toBe("מכשיר לא ידוע");
    expect(result.icon).toBe("desktop");
  });
});

describe("describeDevice — browser detection (order matters: Chrome-on-iOS UA also contains 'safari')", () => {
  it("Chrome-on-iOS (CriOS) is reported as Chrome, not Safari", () => {
    expect(describeDevice("https://x", IPHONE_CHROME).browser).toBe("Chrome");
  });
  it("plain Safari is reported as Safari", () => {
    expect(describeDevice("https://x", IPHONE_SAFARI).browser).toBe("Safari");
    expect(describeDevice("https://x", MAC_SAFARI).browser).toBe("Safari");
  });
  it("Edge is reported as Edge, not Chrome, even though its UA also contains 'Chrome'", () => {
    expect(describeDevice("https://x", WINDOWS_EDGE).browser).toBe("Edge");
  });
  it("Samsung Internet is reported as itself, not Chrome (its UA also contains 'Chrome')", () => {
    expect(describeDevice("https://x", SAMSUNG_BROWSER).browser).toBe("Samsung Internet");
  });
  it("an unrecognized browser is blank, not a guess", () => {
    expect(describeDevice("https://x", "SomeWeirdBot/1.0").browser).toBe("");
  });
});

describe("describeDevice — no UA stored: falls back to inferring from the push endpoint host", () => {
  it("Apple push endpoint", () => {
    expect(describeDevice("https://web.push.apple.com/abc", null)).toMatchObject({
      os: "אפל (אייפון/אייפד)",
      icon: "phone",
    });
  });
  it("Google/FCM push endpoint", () => {
    expect(describeDevice("https://fcm.googleapis.com/xyz", null)).toMatchObject({
      os: "אנדרואיד / Chrome",
      icon: "phone",
    });
  });
  it("Mozilla push endpoint", () => {
    expect(describeDevice("https://updates.push.services.mozilla.com/wpush/v2/abc", null)).toMatchObject({
      os: "Firefox",
      icon: "desktop",
    });
  });
  it("a completely unrecognized endpoint with no UA gives the unknown-device fallback", () => {
    expect(describeDevice("https://example.com/xyz", null).os).toBe("מכשיר לא ידוע");
  });
});
