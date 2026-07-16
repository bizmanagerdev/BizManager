# מערכת תזכורות והתראות — Redesign Spec (before → after)

**Status:** proposal, awaiting approval. No code written yet.
**Date:** 2026-07-16

---

## 0. Why we're here

The system was built in 7 phases. **Every phase added a surface instead of replacing one.**
Nobody ever designed it as a whole. The result: two parallel lists showing two different
numbers of two different things, no way to tell "the system noticed" from "I asked", and
per-item phone pings instead of one morning summary.

This spec maps exactly what exists, names the defects, and defines the target.

---

## 1. BEFORE — what exists today

### 1.1 Surfaces (10, for one concept)

| # | Surface | What it actually shows | Source of truth |
|---|---------|------------------------|-----------------|
| 1 | Bell **badge** | unread count | `notifications` table |
| 2 | Bell **dropdown** | delivery history, read/unread | `notifications` |
| 3 | `/notifications` ("כל ההתראות") | full paginated history log | `notifications` |
| 4 | `/alerts` ("מה דורש טיפול") | open worklist, 6 sections | `reminders` |
| 5 | `/calendar` ("יומן") | dated agenda | `reminders` |
| 6 | `PageAlertBar` (9 pages) | contextual banner | `reminders` |
| 7 | Sidebar nav badges | per-section counts | `reminders` |
| 8 | Dashboard **`alerts`** widget | per-rule counts | `reminders` |
| 9 | Dashboard **`reminders`** widget | reminders | `reminders` |
| 10 | Dashboard **`week`** widget ("מבט על היום") | today view | tasks/etc |
| — | Push | phone | delivered via both crons |

**The bell's two footer buttons** (the thing that triggered this): `כל ההתראות` → `/notifications`,
`מה דורש טיפול` → `/alerts`.

### 1.2 The two data stores — the root cause

| Table | Meaning | State |
|-------|---------|-------|
| `reminders` | **the item** (manual + system) | pending / done / cancelled / auto_resolved / snoozed |
| `notifications` | **the delivery log** — one row per push sent | read_at |

The bell badge counts **unread `notifications`**. `/alerts` counts **open `reminders`**.
These are *different numbers of different things*, and both are labelled "התראות".
This is why the bell shows a thousand items that don't match the worklist.

### 1.3 What fires, when (delivery)

**`/api/cron/reminders`** — every 5 min (`*/5 * * * *`), the deliver cron:
- **Window: Israel 08:00–20:59 only.** Outside it, system rows are deferred to the next 08:00; manual rows just retry later.
- Skips `behavior='silent'` → list-only, never pushes.
- Skips `severity='info'` (system) → worklist-only.
- Skips `category='nightly_review'` (its own cron owns it).
- **Manual reminder:** pushes once when `remind_at` passes.
- `ping_once` → sets `notified_at`, done. `ping_repeat` → re-pings next 08:00 until `max_pings`.

**`/api/cron/daily-alerts`** — hourly (`0 * * * *`), the scheduled digests:
- Reads `push_alert_config` where `mode='scheduled'` AND `send_hour_israel = current hour`.
- ⚠️ **`today_tasks`, `overdue_tasks`, `tomorrow_tasks`, `projects_starting`, `projects_deadline` are all DISABLED** (migration `20260703020000`) — killed as "redundant" with the live per-item rules. Only `deliveries` + `weekly_summary` survive.
- **This is the exact digest we now want back.** We deleted the right thing and kept the wrong thing.

**`/api/cron/reminders-sync`** — hourly at :10 — evaluates the 16 rules, inserts/auto-closes system reminders.

**`/api/cron/nightly-review`** — `*/20 20-23 * * *`, gated to Israel 23:00–00:59.

### 1.4 The 16 live rules — and which ones ping your phone

| Rule | Severity | Behavior | Audience | **Pushes today?** |
|------|----------|----------|----------|-------------------|
| `task_overdue` | danger | ping_once | assignee | ✅ **per task** |
| `project_deadline` | warning | ping_once | PM / office | ✅ **per project** |
| `wage_overdue` | danger | ping_repeat (max 3) | admin | ✅ **per worker** |
| `vehicle_expiry` | danger/warning | ping_once | office | ✅ **per vehicle×kind** |
| `check_deposit_due` | warning/danger | ping_once | office | ✅ **per check** |
| `payment_due_today` | warning | ping_once | office | ✅ **per payment** |
| `promise_broken` | danger | ping_once | office | ✅ **per promise** |
| `recurring_expense_confirm` | warning | ping_once | office | ✅ **per expense** |
| `project_closed_unbilled` | warning | ping_once | office | ✅ **per project** |
| `task_due_soon` | info | ping_once | assignee | ❌ (info) |
| `project_starting` | info | ping_once | PM / office | ❌ (info) |
| `stale_quote` | info | ping_once | office | ❌ (info) |
| `collection_overdue` | stage-based | **silent** | office | ❌ (silenced after the Friday flood) |
| `low_stock` | warning | silent | office | ❌ |
| `unprocessed_items` | warning | silent | office | ❌ |
| `session_unallocated` | warning | silent | admin | ❌ |

**9 rules push per-item.** That is the flood. `collection_overdue` was already silenced
reactively after 18 pushes landed on a Friday — a patch, not a design.

### 1.5 Preferences today
`users.notification_prefs = { muted: bucket[], push_paused: bool }` — **mute-only**, across 9 buckets
(money / tasks / projects / ops / payroll / updates / nightly / digests / reminders).
There is no "how much do I want" control — only "off".

---

## 2. The defects (named)

| # | Defect | Consequence |
|---|--------|-------------|
| **D1** | **Two lists** (log + worklist) for one concept | two bell buttons, two numbers, neither trusted |
| **D2** | **No origin axis** — `source=manual\|system` exists in data but is **never shown** | can't tell "I asked" from "system noticed"; worklist groups by money/tasks/projects instead |
| **D3** | **Per-item push, no digest** — 9 rules ping individually; the digest is disabled | flood → user ignores everything |
| **D4** | **No global quick-add** — reminders only attach via entity surfaces | "remind me about 5 things Thursday" is impossible without inventing a task |
| **D5** | **3 overlapping dashboard widgets** (`week` + `alerts` + `reminders`) | no single morning landing |
| **D6** | Worklist UI is heavy (big cards, 4 buttons each) | can't scan it |

---

## 3. AFTER — target design

### 3.1 Model: three concepts, not ten

1. **Item** — one row in `reminders`. Gains a first-class **origin**: `שלי` (manual) | `אוטומטי` (system).
2. **Inbox** — **one** list of items. Filter chips: `הכל | שלי | אוטומטי`.
3. **Delivery** — per-user choice (§3.3).

### 3.2 Surfaces: 10 → 3

| Surface | Role | Change |
|---------|------|--------|
| **Bell → ONE inbox** (`/inbox`) | everything unresolved, filterable by origin | **merge** `/alerts` + `/notifications`; **one** footer link |
| **Dashboard "היום" card** | the morning landing — today's reminders + tasks, top of page | **merge** `week`+`alerts`+`reminders` widgets |
| **`/calendar`** | dated agenda (genuinely different — a *when* view) | keep |
| `PageAlertBar` | contextual in-place banner | **keep**, but limit to `warning`/`danger` (research: context is king) |
| Sidebar badges | count pill | keep (cheap, no page) |
| `/notifications` | — | **DELETE** (merged into inbox) |
| `/alerts` | — | **DELETE** (becomes `/inbox`) |
| Dashboard `alerts` + `reminders` widgets | — | **DELETE** (merged into "היום") |

**The bell badge and the inbox count become the same number**, because they read the same thing.

#### Inbox row (slim — fixes D6)
```
● צ׳ק לפירעון #1234            אוטומטי · היום 08:00
  ₪4,500 — מועד הפקדה 16/07              [בוצע] [דחה]
```
Two buttons, not four. `ערוך` appears only on `שלי` rows.

### 3.3 Delivery — per-user choice (your pick)

New: `users.notification_prefs.delivery` = `'summary'` (default) | `'summary_urgent'` | `'all'`

| Mode | What lands on the phone |
|------|-------------------------|
| **`summary`** (default) | **One 08:00 push/day:** "בוקר טוב — 5 משימות להיום, 2 תזכורות". Everything automatic is otherwise silent → inbox only. |
| **`summary_urgent`** | The 08:00 summary **+** instant push for `severity='danger'` only (overdue payment, broken promise, wage overdue). |
| **`all`** | Today's behavior — every non-silent, non-info item pings. |

**The rule that makes this coherent:**

> **"שלי" (a reminder I set with a time) ALWAYS pings at its time — in every mode.**
> The mode governs **automatic** alerts only.

That is the contract. If you set "call the supplier at 14:00", it pings at 14:00, full stop.
Otherwise "remind me at 14:00" would be broken — and that's the one thing a reminder must do.

Existing `muted[]` buckets + `push_paused` stay as-is (they're orthogonal: *what topics* vs *how much*).

### 3.4 Rule changes

- **All 9 per-item pushing rules → `silent`** (inbox + dashboard only). They get counted into the morning summary instead.
- **Re-enable the digest**: one unified 08:00 summary replacing `today_tasks`/`overdue_tasks`/etc., built from the *inbox count*, not from separate queries. One push, not five.
- `danger` rules stay pushable **only** in `summary_urgent`/`all`.
- `nightly_review` — unchanged.

### 3.5 Global quick-add (fixes D4)
A **"+ תזכורת"** button in the inbox header (and the bell dropdown):
`מתי` + `על מה` + `למי` — no entity required. Standalone reminders are already supported by the
data model (`reminders` with no links); there's simply no UI for it. This is what makes your
boss's "remind me about 5 things" possible **without** inventing 5 fake tasks.

---

## 4. Your boss example — end to end, after

**Setup:** 5 tasks, due Thursday. **No hand-made reminders.**

1. **Thursday 08:00 — ONE push:** `בוקר טוב — 5 משימות להיום, 2 תזכורות` → tap → inbox.
2. **He opens the app → dashboard "היום" card** is the first thing on screen: the same 5 tasks + 2 reminders. If he missed the push, nothing is lost.
3. **He wants a specific nudge?** `+ תזכורת` → "להתקשר לספק", 14:00 → **pings at 14:00**, because it's `שלי` and timed.
4. Nothing else interrupts him all day. Automatic findings accumulate quietly in the inbox with the `אוטומטי` chip.

**Result: 1 push instead of 5+, and he can still see everything on demand.**

---

## 5. Build phases (if approved)

| Phase | Work | Risk |
|-------|------|------|
| **A** | Migration: `notification_prefs` gains `delivery` + `summary_hour` + `subscribe`; add origin to the read model | low, additive |
| **B** | **Inbox merge** — `/inbox` = one list + origin chips + slim rows; bell → one link; redirect `/alerts`+`/notifications`. **+ extend `SECTION_NAV_URL` → per-rule badge destinations** (§7.3) | medium (UI) |
| **C** | **Delivery rework** — 9 rules → silent; per-user summary hour; **owner-first routing + opt-in buckets** (§7.2); the "שלי always pings" contract | **high — this changes who gets what** |
| **D** | **Dashboard "היום" card** — merge 3 widgets into one morning landing | medium |
| **E** | **`/calendar` → "everything" view** (§7.1) + fix `nightly_review` population (§7.4) | medium |
| **F** | **Deletions** — old pages/widgets/routes; prune `push_alert_config` scheduled rows | low |

Each phase is independently shippable and reversible. **B and C deliver ~90% of the value.**
**C is the riskiest** — it silences things people currently receive. Ship it with the admin
override intact (`push_alert_config.recipient_user_ids`) so anything critical can be forced back on.

---

## 9. Status

**✅ Spec complete — every question answered. Ready to build.**

Suggested order: **A → B → C**, then D/E/F.
Start point: Phase A (additive migration, zero behaviour change), then B (the inbox merge the
user actually sees), then C (the delivery rework — the risky one).

---

## 6. DECISIONS (answered 2026-07-16) ✅

| # | Question | **Decision** | Impact |
|---|----------|--------------|--------|
| 1 | `/calendar` — separate or folded in? | **Separate, and it shows EVERYTHING** — "a calendar of everything regardless of inbox and alerts" | ⬆️ scope: calendar is a *third pillar*, not a reminders view (see §7.1) |
| 2 | Summary time | **Per user** | `notification_prefs.summary_hour`, default 08:00 |
| 3 | Who gets automatic alerts? | **Boss gets only his own — whatever he chooses** | ⚠️ **kills role-broadcast as the default** (see §7.2) |
| 4 | Sidebar badges | **Keep — loved.** Also wanted **inside the financial tabs** (they stopped showing when routes moved into the group) | 🐛 **BUG — FIXED 2026-07-16** (see §7.3) |
| 5 | `nightly_review` | **Wanted — projects ACTIVE that day, not ADDED that day.** "Active" = **today is in the date range**. Purpose: *"update what happened — tasks, money etc."* | 🐛 current rule is wrong (see §7.4) |

**All questions answered. Spec is complete and ready to build.**

---

## 7. What the decisions change

### 7.1 `/calendar` becomes "everything", not a reminders view
Today `/calendar` renders `CalendarSection` off reminders. The decision makes it a **standalone
third pillar**: a month/agenda view of **everything dated** — tasks (due_date), projects
(start/end), payments due, checks to deposit, reminders — *independent of* the inbox and the
alert engine. It is a **"what's happening / when"** view. The inbox is a **"what needs me now"**
view. Different questions, so they stay separate pages.

**Final surface count: 3 pillars.**
| Pillar | Question it answers |
|--------|---------------------|
| **Dashboard "היום"** | *What do I do today?* |
| **Bell → Inbox** | *What still needs me?* (filter: הכל/שלי/אוטומטי) |
| **`/calendar`** | *What's happening, and when?* (everything dated) |

### 7.2 Routing flips: owner-first, opt-in for the rest ⚠️
This is the biggest behavioural change in the spec.

**Today:** most rules target `audience_role='office'`, and `visibleAudienceRoles` makes `office`
reach **office + admin**. So the boss automatically receives every collection/check/payment alert
generated by the secretary's desk work. That is *why* he got 18 pushes on a Friday.

**After:**
- **Default = owner-routed.** You get an item only if it's *yours*: assigned to you, your task,
  your project (PM), your reminder.
- **Role-broadcast becomes opt-in**, per user, per bucket: `notification_prefs.subscribe = string[]`
  (e.g. `["money","ops"]`). Empty (default) = "just my own stuff".
- Items with no owner (e.g. `low_stock`, `unprocessed_items`) reach **only** users who opted into
  that bucket — instead of everyone in the role.
- The existing `push_alert_config.audience_role` / `recipient_user_ids` stay as an **admin
  override** for the rare "this must reach X" case.

> Net effect: the boss's phone goes quiet by default. He *chooses* what to subscribe to.
> The secretary still gets her own work, because it's assigned to her.

### 7.3 Sidebar badges in nested tabs — 🐛 FIXED (2026-07-16)
**Root cause:** `AppSidebar.tsx` only rendered `NavCountBadge` for **top-level** nav items.
`NavGroup` rendered its children with no badge at all. When `/collections` (the `money` badge,
per `SECTION_NAV_URL`) moved *inside* the "פיננסי" group, its badge silently disappeared —
exactly the reported symptom.

**Fix applied:**
- Each **group child** now renders its own `NavCountBadge` (`navCounts[child.url]`).
- The **group header** shows a **roll-up badge** while collapsed (sum of children's counts, tone =
  most urgent child), so a nested badge is never invisible. It hides when expanded, since the
  child rows then carry their own.

**Still to extend (not a bug, a gap):** `SECTION_NAV_URL` only maps 4 destinations
(`tasks→/tasks`, `money→/collections`, `projects→/projects`, `hours→/payroll`). To badge
**`/checks`**, **`/financial`**, **`/financial/statements`** etc., the worklist sections must map
per-rule rather than per-section — e.g. `check_deposit_due→/checks`,
`recurring_expense_confirm→/financial`, `unprocessed_items→/financial/statements`,
`vehicle_expiry→/vehicles`, `low_stock→/inventory`. **Include in Phase B.**

### 7.4 `nightly_review` — wrong population 🐛 → **DECIDED**
**Today (wrong):** `app/api/cron/nightly-review/route.ts` counts orders + projects **created today**
(`created_at >= israelDayStart`). A project created three weeks ago but running today is invisible —
which is exactly backwards for an end-of-day review.

**DECIDED — "active that day" = SCHEDULED (today is in the date range):**
> `status ∈ (active, in_progress)` **AND** `start_date <= today` **AND**
> (`end_date >= today` **OR** `end_date IS NULL` — an open end date counts as ongoing).

Cheap to compute (one indexed query, no activity joins), and it matches the intent: *these are the
jobs that were supposed to be running today.*

**Purpose of the ping (user's words): "update what happened — tasks, money, etc."**
It is a **data-capture nudge**, not an alert. The boss ends the day and fills in reality.

| Field | Value |
|-------|-------|
| Trigger | Israel 23:00–00:59 (unchanged) |
| Population | projects scheduled active today (above) |
| Title | `🌙 N פרויקטים פעילים היום` |
| Body | `עדכן מה קרה — משימות, כסף, הוצאות` |
| Behavior | `ping_repeat` until marked **בוצע** (unchanged) |
| Dedupe | `nightly_review:<israelDate>` (unchanged) |
| Link | → the day's active projects list (**not** `/sales`, as today) |

**Exempt from the §7.2 owner-first rule** — this is a deliberate end-of-day ritual the boss opted
into, not an automatic finding. It ignores `delivery` mode and pings regardless (it *is* the
summary, at night).

**Note:** orders drop out of the nightly population — it becomes **projects-only**, per the
decision wording. Speak up if you want active orders/deliveries counted too.

---

## 8. Revised delivery model (after decision #3)

```
users.notification_prefs = {
  delivery:      'summary' | 'summary_urgent' | 'all',   // default 'summary'
  summary_hour:  8,                                       // NEW — per user (decision #2)
  subscribe:     string[],                                // NEW — opt-in role buckets (decision #3)
  muted:         string[],                                // existing
  push_paused:   boolean,                                 // existing
}
```

**Resolution order for "does this reach me?"**
1. Is it **mine** (assigned/created/my entity)? → **yes**, always.
2. Else, did I **subscribe** to its bucket? → yes → it enters my inbox.
3. Else → I never see it.

**Then, "does it ping my phone?"**
1. `שלי` **with a time** → **always pings at that time** (the contract — every mode).
2. Automatic → per `delivery`: `summary` (rolls into my `summary_hour` push) /
   `summary_urgent` (+ instant for `danger`) / `all` (every non-silent item).
3. `muted[]` bucket → never. `push_paused` → inbox only.
