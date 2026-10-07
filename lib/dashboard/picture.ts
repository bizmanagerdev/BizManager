import { formatToday, greetingForHour } from "@/lib/dashboard/greeting";
import type { Locale } from "@/lib/i18n/types";

// The dashboard's whole screen as it last stood on this device — top bar with
// its greeting, the finished cards, the bottom bar — kept as plain HTML and
// shown over everything the instant the app opens, before any of its code has
// run and before the page's own loading screen (components/dashboard/
// DashboardPicture.tsx). The live screen takes over once it looks the same.
// Kept only from the top of the page, so it lines up with how a page opens.
// The greeting and the date in it are brought up to the moment it's shown.
// Per person, a week at most, wiped at logout and when someone else signs in
// on this device (like lib/powersync/stored-results.ts).

/**
 * The off switch. To turn the picture off without touching the code: in
 * Vercel → Settings → Environment Variables, add NEXT_PUBLIC_DASHBOARD_PICTURE
 * = off, then redeploy. Every device then opens the dashboard the normal way
 * and forgets the picture it kept. (Remove the variable and redeploy to turn
 * it back on.)
 */
export const DASHBOARD_PICTURE_ON = process.env.NEXT_PUBLIC_DASHBOARD_PICTURE !== "off";

export const PICTURE_KEY = "bizh-dashboard-picture";
export const PICTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The picture's box, in the app's frame (outside every loading screen). */
export const PICTURE_BOX_ID = "bizh-dashboard-picture";
/** Set on <html> while the picture is up. */
export const PICTURE_SHOWING_ATTR = "data-dashboard-picture";
/** A screen bigger than this isn't kept (it would crowd the device's storage). */
const PICTURE_MAX_CHARS = 600_000;

/** Something on the board still loading: a placeholder, or a remembered card waiting for its fresh one. */
export const BOARD_PENDING_SELECTOR = '[data-skeleton], [aria-busy="true"]';

type Picture = {
  /** Whose (users.id). */
  u: string;
  /** When it was kept. */
  t: number;
  /** The screen's HTML. */
  h: string;
  /** The window's size then — at another size the screen is laid out differently. */
  vw: number;
  vh: number;
  /** The page's background behind it. */
  bg: string;
  /** The greeting and the date as they read in it — swapped for the current ones when it's shown. */
  g: string | null;
  d: string;
};

/** A live element as part of the picture: nothing that runs, nothing that clashes with the live page. */
export function pictureHtml(screen: HTMLElement): string {
  const clone = screen.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, template, noscript, iframe, video, audio, [data-picture-skip]").forEach((el) => el.remove());
  for (const el of [clone, ...clone.querySelectorAll<HTMLElement>("*")]) {
    for (const { name } of [...el.attributes]) {
      if (
        name === "id" ||
        name === "autofocus" ||
        name.startsWith("on") ||
        name === "data-app-screen" ||
        name === "data-dashboard-board" ||
        name === "data-dashboard-greeting"
      ) {
        el.removeAttribute(name);
      }
    }
  }
  return clone.outerHTML;
}

/** Keep the live screen (`[data-app-screen]`) as this person's picture — only from the top of the page. */
export function savePicture(userId: string, screen: HTMLElement, locale: Locale): void {
  try {
    if (window.scrollY !== 0) return;
    const html = pictureHtml(screen);
    if (html.length > PICTURE_MAX_CHARS) return;
    const picture: Picture = {
      u: userId,
      t: Date.now(),
      h: html,
      vw: window.innerWidth,
      vh: window.innerHeight,
      bg: getComputedStyle(document.body).backgroundColor,
      g: screen.querySelector("[data-greeting-text]")?.textContent ?? null,
      d: formatToday(new Date(), locale),
    };
    localStorage.setItem(PICTURE_KEY, JSON.stringify(picture));
  } catch {
    // Storage full or blocked: the next opening just draws the board.
  }
}

/** Logout (no `keepUserId`), or someone else signed in: forget the picture. */
export function clearPicture(keepUserId?: string): void {
  try {
    const raw = localStorage.getItem(PICTURE_KEY);
    if (!raw) return;
    if (!keepUserId || (JSON.parse(raw) as Picture).u !== keepUserId) localStorage.removeItem(PICTURE_KEY);
  } catch {
    try {
      localStorage.removeItem(PICTURE_KEY);
    } catch {
      // Storage blocked.
    }
  }
}

/** Is the picture up? */
export function pictureShowing(): boolean {
  return document.documentElement.hasAttribute(PICTURE_SHOWING_ATTR);
}

/** Take the picture down: the live screen shows. */
export function takeDownPicture(): void {
  document.documentElement.removeAttribute(PICTURE_SHOWING_ATTR);
  const box = document.getElementById(PICTURE_BOX_ID);
  if (box) {
    box.innerHTML = "";
    box.removeAttribute("style");
  }
}

/**
 * The inline script that puts the picture up while the page is still being
 * read — right after its box, on a full load of /dashboard only, for this
 * person's own picture, under a week old, at the same window size. The
 * greeting is the one for the device's hour now and the date is today's
 * (same rules as lib/dashboard/greeting.ts — the hours' greetings are written
 * into the script).
 */
export function pictureScript(userId: string, locale: Locale): string {
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  const greetings = Array.from({ length: 24 }, (_, hour) => greetingForHour(hour, locale));
  const dateLocale = locale === "ar" ? "ar" : "he-IL";
  return (
    "(function(){try{" +
    'if(location.pathname!=="/dashboard")return;' +
    `var b=document.getElementById(${json(PICTURE_BOX_ID)});if(!b)return;` +
    `var r=localStorage.getItem(${json(PICTURE_KEY)});if(!r)return;` +
    "var p=JSON.parse(r);" +
    `if(p.u!==${json(userId)}||!(Date.now()-p.t<${PICTURE_MAX_AGE_MS})||typeof p.h!=="string")return;` +
    "if(p.vw!==window.innerWidth||Math.abs(p.vh-window.innerHeight)>2)return;" +
    "b.innerHTML=p.h;b.style.background=p.bg;" +
    // The greeting and the date, as of now.
    "var n=new Date()," +
    `g=${json(greetings)}[n.getHours()],` +
    `d=new Intl.DateTimeFormat(${json(dateLocale)},{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(n),` +
    "w=document.createTreeWalker(b,NodeFilter.SHOW_TEXT),t;" +
    "while((t=w.nextNode())){if(p.g&&t.nodeValue===p.g)t.nodeValue=g;else if(t.nodeValue===p.d)t.nodeValue=d;}" +
    `document.documentElement.setAttribute(${json(PICTURE_SHOWING_ATTR)},"");` +
    // When it went up, for the timing report (lib/powersync/page-timing.ts).
    "window.__bizhPictureAt=performance.now();" +
    "}catch(e){}})();"
  );
}
