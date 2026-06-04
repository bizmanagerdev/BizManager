-- Run this in the Supabase SQL Editor.
-- Reworks the credit-card statement importer to "save first, assign domains later":
-- uploading a statement now saves the file + every parsed row WITHOUT creating expenses.
-- Domains are assigned later on /financial/statements/[id], where "צור הוצאות" materializes
-- the rows into expenses. These two columns make a saved row stand on its own before an
-- expense exists for it.

-- Original "שיוך" classification from the uploaded sheet — kept so the user can map it to a
-- real business domain later (reference column on the statement page).
alter table public.card_statement_rows
  add column if not exists assignment_raw text null;

-- Whether this row should become an expense when "צור הוצאות" runs. Defaults true; refunds
-- and "לא לתעד" rows are saved with false so they stay on record but aren't materialized.
alter table public.card_statement_rows
  add column if not exists include boolean not null default true;

-- expense_id is already nullable (references expenses on delete set null) and stays null
-- until an expense is created for the row — no change needed there.
-- card_statements.created_count already exists; a saved statement starts at 0 and the
-- create-expenses action recomputes it. No status column is needed (progress is derived
-- from created_count vs total_rows).

-- "Mark as done" flag on the statement header. Set true for a statement that's been handled
-- manually (e.g. its expenses were entered before this feature existed): it stops the
-- "פירוטי אשראי לא משויכים" alert from firing for it and shows a "בוצע" status. Independent
-- of created_count — a done statement may have 0 expenses created here.
alter table public.card_statements
  add column if not exists marked_done boolean not null default false;

-- Income link: a row can ALSO be recorded as income (a customer payment) when the card
-- charge was really someone's payment for a job — e.g. you used their card and the spend is
-- their payment to you for a project/delivery. Independent of expense_id (a row can be both an
-- expense for one thing and income from someone else). For the "whole card is income" action a
-- single payment is created and every row of that card points to it (many rows → one payment).
alter table public.card_statement_rows
  add column if not exists income_payment_id uuid null references public.payments(id) on delete set null;

create index if not exists card_statement_rows_income_idx on public.card_statement_rows (income_payment_id);
