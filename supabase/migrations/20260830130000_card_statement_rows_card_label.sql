-- ════════════════════════════════════════════════════════════════════════════
-- Decouple a statement row's "which physical card" identity from its
-- editable "category" text.
--
-- category was doing double duty: at import it's set to the detected card
-- name, but the row-edit dialog also lets the user freely retype it (e.g. to
-- add a note like "ויזה כאל זהב 9557 - דלק"). Once that happens, every
-- feature that grouped rows BY category (the "חיוב כרטיס בחשבון" lump-charge
-- picker, "צור הכנסה מכרטיס", and the payments-calendar dedup against
-- card_statement_charges) reads the edited row as belonging to a brand-new
-- phantom card, when it's really the same physical card as before.
--
-- card_label is the stable identity, set ONCE at import from the detected
-- card section and never touched by ordinary category edits — only by an
-- explicit "reassign card" action. category stays freely editable and
-- keeps meaning whatever the user wants it to mean per row.
--
-- Idempotent / safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.card_statement_rows
  add column if not exists card_label text null;

-- Backfill existing rows so nothing goes ungrouped: at worst this preserves
-- today's (possibly already-drifted) grouping until the row is re-saved or
-- explicitly reassigned; only null rows are touched, so this is safe to
-- re-run and never overwrites a card_label already set going forward.
update public.card_statement_rows
set card_label = category
where card_label is null;

create index if not exists card_statement_rows_card_label_idx on public.card_statement_rows (card_label);
