// The dashboard as it last stood on this device — its finished cards, kept as
// plain HTML with where they sat on the page — shown the instant the app opens,
// before any of its code has run and before the page's own loading screen
// (components/dashboard/DashboardPicture.tsx). The live board takes over as
// soon as it's drawn. Per person, a week at most, wiped at logout and when
// someone else signs in on this device (like lib/powersync/stored-results.ts).

export const PICTURE_KEY = "bizh-dashboard-picture";
export const PICTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The picture's box, in the app's frame (outside every loading screen). */
export const PICTURE_BOX_ID = "bizh-dashboard-picture";
/** Set on <html> while the picture is up; globals.css hides what's beneath it. */
export const PICTURE_SHOWING_ATTR = "data-dashboard-picture";
/** A board bigger than this isn't kept (it would crowd the device's storage). */
const PICTURE_MAX_CHARS = 400_000;

/** Something on the board still loading: a placeholder, or a remembered card waiting for its fresh one. */
export const BOARD_PENDING_SELECTOR = '[data-skeleton], [aria-busy="true"]';

type Picture = {
  /** Whose (users.id). */
  u: string;
  /** When it was kept. */
  t: number;
  /** The board's HTML. */
  h: string;
  /** Where the board sat on the page, and how wide it was, in px. */
  x: number;
  y: number;
  w: number;
  /** The window's width then — at another width the board is laid out differently. */
  vw: number;
};

/** The live board's HTML as a picture: nothing that runs, nothing that clashes with the live page. */
export function pictureHtml(board: HTMLElement): string {
  const clone = board.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, template, noscript, iframe, video, audio, [data-picture-skip]").forEach((el) => el.remove());
  for (const el of [clone, ...clone.querySelectorAll<HTMLElement>("*")]) {
    for (const { name } of [...el.attributes]) {
      if (name === "id" || name === "autofocus" || name.startsWith("on")) el.removeAttribute(name);
    }
  }
  clone.removeAttribute("data-dashboard-board");
  // Placed by its own box's position; its margins would move it off the spot.
  clone.style.margin = "0px";
  return clone.outerHTML;
}

/** Keep the live board as this person's picture. */
export function savePicture(userId: string, board: HTMLElement): void {
  try {
    const rect = board.getBoundingClientRect();
    if (rect.width === 0) return; // off the page: nowhere to put it
    const html = pictureHtml(board);
    if (html.length > PICTURE_MAX_CHARS) return;
    const picture: Picture = {
      u: userId,
      t: Date.now(),
      h: html,
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      w: Math.round(rect.width),
      vw: window.innerWidth,
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

/** Take the picture down: what's beneath shows again. */
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
 * person's own picture, under a week old, at the same window width.
 */
export function pictureScript(userId: string): string {
  const user = JSON.stringify(userId).replace(/</g, "\\u003c");
  return (
    "(function(){try{" +
    'if(location.pathname!=="/dashboard")return;' +
    `var b=document.getElementById(${JSON.stringify(PICTURE_BOX_ID)});if(!b)return;` +
    `var r=localStorage.getItem(${JSON.stringify(PICTURE_KEY)});if(!r)return;` +
    "var p=JSON.parse(r);" +
    `if(p.u!==${user}||!(Date.now()-p.t<${PICTURE_MAX_AGE_MS})||typeof p.h!=="string"||p.vw!==window.innerWidth)return;` +
    'b.style.left=p.x+"px";b.style.top=p.y+"px";b.style.width=p.w+"px";' +
    "b.innerHTML=p.h;" +
    `document.documentElement.setAttribute(${JSON.stringify(PICTURE_SHOWING_ATTR)},"");` +
    // When it went up, for the timing report (lib/powersync/page-timing.ts).
    "window.__bizhPictureAt=performance.now();" +
    "}catch(e){}})();"
  );
}
