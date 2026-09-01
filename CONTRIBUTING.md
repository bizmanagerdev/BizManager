# Contributing to BizManager

This is the engineering process for BizManager. The goal is simple: **process stays ahead of features.** Every change is type-checked, linted, and tested before it merges, and the database schema is versioned — so a second engineer can be productive on day one and nothing breaks silently.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript (strict)**
- **Supabase (Postgres)** — auth, RLS, data, storage
- **Tailwind v4 + Radix** — UI
- **Vitest** — tests · **ESLint** — lint
- Hosting: **Vercel** (`fra1`) · DB region: **eu-central-1 (Frankfurt)**

## Getting started

```bash
npm install
cp .env.example .env   # fill in Supabase + OpenAI + Morning keys (ask the owner)
npm run dev
```

Required env (see `.env`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, Morning keys, `CRON_SECRET`, `NEXT_PUBLIC_SENTRY_DSN`.

## The quality gate (must pass before merge)

CI (`.github/workflows/ci.yml`) runs these on every push and PR. Run them locally first:

```bash
npm run typecheck   # tsc --noEmit — zero errors
npm run lint        # eslint — zero errors (warnings allowed, for now)
npm test            # vitest run — all green
```

A red gate blocks the merge. Do not bypass it.

## Database changes — versioned migrations only

> ⚠️ **Policy:** All schema changes go through `supabase/migrations/` (ordered, versioned, tracked). `db/sql/` is **frozen** — CI (`npm run db:check`) fails on any new file there. Full runbook + one-time baseline setup: [`supabase/migrations/README.md`](supabase/migrations/README.md).

```bash
npm run db:new <name>     # create supabase/migrations/<ts>_<name>.sql
# write idempotent SQL, then:
npm run db:push           # apply pending migrations to the linked project
```

Rules:
- Migrations must be **idempotent** (`create ... if not exists`, `drop policy if exists`, etc.).
- Never edit an already-applied migration — add a new one.
- If a change touches an RPC, the migration is the source of truth; the deployed function must match it.
- Never add to `db/sql/` — the freeze is enforced in CI.

## Money code — extra care

The financial layer is being consolidated toward **one source of truth** (`lib/financial/`). Until that's done:
- Any change touching payments / expenses / VAT / balances **must** ship with a Vitest test.
- Refunds are negative-amount payment rows → they are **outflows / contra-revenue**, never income. There are regression tests for this in `__tests__/lib/financial/entries.test.ts`; keep them green.
- Prefer SQL-side aggregation (views/RPCs) over pulling whole tables into Node.

## Component tests

`components/ui/*` (and other render-worthy components) can be tested with jsdom + React
Testing Library, not just their helper functions:

```tsx
// __tests__/components/ui/my-component.test.tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MyComponent } from "@/components/ui/my-component";

it("does the thing", () => {
  render(<MyComponent />);
  expect(screen.getByRole("button", { name: "..." })).toBeInTheDocument();
});
```

- The `// @vitest-environment jsdom` docblock (first line) is required — the suite defaults
  to the lighter `node` environment for lib/api/security tests.
- `__tests__/setup/jsdom.ts` (global `setupFiles`) wires up jest-dom matchers, auto-cleanup
  between tests, and a few jsdom polyfills Radix needs (ResizeObserver, matchMedia, pointer
  capture). Add to it if a new Radix primitive needs another one.
- Prefer `getByRole`/`getByText` assertions on rendered output over snapshotting className
  strings, except where the class IS the contract (e.g. the outline-only styling on
  `EditButton`/`DeleteButton` — see `__tests__/components/ui/icon-button.test.tsx`).
- **Radix Popover/Select-based components** (anything built on `@radix-ui/react-popper` /
  floating-ui — `SearchableSelect` is the example) pay a one-off ~15-20s cost the first time
  a test in the file actually opens the popover, from transforming floating-ui's dependency
  graph — not a per-test cost, but real. `__tests__/components/ui/searchable-select.test.tsx`
  deliberately tests only the closed-state trigger-label contract for this reason; Radix
  `Dialog`-based components (no floating-ui) don't have this cost — see
  `confirm-dialog.test.tsx` for full open-interaction coverage.

## Code style

- **Keep components small.** New UI should be composed of focused components; do not grow the existing 2,000–5,000-line `*Client.tsx` files. When you touch one, leave it smaller than you found it where practical.
- Business logic lives in `lib/`, not in components.
- All user-facing text is **Hebrew**; map server errors via `toHebrewError`. Never surface raw English.
- Use the shared UI primitives (`components/ui/*`) — `CurrencyInput`, `SearchableSelect`, `ConfirmDialog`, etc.

## Icons — one palette, no exceptions

All icons come from **`components/ui/icons.ts`**, imported by meaning:

```ts
import { EditIcon, DeleteIcon, WazeIcon } from "@/components/ui/icons";
```

- **Never import `lucide-react` directly.** ESLint fails the build if you do; the palette is the only door.
- One meaning = one glyph. Before adding an entry, check the palette — it carries a
  deliberate reserve for features not built yet, so the icon you need is usually there.
- Every glyph is a lucide outline icon (24×24, 2px stroke) so they read as one set.
  The single exception is a **brand mark**: `WazeIcon` is the real Waze logo, kept
  because navigation in this app *is* Waze — never swap it for a generic arrow or compass.
- **Edit is a pencil with no text, everywhere.** Use `EditButton` from
  `components/ui/icon-button.tsx`; its `label` sets the tooltip and `aria-label`, never
  visible text. `DeleteButton` is its counterpart, and `IconButton` covers the rest.

## Where things live

| Area | Path |
|------|------|
| Pages / routes | `app/(app)/**` |
| API handlers | `app/api/**/route.ts` |
| Domain logic | `lib/**` (financial engine in `lib/financial/`) |
| UI primitives | `components/ui/**` |
| Tests | `__tests__/**` |
| Migrations | `supabase/migrations/**` (legacy: `db/sql/**`) |
