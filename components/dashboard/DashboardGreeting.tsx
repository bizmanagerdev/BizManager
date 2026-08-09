"use client";

import { useSyncExternalStore } from "react";

function greetingForHour(hour: number) {
  if (hour < 12) return "בוקר טוב";
  if (hour < 18) return "צהריים טובים";
  return "ערב טוב";
}

// "יום שלישי · 21 ביולי 2026"
function formatToday(date: Date) {
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(date);
  const rest = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric" }).format(date);
  return `${weekday} · ${rest}`;
}

// No reactive source — the greeting is read once per render from the local clock.
const subscribe = () => () => {};

/**
 * Time-of-day greeting computed on the client from the viewer's own clock, so it
 * can never get "stuck" on a stale server-rendered value (e.g. בוקר טוב all
 * afternoon). `useSyncExternalStore` returns the server snapshot (`initialGreeting`)
 * during SSR/hydration and the client-computed value afterwards — no hydration
 * mismatch and no setState-in-effect.
 */
export default function DashboardGreeting({
  name,
  initialGreeting,
  initialDate,
}: {
  name: string;
  initialGreeting: string;
  initialDate?: string;
}) {
  const greeting = useSyncExternalStore(
    subscribe,
    () => greetingForHour(new Date().getHours()),
    () => initialGreeting
  );

  // Full Hebrew date, read from the same client clock as the greeting (server
  // snapshot keeps SSR and hydration identical).
  const today = useSyncExternalStore(subscribe, () => formatToday(new Date()), () => initialDate ?? "");

  return (
    // Phones get a smaller heading that WRAPS (never truncates — a cut-off name
    // like "ערב ט…" is worse than two lines), and only the date; the "here's
    // what's happening" tail is desktop-only so the subline stays one clean row.
    <div className="min-w-0">
      <h1 className="text-xl font-bold leading-snug tracking-tight sm:text-2xl md:text-3xl">
        {greeting}
        {name ? `, ${name}` : ""}
      </h1>
      {today ? (
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
          {today}
          <span className="hidden sm:inline"> · הנה מה שקורה היום</span>
        </p>
      ) : null}
    </div>
  );
}
