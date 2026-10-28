import { test, expect, type Page } from "@playwright/test";
import { loginAs, type E2ERole } from "./fixtures";
import {
  createTestWorker,
  deleteTestWorker,
  createTestTask,
  deleteTestTask,
  createTestTaskComment,
  createTestAttendanceReport,
  deleteTestAttendanceReports,
  createTestAttendanceSession,
  deleteTestAttendanceSession,
  getAdminUserId,
  type TestWorker,
} from "./db";

// Nobody who reads Hebrew ever sees Arabic (owner, 2026-10-28) — admin, office,
// and every worker saved with locale "he". Only a worker saved with "ar" gets
// Arabic (and may still see Hebrew).
//
// __tests__/guards/no-arabic-for-hebrew-readers.test.ts checks the app's own
// text in the code. This checks the screen, with what a worker writing in
// Arabic leaves in the data: a task, a comment on it, a shift and a phone report
// with notes. The app saves a Hebrew copy beside each (subject_he, body_he,
// notes_he); a Hebrew reader must get the copy, never the original.
//
// Every page each Hebrew reader can open is read whole — text, placeholders,
// tooltips, accessible names and the tab title — including parts hidden at this
// width (the phone menu on a computer, and so on). Scripts are not read: the
// page's data may carry the original, as long as it isn't shown.

// Arabic, Arabic Supplement, Arabic Extended-A, Presentation Forms A and B (to
// U+FEFC — U+FEFF is the byte-order mark). Same as the code check.
const ARABIC = "[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFC]";

const RUN = Date.now().toString(36);
const WRITTEN = {
  subject: `تركيب المطبخ عند العميل ${RUN}`,
  subjectHe: `התקנת המטבח אצל הלקוח ${RUN}`,
  description: "يجب إحضار البراغي والمفك",
  descriptionHe: "צריך להביא ברגים ומברג",
  comment: "انتهيت من الخزائن العلوية",
  commentHe: "סיימתי את הארונות העליונים",
  shiftNotes: "عملت في بيت الكنيسة",
  shiftNotesHe: "עבדתי בבית הכנסת",
  reportNotes: "نقل الأثاث إلى المخزن",
  reportNotesHe: "העברת רהיטים למחסן",
};

// Every page in the menu (components/layout/nav-items.tsx) and the account pages.
const STAFF_ROUTES = [
  "/dashboard",
  "/calendar",
  "/projects",
  "/tasks",
  "/sales",
  "/customers",
  "/communications",
  "/properties",
  "/vehicles",
  "/deliveries",
  "/financial",
  "/collections",
  "/financial/payments-calendar",
  "/financial/reports",
  "/financial/bank",
  "/financial/taxes",
  "/checks",
  "/financial/loans",
  "/financial/statements",
  "/payroll",
  "/payroll/attendance",
  "/documents",
  "/activity",
  "/settings",
  "/inbox",
  "/notifications",
  "/profile",
];

const WORKER_ROUTES = ["/dashboard", "/tasks", "/calendar", "/deliveries", "/vehicles", "/inbox", "/notifications", "/profile"];

/** Every piece of Arabic a reader of `page` could get, as it is now. */
async function arabicOnPage(page: Page): Promise<string[]> {
  return page.evaluate((source) => {
    const arabic = new RegExp(source);
    const found = new Set<string>();
    const add = (where: string, text: string | null | undefined) => {
      if (text && arabic.test(text)) found.add(`${where}: ${text.trim().slice(0, 120)}`);
    };
    add("title", document.title);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("script,style,noscript,template")) continue;
      add("text", node.textContent);
    }
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      for (const attr of ["placeholder", "title", "aria-label", "aria-description", "alt"]) add(attr, el.getAttribute(attr));
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) add("field", el.value);
    }
    return [...found];
  }, ARABIC);
}

/** Opens each route and lists what Arabic it shows. */
async function sweep(page: Page, routes: readonly string[]): Promise<string[]> {
  const leaks: string[] = [];
  for (const route of routes) {
    await page.goto(route);
    await page.waitForLoadState("load");
    // Cards that load after the page (dashboard, payroll) — capped, since a page
    // that checks for news every minute is never fully quiet.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    for (const found of await arabicOnPage(page)) leaks.push(`${route} → ${found}`);
  }
  return leaks;
}

test.describe("no Arabic for a Hebrew reader", () => {
  // One worker writing in Arabic for the whole file; the reads below change nothing.
  test.describe.configure({ mode: "serial" });

  let arabicWorker: TestWorker;
  let taskId: string;
  let sessionId: string;
  let reportId: string;

  test.beforeAll(async () => {
    arabicWorker = await createTestWorker({ locale: "ar", payrollWorkerType: "session_only" });
    const task = await createTestTask({
      subject: WRITTEN.subject,
      subjectHe: WRITTEN.subjectHe,
      description: WRITTEN.description,
      descriptionHe: WRITTEN.descriptionHe,
      assignedUserId: await getAdminUserId(),
    });
    taskId = task.id;
    await createTestTaskComment(taskId, arabicWorker.id, WRITTEN.comment, WRITTEN.commentHe);
    sessionId = (
      await createTestAttendanceSession(arabicWorker.id, { notes: WRITTEN.shiftNotes, notesHe: WRITTEN.shiftNotesHe })
    ).id;
    reportId = (
      await createTestAttendanceReport(arabicWorker.id, { notes: WRITTEN.reportNotes, notesHe: WRITTEN.reportNotesHe })
    ).id;
  });

  test.afterAll(async () => {
    if (taskId) await deleteTestTask(taskId);
    if (sessionId) await deleteTestAttendanceSession(sessionId);
    if (arabicWorker) {
      await deleteTestAttendanceReports(arabicWorker.id);
      await deleteTestWorker(arabicWorker);
    }
  });

  test("admin: the Arabic worker's writing shows in Hebrew", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, "admin");

    // The data reached the screen — otherwise the sweep below proves nothing.
    await expect(page.getByRole("listitem").filter({ hasText: WRITTEN.subjectHe })).toBeVisible();
    const leaks = await sweep(page, ["/dashboard"]);

    await page.goto("/payroll/attendance");
    await expect(page.locator(`[data-focus-id="${reportId}"]`)).toBeVisible();
    leaks.push(...(await sweep(page, ["/payroll/attendance"])));

    await page.goto(`/tasks?task=${taskId}`);
    await expect(page.getByText(WRITTEN.subjectHe).first()).toBeVisible();
    leaks.push(
      ...(await sweep(page, [
        `/tasks?task=${taskId}`,
        `/payroll/workers/${arabicWorker.id}`,
        // The task (its title ends with RUN in both languages) and the worker's shifts.
        `/search?q=${RUN}`,
        `/search?q=${encodeURIComponent(arabicWorker.fullName)}`,
      ]))
    );

    expect(leaks).toEqual([]);
  });

  const everyPage: { role: E2ERole; routes: readonly string[] }[] = [
    { role: "admin", routes: STAFF_ROUTES },
    { role: "office", routes: STAFF_ROUTES },
    { role: "worker", routes: WORKER_ROUTES },
  ];
  for (const { role, routes } of everyPage) {
    test(`${role}: no page shows Arabic`, async ({ page }) => {
      test.setTimeout(routes.length * 15_000);
      await loginAs(page, role);
      expect(await sweep(page, routes)).toEqual([]);
    });
  }
});
