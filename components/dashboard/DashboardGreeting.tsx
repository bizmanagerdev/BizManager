"use client";

import { useSyncExternalStore } from "react";

function greetingForHour(hour: number) {
  if (hour < 12) return "בוקר טוב";
  if (hour < 18) return "צהריים טובים";
  return "ערב טוב";
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
}: {
  name: string;
  initialGreeting: string;
}) {
  const greeting = useSyncExternalStore(
    subscribe,
    () => greetingForHour(new Date().getHours()),
    () => initialGreeting
  );

  return (
    <h1 className="text-xl font-semibold">
      {greeting}
      {name ? `, ${name}` : ""}
    </h1>
  );
}
