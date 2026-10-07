"use client";

import { useEffect, useState } from "react";

/**
 * A promise's value once it has one — the parts of a page the server sends
 * after the page itself (an order's documents, a project's history). Null
 * until the first one arrives, and if it fails. A newer promise for the same
 * page (`key`: a refresh after a save) keeps the last value on screen until
 * it has its own, so those parts don't blank out on every save; another
 * page's value never stands in.
 */
export function useSettled<T>(promise: PromiseLike<T> | null, key: string): T | null {
  const [settled, setSettled] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    if (!promise) return;
    let live = true;
    Promise.resolve(promise).then(
      (value) => {
        if (live) setSettled({ key, value });
      },
      () => {}
    );
    return () => {
      live = false;
    };
  }, [promise, key]);
  return settled && settled.key === key ? settled.value : null;
}
