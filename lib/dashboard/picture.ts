// The dashboard as it last stood on this device — its finished cards, kept as
// plain HTML — shown the instant the app opens, before any of its code has
// run (components/dashboard/DashboardPicture.tsx). The live board takes over
// as soon as it's drawn. Per person, a week at most, wiped at logout and when
// someone else signs in on this device (like lib/powersync/stored-results.ts).

export const PICTURE_KEY = "bizh-dashboard-picture";
export const PICTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A board bigger than this isn't kept (it would crowd the device's storage). */
const PICTURE_MAX_CHARS = 400_000;

/** Something on the board still loading: a placeholder, or a remembered card waiting for its fresh one. */
export const BOARD_PENDING_SELECTOR = '[data-skeleton], [aria-busy="true"]';

type Picture = { u: string; t: number; h: string };

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
  // Inside the picture's own box the board's pulled-up top margin would land it
  // higher than the live one.
  clone.style.marginTop = "0px";
  return clone.outerHTML;
}

/** Keep the live board as this person's picture. */
export function savePicture(userId: string, board: HTMLElement): void {
  try {
    const html = pictureHtml(board);
    if (html.length > PICTURE_MAX_CHARS) return;
    localStorage.setItem(PICTURE_KEY, JSON.stringify({ u: userId, t: Date.now(), h: html } satisfies Picture));
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

/**
 * The inline script that shows the picture while the page is still being
 * read: runs right after the picture's box (its previous sibling), on a full
 * load of /dashboard only, for this person's own picture under a week old.
 * It marks the box's parent `data-picture-showing`, which hides the live board
 * beneath until DashboardPicture hands over (globals.css).
 */
export function pictureScript(userId: string): string {
  const user = JSON.stringify(userId).replace(/</g, "\\u003c");
  return (
    "(function(){try{" +
    "var s=document.currentScript,b=s&&s.previousElementSibling;" +
    'if(!b||location.pathname!=="/dashboard")return;' +
    `var r=localStorage.getItem(${JSON.stringify(PICTURE_KEY)});if(!r)return;` +
    "var p=JSON.parse(r);" +
    `if(p.u!==${user}||!(Date.now()-p.t<${PICTURE_MAX_AGE_MS})||typeof p.h!=="string")return;` +
    'b.innerHTML=p.h;b.parentElement.setAttribute("data-picture-showing","");' +
    // When it went up, for the timing report (lib/powersync/page-timing.ts).
    "window.__bizhPictureAt=performance.now();" +
    "}catch(e){}})();"
  );
}
