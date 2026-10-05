"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { markConnectionCheckDone } from "@/lib/connection-check";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// TEMPORARY (2026-10-05). What this phone's network — and its filter (NetFree,
// Hadran, Rimon…) — lets the app do, checked before the app's data moves onto
// the device: a sync engine needs a connection that stays open, maybe a new
// web address, storage on the device, and background workers. Each check runs
// in turn and says plainly what it found; when the run ends the results go to
// our server on their own (admins read them on /connection-check/results),
// with copy-as-text as the fallback. Remove with the menu link and the
// dashboard card once the results are in.

type Status = "waiting" | "running" | "pass" | "warn" | "fail" | "info";
type Result = { status: Status; detail: string };
type Check = { id: string; label: string; run: () => Promise<Result> };

const STATUS_MARK: Record<Status, string> = {
  waiting: "⏳",
  running: "🔄",
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
  info: "ℹ️",
};

function ms(since: number) {
  return Math.round(performance.now() - since);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`לא הגיבו תוך ${Math.round(timeoutMs / 1000)} שניות`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** How the app is open: the Android app, the installed web app, or a browser. */
function openedIn(): string {
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return capacitor?.isNativePlatform?.()
    ? "אפליקציית אנדרואיד"
    : window.matchMedia("(display-mode: standalone)").matches
      ? "אפליקציה מותקנת (PWA)"
      : "דפדפן";
}

function whereOpen(): Result {
  return { status: "info", detail: `${openedIn()} · ${navigator.userAgent}` };
}

async function ourSite(): Promise<Result> {
  const started = performance.now();
  const response = await withTimeout(fetch("/api/connection-check/stream?lines=0", { cache: "no-store" }), 10_000);
  const text = await response.text();
  if (!response.ok || !text.startsWith("start")) return { status: "fail", detail: `תשובה לא תקינה (${response.status})` };
  return { status: "pass", detail: `${ms(started)} ms` };
}

async function database(): Promise<Result> {
  const started = performance.now();
  const response = await withTimeout(
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
      cache: "no-store",
    }),
    10_000
  );
  if (!response.ok) return { status: "fail", detail: `תשובה לא תקינה (${response.status})` };
  return { status: "pass", detail: `${ms(started)} ms` };
}

/** The live connection the app already uses (notifications): join, send, hear it back. */
function liveConnection(): Promise<Result> {
  const supabase = createSupabaseBrowserClient();
  const started = performance.now();
  return new Promise((resolve) => {
    let done = false;
    let joinedAfter = 0;
    const channel = supabase.channel(`connection-check-${Math.random().toString(36).slice(2)}`, {
      config: { broadcast: { self: true } },
    });
    const finish = (result: Result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void supabase.removeChannel(channel);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "fail", detail: "לא התחבר תוך 10 שניות" }), 10_000);
    channel
      .on("broadcast", { event: "ping" }, () =>
        finish({ status: "pass", detail: `התחבר תוך ${joinedAfter} ms, הודעה חזרה תוך ${ms(started)} ms` })
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          joinedAfter = ms(started);
          void channel.send({ type: "broadcast", event: "ping", payload: {} });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          finish({ status: "fail", detail: `החיבור נכשל (${status})` });
        }
      });
  });
}

/** One response that keeps sending for 8 seconds: does each line arrive as it's sent? */
async function openStream(): Promise<Result> {
  const started = performance.now();
  const response = await withTimeout(fetch("/api/connection-check/stream?lines=8", { cache: "no-store" }), 25_000);
  if (!response.ok || !response.body) return { status: "fail", detail: `תשובה לא תקינה (${response.status})` };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const arrivals: number[] = [];
  let buffer = "";
  const read = async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.startsWith("line")) arrivals.push(ms(started));
    }
  };
  await withTimeout(read(), 25_000);
  if (arrivals.length === 0) return { status: "fail", detail: "לא הגיע מידע" };
  const first = arrivals[0];
  const last = arrivals[arrivals.length - 1];
  const spread = `השורה הראשונה אחרי ${(first / 1000).toFixed(1)} שנ', האחרונה אחרי ${(last / 1000).toFixed(1)} שנ'`;
  // Sent one a second: arriving one a second means it streams; arriving all
  // together at the end means something on the way held the response back.
  if (last - first >= 4_000) return { status: "pass", detail: `מגיע בזמן אמת · ${spread}` };
  return { status: "warn", detail: `המידע מוחזק בדרך ומגיע רק בסוף · ${spread}` };
}

/** A web address the app has never used, over a normal request. */
async function newAddress(): Promise<Result> {
  const started = performance.now();
  const response = await withTimeout(fetch("https://httpbin.org/get?from=bizh", { cache: "no-store" }), 10_000);
  const body = (await response.json().catch(() => null)) as { url?: string } | null;
  if (!response.ok || !body?.url?.includes("httpbin.org")) {
    return { status: "fail", detail: `חסום או מוחלף בדף אחר (${response.status})` };
  }
  return { status: "pass", detail: `${ms(started)} ms` };
}

/** A live connection to a web address the app has never used. */
function newAddressLive(): Promise<Result> {
  const started = performance.now();
  return new Promise((resolve) => {
    let done = false;
    let socket: WebSocket | null = null;
    const finish = (result: Result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // already closed
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "fail", detail: "לא התחבר תוך 10 שניות" }), 10_000);
    try {
      socket = new WebSocket("wss://echo.websocket.org");
    } catch (error) {
      finish({ status: "fail", detail: errorText(error) });
      return;
    }
    socket.onopen = () => socket?.send("bizh-check");
    socket.onmessage = (event) => {
      if (event.data === "bizh-check") finish({ status: "pass", detail: `הודעה חזרה תוך ${ms(started)} ms` });
    };
    socket.onerror = () => finish({ status: "fail", detail: "החיבור נחסם או נכשל" });
    socket.onclose = () => finish({ status: "fail", detail: "החיבור נסגר לפני תשובה" });
  });
}

/** Whether an image at `url` really loads — a filter's "blocked" page isn't one. */
function imageLoads(url: string, timeoutMs = 8_000): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.src = "";
      resolve(false);
    }, timeoutMs);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image.naturalWidth > 0);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    image.src = `${url}?bizh=${Date.now()}`;
  });
}

/**
 * PowerSync's own addresses, no account needed: each customer's sync address
 * is <id>.powersync.journeyapps.com, so the phone has to reach journeyapps.com
 * (its icon loads), and PowerSync's dashboard (its icon loads). The customer
 * address itself can't be checked without an account — filters normally allow
 * or block a whole address family, so journeyapps.com is the telling one.
 */
async function powerSyncAddress(): Promise<Result> {
  const started = performance.now();
  const [journeyApps, dashboard] = await Promise.all([
    imageLoads("https://journeyapps.com/favicon.ico"),
    imageLoads("https://dashboard.powersync.com/favicon.ico"),
  ]);
  const detail = `journeyapps.com ${journeyApps ? "✓" : "✗"} · dashboard.powersync.com ${dashboard ? "✓" : "✗"} · ${ms(started)} ms`;
  const status: Status = journeyApps && dashboard ? "pass" : journeyApps || dashboard ? "warn" : "fail";
  return { status, detail };
}

// The PowerSync instance (the dev one, 2026-10-05) and the throwaway table it
// syncs — powersync_probe, admins only, the only table PowerSync can read.
const POWERSYNC_URL = "https://6ac3ebc2f0708554f16bfb92.powersync.journeyapps.com";

// What the sync connection hands back, a piece at a time (null: it closed).
type SyncConnection = { read: () => Promise<string | null> };

function syncRequest() {
  return {
    buckets: [],
    include_checksum: true,
    raw_data: true,
    client_id: `bizh-check-${Math.random().toString(36).slice(2)}`,
    streams: { include_defaults: true, subscriptions: [] },
  };
}

/** PowerSync's default on the web: one long HTTP answer that keeps streaming. */
async function openHttpSync(token: string, signal: AbortSignal): Promise<SyncConnection> {
  const response = await fetch(`${POWERSYNC_URL}/sync/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
    body: JSON.stringify(syncRequest()),
    signal,
    cache: "no-store",
  });
  if (response.status === 401) throw new Error("PowerSync לא קיבל את הכניסה (Client Auth)");
  if (!response.ok || !response.body) throw new Error(`תשובה לא תקינה (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  return {
    read: async () => {
      const { done, value } = await reader.read();
      return done ? null : decoder.decode(value, { stream: true });
    },
  };
}

/**
 * The other way PowerSync can sync: a WebSocket, opened by PowerSync's own
 * library exactly as the app would (each message is a binary record, but the
 * names and the row ids inside it are plain text).
 */
async function openWebSocketSync(token: string, signal: AbortSignal): Promise<SyncConnection> {
  const { WebRemote, FetchStrategy } = await import("@powersync/web");
  const remote = new WebRemote(
    { fetchCredentials: async () => ({ endpoint: POWERSYNC_URL, token }) },
    { log: () => {} }
  );
  const stream = await remote.socketStreamRaw({
    path: "/sync/stream",
    fetchStrategy: FetchStrategy.Sequential,
    abortSignal: signal,
    data: syncRequest(),
  });
  const decoder = new TextDecoder();
  return {
    read: async () => {
      const { done, value } = await stream.next();
      return done ? null : decoder.decode(value);
    },
  };
}

/**
 * The real thing, end to end, the way the app would sync: open PowerSync's
 * sync connection as the signed-in person, wait for its first full answer, add
 * one row to the test table through our database, and time how long that row
 * takes to come back down the open connection. Then the row is removed.
 */
async function powerSyncProbe(open: (token: string, signal: AbortSignal) => Promise<SyncConnection>): Promise<Result> {
  const supabase = createSupabaseBrowserClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { status: "fail", detail: "אין חיבור משתמש" };

  const started = performance.now();
  const controller = new AbortController();
  let probeId: string | null = null;
  try {
    const connection = await withTimeout(open(token, controller.signal), 15_000);
    // Read until `text` turns up, or the time runs out. The tail of what came
    // before is kept, so a word split between two pieces still counts.
    let seen = "";
    const readUntil = (text: string, timeoutMs: number) =>
      withTimeout(
        (async () => {
          for (;;) {
            const piece = await connection.read();
            if (piece === null) throw new Error("PowerSync סגר את החיבור");
            seen = (seen + piece).slice(-(piece.length + 200));
            if (seen.includes(text)) return;
          }
        })(),
        timeoutMs
      );

    await readUntil("checkpoint_complete", 15_000);
    const connectedAfter = ms(started);

    const { data: inserted, error } = await supabase
      .from("powersync_probe")
      .insert({ note: "connection check" })
      .select("id")
      .single();
    if (error || !inserted) {
      return { status: "warn", detail: `התחבר תוך ${connectedAfter} ms, אבל לא ניתן היה להוסיף שורת בדיקה (${error?.message ?? "?"})` };
    }
    probeId = (inserted as { id: string }).id;
    const insertedAt = performance.now();
    try {
      await readUntil(probeId, 20_000);
    } catch {
      return {
        status: "warn",
        detail: `התחבר תוך ${connectedAfter} ms, אבל השורה החדשה לא הגיעה דרך PowerSync תוך 20 שנ' (מוחזק בדרך?)`,
      };
    }
    return {
      status: "pass",
      detail: `התחבר תוך ${connectedAfter} ms · שורה חדשה הגיעה דרך PowerSync תוך ${ms(insertedAt)} ms`,
    };
  } finally {
    controller.abort();
    if (probeId) void supabase.from("powersync_probe").delete().eq("id", probeId);
  }
}

/** Store something on the device, read it back, and say how much room there is. */
async function deviceStorage(): Promise<Result> {
  const name = "biz_connection_check";
  const db = await withTimeout(
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("לא ניתן לפתוח אחסון"));
    }),
    10_000
  );
  const value = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put("ok", "check");
    const get = tx.objectStore("kv").get("check");
    tx.oncomplete = () => resolve(get.result);
    tx.onerror = () => reject(tx.error ?? new Error("שמירה נכשלה"));
  });
  db.close();
  indexedDB.deleteDatabase(name);
  if (value !== "ok") return { status: "fail", detail: "המידע לא נשמר" };
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const room = estimate?.quota ? `כ-${Math.round(estimate.quota / 1024 / 1024)} MB פנויים לאפליקציה` : "גודל לא ידוע";
  return { status: "pass", detail: `${room}${persisted ? " · שמור לצמיתות" : ""}` };
}

/** A background worker — where a database on the device runs. */
function backgroundWorker(): Promise<Result> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker("/connection-check-worker.js");
    } catch (error) {
      resolve({ status: "fail", detail: errorText(error) });
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ status: "fail", detail: "לא ענה תוך 5 שניות" });
    }, 5_000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(
        (event.data as { echo?: string })?.echo === "ping"
          ? { status: "pass", detail: "עובד" }
          : { status: "fail", detail: "תשובה לא צפויה" }
      );
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ status: "fail", detail: "נחסם" });
    };
    worker.postMessage("ping");
  });
}

// (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const ADD_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, 0x03, 0x02,
  0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20,
  0x01, 0x6a, 0x0b,
]);

/** WebAssembly — what a database on the device is built with. */
async function webAssembly(): Promise<Result> {
  if (typeof WebAssembly === "undefined") return { status: "fail", detail: "לא נתמך" };
  const { instance } = await WebAssembly.instantiate(ADD_WASM);
  const add = instance.exports.add as (a: number, b: number) => number;
  return add(2, 3) === 5 ? { status: "pass", detail: "עובד" } : { status: "fail", detail: "תוצאה שגויה" };
}

/** The file storage a device database prefers (it can fall back to the storage above). */
async function fileStorage(): Promise<Result> {
  const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<unknown> };
  if (typeof storage?.getDirectory !== "function") return { status: "warn", detail: "לא נתמך — יעבוד עם האחסון הרגיל" };
  await withTimeout(storage.getDirectory(), 5_000);
  return { status: "pass", detail: "נתמך" };
}

const CHECKS: Check[] = [
  { id: "where", label: "איפה האפליקציה פתוחה", run: async () => whereOpen() },
  { id: "site", label: "האתר שלנו (biz-h.com)", run: ourSite },
  { id: "db", label: "מסד הנתונים (Supabase)", run: database },
  { id: "live", label: "חיבור חי שהאפליקציה כבר משתמשת בו (התראות)", run: liveConnection },
  { id: "stream", label: "חיבור שנשאר פתוח ושולח מידע לאורך זמן", run: openStream },
  { id: "new", label: "כתובת אינטרנט חדשה", run: newAddress },
  { id: "newLive", label: "חיבור חי לכתובת חדשה", run: newAddressLive },
  { id: "powersync", label: "הכתובת של PowerSync", run: powerSyncAddress },
  { id: "powersyncLive", label: "PowerSync — סנכרון אמיתי (חיבור רגיל)", run: () => powerSyncProbe(openHttpSync) },
  { id: "powersyncSocket", label: "PowerSync — סנכרון אמיתי בחיבור חי (WebSocket)", run: () => powerSyncProbe(openWebSocketSync) },
  { id: "storage", label: "שמירת מידע על המכשיר", run: deviceStorage },
  { id: "worker", label: "עבודה ברקע (Worker)", run: backgroundWorker },
  { id: "wasm", label: "WebAssembly", run: webAssembly },
  { id: "files", label: "אחסון קבצים מהיר (OPFS)", run: fileStorage },
];

function initialResults(): Record<string, Result> {
  return Object.fromEntries(CHECKS.map((check) => [check.id, { status: "waiting", detail: "" } as Result]));
}

function buildReport(userName: string, results: Record<string, Result>) {
  return [
    `בדיקת חיבור BizH — ${userName} — ${new Date().toLocaleString("he-IL")}`,
    ...CHECKS.map((check) => {
      const result = results[check.id];
      return `${STATUS_MARK[result.status]} ${check.label}: ${result.detail}`;
    }),
  ].join("\n");
}

const TEXT = {
  he: {
    title: "בדיקת חיבור",
    intro: "הבדיקה לוקחת כחצי דקה. נא להמתין עד שהיא מסתיימת.",
    sending: "מסיים…",
    sent: "✅ הבדיקה הסתיימה. תודה!",
    failed: "הבדיקה הסתיימה, אבל התוצאות לא נשמרו.",
  },
  ar: {
    title: "فحص الاتصال",
    intro: "يستغرق الفحص نصف دقيقة تقريباً. الرجاء الانتظار حتى ينتهي.",
    sending: "جارٍ الإنهاء…",
    sent: "✅ انتهى الفحص. شكراً!",
    failed: "انتهى الفحص، لكن لم يتم حفظ النتائج.",
  },
} as const;

type SendState = "idle" | "sending" | "sent" | "failed";

export default function ConnectionCheckClient({
  userName,
  locale,
  isAdmin,
}: {
  userName: string;
  locale: "he" | "ar";
  isAdmin: boolean;
}) {
  const text = TEXT[locale];
  useSetPageTitle(text.title);
  const [results, setResults] = useState<Record<string, Result>>(initialResults);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendState, setSendState] = useState<SendState>("idle");
  const runId = useRef(0);

  // A new run supersedes the one before it (the "בדיקה מחדש" button).
  const runAll = useCallback(async () => {
    const id = ++runId.current;
    const isCurrent = () => runId.current === id;
    setRunning(true);
    setCopied(false);
    setSendState("idle");
    setResults(initialResults());
    const collected: Record<string, Result> = {};
    // One at a time, so one check's traffic doesn't slow another's timing.
    for (const check of CHECKS) {
      if (!isCurrent()) return;
      setResults((prev) => ({ ...prev, [check.id]: { status: "running", detail: "" } }));
      let result: Result;
      try {
        result = await check.run();
      } catch (error) {
        result = { status: "fail", detail: errorText(error) };
      }
      if (!isCurrent()) return;
      collected[check.id] = result;
      setResults((prev) => ({ ...prev, [check.id]: result }));
    }
    setRunning(false);
    // Done on this device: the dashboard stops asking. Then the results go to
    // our server on their own — nobody has to copy or send anything.
    markConnectionCheckDone();
    setSendState("sending");
    try {
      const response = await fetch("/api/connection-check/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          openedIn: openedIn(),
          userAgent: navigator.userAgent,
          results: collected,
          report: buildReport(userName, collected),
        }),
      });
      if (isCurrent()) setSendState(response.ok ? "sent" : "failed");
    } catch {
      if (isCurrent()) setSendState("failed");
    }
  }, [userName]);

  // Starts on its own once the page is up — nothing to press first.
  useEffect(() => {
    const timer = setTimeout(() => void runAll(), 0);
    return () => clearTimeout(timer);
  }, [runAll]);

  const reportText = () => buildReport(userName, results);

  const copyReport = async () => {
    const report = reportText();
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      // Some app shells refuse the clipboard API — fall back to selecting a
      // text box the user can copy from by hand.
      const box = document.getElementById("connection-check-report") as HTMLTextAreaElement | null;
      box?.select();
      document.execCommand("copy");
      setCopied(true);
    }
  };

  // Copying is only the fallback for when the results couldn't be saved.
  const showCopy = !running && sendState === "failed";

  return (
    <div className="mx-auto max-w-2xl space-y-3" dir={locale === "ar" ? "rtl" : undefined}>
      <p className="text-sm text-muted-foreground">{text.intro}</p>
      {sendState !== "idle" ? (
        <div
          className={
            sendState === "failed"
              ? "rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium"
              : sendState === "sent"
                ? "rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm font-medium"
                : "rounded-xl border px-4 py-3 text-sm text-muted-foreground"
          }
        >
          {sendState === "sending" ? text.sending : sendState === "sent" ? text.sent : text.failed}
        </div>
      ) : null}
      <Card>
        <CardContent className="divide-y divide-border/60 p-0">
          {CHECKS.map((check) => {
            const result = results[check.id];
            return (
              <div key={check.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 shrink-0 text-lg leading-none" aria-hidden>
                  {STATUS_MARK[result.status]}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium" dir="rtl">
                    {check.label}
                  </div>
                  {result.detail ? (
                    <div className="break-words text-xs text-muted-foreground" dir="auto">
                      {result.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-2">
        {showCopy ? (
          <Button type="button" onClick={() => void copyReport()}>
            {copied ? "הועתק ✓" : "העתקת התוצאות"}
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={() => void runAll()} disabled={running}>
          בדיקה מחדש
        </Button>
        {isAdmin ? (
          <Button asChild variant="outline">
            <Link href="/connection-check/results">תוצאות כל המשתמשים</Link>
          </Button>
        ) : null}
      </div>
      {/* The same text, for copying by hand where the clipboard is blocked. */}
      {showCopy ? (
        <textarea
          id="connection-check-report"
          readOnly
          value={reportText()}
          className="h-40 w-full rounded-md border bg-muted/30 p-2 text-xs"
          dir="rtl"
        />
      ) : null}
    </div>
  );
}
