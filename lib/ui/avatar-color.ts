// Tiny in-memory store for the signed-in user's chosen avatar color.
//
// The top bar shows the user's colored initials avatar. Re-fetching the color on
// every TopBar mount caused a visible flash on each tab switch (hashed fallback →
// real color). This module caches the value for the lifetime of the page session
// so subsequent mounts paint the correct color immediately, and lets the profile
// page push a new choice to the top bar live.
//
// `undefined` = not loaded yet this session, `null` = explicitly "auto" (no choice).

let cached: string | null | undefined;
const listeners = new Set<() => void>();

export function getAvatarColorCache(): string | null | undefined {
  return cached;
}

export function setAvatarColorCache(value: string | null): void {
  cached = value;
  listeners.forEach((listener) => listener());
}

export function subscribeAvatarColor(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
