# E2E tests (Playwright)

These run against a **fully local** stack — Next dev + a local Supabase
(Postgres/Auth/API) started via Docker — never against the real business
database. That's deliberate: a Playwright test drives a real browser through
the real app, which means real writes (creating an order, logging in, etc.),
and this business has no separate staging Supabase project. Pointing these
at production would create fake orders/customers/payments that real staff
would see and that would pollute real financial reports.

## What's covered

Keep this list in step with the specs: add a line when you add a test, and
move an area out of "Not covered" when it gets one. Unit tests (single
functions/components, Vitest) live separately in `__tests__/`.

**Money**
- `admin-expenses` — record a one-time paid cash expense; it shows on /financial
- `admin-income` — record a one-time cash income; it shows on /financial
- `admin-account` — create a bank account
- `admin-account-transfer` — withdraw from bank to cash
- `admin-loans` — create a loan; record a repayment
- `admin-checks` — mark a pending check as cleared (through the deposit dialog)
- `admin-collections` — add a collection reminder for a debtor
- `admin-payments-calendar` — mark an unpaid expense as paid from צפי תזרים
- `admin-recurring-expense` — create a recurring expense template (step wizard)
- `admin-recurring-expense-edit` — edit an existing template's name
- `admin-cc-statement-create-expenses` — turn a staged card-statement row into a real expense
- `admin-backup` — download a full Excel backup
- `admin-settings` — change the VAT rate

**Customers / CRM**
- `admin-customer-create` — create a customer through the full wizard
- `admin-customer-edit` — edit a customer's notes; the change persists
- `admin-customer-branch` — add a branch to a customer
- `admin-customer-tags` — create a tag and attach it to a customer
- `admin-customer-ranking-tag-filter` — filter the reports' לקוחות tab by a tag
- `admin-global-search` — find a customer via global search and open it

**Sales, projects & properties**
- `admin-orders` — create an order (free-text line); collect a full and a partial payment
- `admin-projects` — create a project; change its status inline; add an expense
- `admin-properties` — create a property; add an expense to it
- `admin-property-lease` — add a lease (tenant) to a property
- `admin-vehicle-create` — create a vehicle via the + menu on /vehicles
- `admin-documents` — upload a document (CI enables storage for this one)

**Payroll & attendance**
- `admin-payroll-approval` — approve a pending phone report into a real session
- `admin-worker-debt-payoff` — pay off a worker's open session debt
- `worker-attendance` — a worker opens a shift and submits it for approval
- `worker-attendance-colleague` — a worker signs in a colleague / logs a colleague's full shift; can't target an admin or a non-session worker

**Dashboard**
- `admin-dashboard-today-schedule` — mark a reminder done from the היום card
- `admin-dashboard-today-alerts` — a check due for deposit shows as an alert
- `admin-dashboard-tasks` — mark a task done from the card
- `admin-dashboard-payments` — today's payment row opens /financial on that entry
- `admin-dashboard-collections` — a debtor row opens the customer
- `admin-dashboard-deliveries` — a delivery row opens the queue on that order
- `admin-dashboard-attendance-queue` — a report opens focused on the queue page
- `admin-dashboard-properties` — a vacant property row opens its page
- `admin-dashboard-domain-chart` — switching the chart's month loads without error
- `admin-dashboard-activity-digest` — a missed customer creation shows; the digest dismisses

**Tasks, calendar, inbox**
- `admin-tasks` — create a task; move it between columns; add a comment
- `task-board` — quick-add a task from the board
- `admin-calendar` — add a reminder from a day's context menu
- `admin-inbox` — snooze a reminder until tomorrow

**Workers (role scoping)**
- `worker-access` — section access on/off hides nav items and blocks routes; worker_no_access always lands on /no-access
- `worker-tasks` — tasks are self-assigned; a worker sees only his own and can't see others' private ones
- `worker-deliveries` — confirm delivery with full/partial payment; checks stay pending; access is enforced by the API
- `worker-quick-create` — exactly the 3 worker tiles; reminders are self-assigned
- `worker-task-attachments` — sees an attachment on his own task, no delete
- `worker-vehicles` — with access: open a vehicle, see its expenses/documents, log mileage

**Access, security & smoke**
- `login` — sign in; works before JS loads; `?email=` prefill; wrong password shows a Hebrew error
- `role-access` — a worker is kept out of /financial
- `rpc-role-guards` — database functions refuse anonymous and under-privileged callers
- `nav-smoke` — every main page loads without crashing
- `no-arabic-for-hebrew-readers` — with a task, comment and shift notes written in Arabic in the data, no page shows admin, office or a Hebrew worker any Arabic (the code-side twin is `__tests__/guards/no-arabic-for-hebrew-readers.test.ts`)
- `detail-pages` — customer/project/order/property/vehicle detail pages render

**Phone / Android app** (`mobile-*.spec.ts`, run in the `mobile` project)
- `mobile-nav` — admin's bottom bar tabs navigate; עוד sheet reaches other pages; a worker's bar and עוד hold only worker pages
- `mobile-quick-create` — a worker adds a reminder through the + and its full-screen wizard
- `mobile-worker-shift` — a worker opens a shift and submits it for approval

The Android app is a native shell that loads the live site in Android's
Chrome WebView (`capacitor.config.ts`), so the phone experience is the web
app at phone size. The `mobile` project emulates a Pixel 7 — the same
Chromium engine, a phone viewport, touch and a mobile user agent. What it
can't reach: the native push and share plugins (`lib/native-push.ts`,
`lib/native-share.ts`), and the installed APK itself, which points at
production and is never driven by these tests.

**Offline** (`offline-*.spec.ts`, run in the `offline` and `offline-copy` projects — CI only)
- `offline-pages` — a device whose copy of the data (PowerSync) isn't ready, so the device pages come as their server version, saved whole. With the network off: saved pages open from the device with one red bar that stays; a page never opened opens and says in its place that it isn't on the device (no empty page), and the app moves on from it; "+" → task form opens; a refresh loads the saved copy; back online the bar goes. Then the same with only the server silent while the device says it's online (the owner's laptop, 2026-10-27).
- `offline-device-copy` — a device whose copy syncs, as the office's are. Online, the app saves by itself the menu's device pages (opened or not) and its whole code. With the network off: the device pages open from their frames, drawn from the copy (the customers list, a customer's page, pages never opened online), and a page with no device version says so in its place; a task added through "+" waits on the device, the red bar counts and lists it, it shows on the board and after a refresh; back online it reaches the server by itself.

The service worker removes itself on localhost and 127.0.0.1, and the test
build (`NEXT_PUBLIC_E2E_TEST=1`) doesn't register it there. So this project's
browser reaches the same production build as `http://bizh.test:3100`: Chrome
maps the name to 127.0.0.1 and treats it as a secure origin
(`playwright.config.ts`), and the test build registers its worker on a `.test`
name (`components/pwa/PwaRegistration.tsx`). Port 3100 is a switch inside the
test, in front of the server on 3000, turned off to make the server stop
answering. It runs only on the production build CI serves (`next dev` has no
service worker), as its own CI step.

`offline-device-copy` needs a sync server: CI starts the open-source PowerSync
server (Docker, `journeyapps/powersync-service`) on the job's local database —
its `powersync` publication and `powersync_role` come from the migrations —
with `powersync/sync-config.yaml` as it is, and builds the app a second time
pointed at it (`NEXT_PUBLIC_POWERSYNC_URL`). The rest of the suite runs on the
first build, which points at an address where nothing listens, so its copy
never syncs and it never reaches the real PowerSync server.

Not covered offline yet: the frames carried over a deploy, the order, project
and property pages offline, and workers' phones (their own share of the copy).

**Not covered yet:** property management beyond leases (rent schedule,
tenants, furniture), the weekly meetings page (/meetings), the VAT page,
Morning invoicing, and push notifications.

## One-time setup

1. Docker Desktop must be running.
2. Start the local Supabase stack (safe — never touches the linked remote
   project; only `supabase db push/pull/diff` do that):
   ```bash
   npx supabase start
   ```
   This applies every migration in `supabase/migrations/` plus
   `supabase/seed.sql` (three test logins — see below) to a fresh local DB,
   and prints the local API URL + anon key + service_role key.
3. Copy the env template and fill in those three values:
   ```bash
   cp .env.test.example .env.test.local
   ```
4. Install the browser binary once: `npx playwright install chromium`

## Running

```bash
npm run test:e2e          # headless, starts Next dev automatically
npm run test:e2e:ui       # Playwright's interactive UI mode
```

`playwright.config.ts`'s `webServer` starts `npm run dev` itself using
`.env.test.local` — you don't need a dev server already running (though if
one's already up on :3000, it reuses it, so **make sure any dev server you
already have running is ALSO pointed at the local stack**, not production,
before running these).

## Seeded test logins (`supabase/seed.sql`)

All three share the password `e2e-test-password-123`:

| Role | Email |
|---|---|
| admin | `e2e-admin@bizh.test` |
| office | `e2e-office@bizh.test` |
| worker | `e2e-worker@bizh.test` |

Fixed, well-known, non-secret on purpose — this is a throwaway local
database that gets rebuilt from migrations, not a real credential.

## Resetting the local DB

```bash
npx supabase db reset
```

Re-applies every migration + the seed from scratch — use this after pulling
new migrations, or whenever local data gets messy from a test run.

## Stopping

```bash
npx supabase stop
```
