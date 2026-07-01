// Derives a human-friendly device/browser label for a push subscription from
// its user-agent string, falling back to the push endpoint host when the UA is
// unavailable (older rows saved before we captured it).

export type DeviceIcon = "phone" | "tablet" | "desktop";

export type DeviceInfo = {
  /** Hebrew OS / device label, e.g. "אייפון", "אנדרואיד". */
  os: string;
  /** Browser name, e.g. "Chrome" — empty string when unknown. */
  browser: string;
  icon: DeviceIcon;
};

export function describeDevice(endpoint: string, userAgent: string | null): DeviceInfo {
  const ua = (userAgent ?? "").toLowerCase();
  const ep = (endpoint ?? "").toLowerCase();

  let os = "מכשיר לא ידוע";
  let icon: DeviceIcon = "desktop";

  if (/iphone/.test(ua)) {
    os = "אייפון";
    icon = "phone";
  } else if (/ipad/.test(ua)) {
    os = "אייפד";
    icon = "tablet";
  } else if (/android/.test(ua)) {
    const mobile = /mobile/.test(ua);
    os = mobile ? "אנדרואיד" : "אנדרואיד (טאבלט)";
    icon = mobile ? "phone" : "tablet";
  } else if (/windows/.test(ua)) {
    os = "Windows";
    icon = "desktop";
  } else if (/mac os|macintosh/.test(ua)) {
    os = "Mac";
    icon = "desktop";
  } else if (/linux/.test(ua)) {
    os = "Linux";
    icon = "desktop";
  } else if (ua === "") {
    // No UA stored — infer platform from the push service host.
    if (ep.includes("apple")) {
      os = "אפל (אייפון/אייפד)";
      icon = "phone";
    } else if (ep.includes("google") || ep.includes("fcm") || ep.includes("android")) {
      os = "אנדרואיד / Chrome";
      icon = "phone";
    } else if (ep.includes("mozilla")) {
      os = "Firefox";
      icon = "desktop";
    }
  }

  let browser = "";
  if (/edg\//.test(ua)) browser = "Edge";
  else if (/samsungbrowser/.test(ua)) browser = "Samsung Internet";
  else if (/crios|chrome/.test(ua)) browser = "Chrome";
  else if (/fxios|firefox/.test(ua)) browser = "Firefox";
  else if (/safari/.test(ua)) browser = "Safari";

  return { os, browser, icon };
}
