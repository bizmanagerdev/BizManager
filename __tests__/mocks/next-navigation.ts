import { vi } from "vitest";

// next/navigation's App Router hooks (useRouter/usePathname/useSearchParams)
// throw "invariant expected app router to be mounted" outside a real Next.js
// router context — which a component test never has. Only useRouter actually
// throws in practice (usePathname/next/link degrade gracefully on their own);
// this covers the one that doesn't.
//
// Usage — call at the top of a test file, before any import of the component
// under test:
//   vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
export const push = vi.fn();
export const replace = vi.fn();
export const refresh = vi.fn();
export const back = vi.fn();
export const forward = vi.fn();
export const prefetch = vi.fn();

export function useRouter() {
  return { push, replace, refresh, back, forward, prefetch };
}

export function usePathname() {
  return "/";
}

export function useSearchParams() {
  return new URLSearchParams();
}
