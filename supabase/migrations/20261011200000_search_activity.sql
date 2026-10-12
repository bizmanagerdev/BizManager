-- ════════════════════════════════════════════════════════════════════════════
-- Search the activity log (owner, 2026-10-11: "חיפוש חופשי: מקלידים 'כהן',
-- '800' או 'צ'ק' ומוצאים כל פעולה שקשורה לזה").
--
-- One read-only function. A typed word finds the actions whose record carries
-- it (a name, a task's subject, a note, a file name, a check number), and the
-- actions about a customer, project, worker or product of that name: "כהן"
-- finds Cohen's orders, his payments, his project's expenses. An amount finds
-- the payments, expenses and orders of exactly that sum; a word like "צ׳ק"
-- arrives as its stored value (p_values: 'check') and finds those payments.
--
-- SECURITY INVOKER: it reads with the caller's own rights, so it shows exactly
-- what they may see already — the log only to admins (admin_read_logs), names
-- only where they may read them. A private task's own words are never matched,
-- so a search can't tell anyone what a private task says.
--
-- Paged like the feed: newest first, before (p_before_at, p_before_id).
--
-- ROLLBACK: supabase/rollbacks/20261011200000_search_activity.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.search_activity(
  p_text text default null,
  p_values text[] default '{}',
  p_amount numeric default null,
  p_table text default null,
  p_actions text[] default null,
  p_actors uuid[] default null,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
)
returns setof public.audit_logs
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(coalesce(p_text, '')), '') as t,
      '%' || replace(replace(replace(btrim(coalesce(p_text, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  customers_hit as (
    select c.id from customers c, params p where p.t is not null and c.name ilike p.pattern
  ),
  projects_hit as (
    select pr.id from projects pr, params p
    where p.t is not null and (pr.name ilike p.pattern or pr.customer_id in (select id from customers_hit))
  ),
  orders_hit as (
    select o.id from orders o where o.customer_id in (select id from customers_hit)
  ),
  users_hit as (
    select u.id from users u, params p where p.t is not null and u.full_name ilike p.pattern
    union
    select u.auth_user_id from users u, params p where p.t is not null and u.full_name ilike p.pattern and u.auth_user_id is not null
  ),
  products_hit as (
    select pd.id from products pd, params p where p.t is not null and pd.name ilike p.pattern
  )
  select a.*
  from audit_logs a, params p
  where (p_before_at is null or a.created_at < p_before_at or (a.created_at = p_before_at and a.id < p_before_id))
    and (p_table is null or a.table_name = p_table)
    and (p_actions is null or a.action = any (p_actions))
    and (p_actors is null or a.changed_by = any (p_actors))
    and (
      -- the word inside the record itself
      (
        p.t is not null
        and not (a.table_name = 'tasks' and coalesce(a.new_data, a.old_data) ->> 'is_private' = 'true')
        -- One string of the fields that hold words, before and after (a
        -- set-returning scan of every key was 7× slower on the whole log).
        and concat_ws(' ',
            a.new_data ->> 'name',
            a.new_data ->> 'full_name',
            a.new_data ->> 'subject',
            a.new_data ->> 'subject_template',
            a.new_data ->> 'title',
            a.new_data ->> 'description',
            a.new_data ->> 'notes',
            a.new_data ->> 'file_name',
            a.new_data ->> 'reference_number',
            a.new_data ->> 'check_number',
            a.new_data ->> 'address',
            a.new_data ->> 'city',
            a.new_data ->> 'phone',
            a.new_data ->> 'email',
            a.new_data ->> 'make_model',
            a.new_data ->> 'license_plate',
            a.new_data ->> 'label',
            a.new_data ->> 'reason',
            a.new_data ->> 'lender',
            a.new_data ->> 'borrower',
            a.new_data ->> 'document_type_label',
            a.new_data ->> 'morning_document_number',
            a.old_data ->> 'name',
            a.old_data ->> 'full_name',
            a.old_data ->> 'subject',
            a.old_data ->> 'subject_template',
            a.old_data ->> 'title',
            a.old_data ->> 'description',
            a.old_data ->> 'notes',
            a.old_data ->> 'file_name',
            a.old_data ->> 'reference_number',
            a.old_data ->> 'check_number',
            a.old_data ->> 'address',
            a.old_data ->> 'city',
            a.old_data ->> 'phone',
            a.old_data ->> 'email',
            a.old_data ->> 'make_model',
            a.old_data ->> 'license_plate',
            a.old_data ->> 'label',
            a.old_data ->> 'reason',
            a.old_data ->> 'lender',
            a.old_data ->> 'borrower',
            a.old_data ->> 'document_type_label',
            a.old_data ->> 'morning_document_number'
          ) ilike p.pattern
      )
      -- about a customer / project / order / person / product of that name
      or (a.table_name = 'customers' and a.record_id in (select id from customers_hit))
      or (a.table_name = 'projects' and a.record_id in (select id from projects_hit))
      or (a.table_name = 'orders' and a.record_id in (select id from orders_hit))
      or coalesce(a.new_data, a.old_data) ->> 'customer_id' in (select id::text from customers_hit)
      or coalesce(a.new_data, a.old_data) ->> 'project_id' in (select id::text from projects_hit)
      or coalesce(a.new_data, a.old_data) ->> 'order_id' in (select id::text from orders_hit)
      or (coalesce(a.new_data, a.old_data) ->> 'source_type' = 'order'
          and coalesce(a.new_data, a.old_data) ->> 'source_id' in (select id::text from orders_hit))
      or coalesce(a.new_data, a.old_data) ->> 'user_id' in (select id::text from users_hit)
      or a.changed_by in (select id from users_hit)
      or coalesce(a.new_data, a.old_data) ->> 'product_id' in (select id::text from products_hit)
      -- a payment method or a status ("צ׳ק" → check)
      or (cardinality(p_values) > 0 and (
            coalesce(a.new_data, a.old_data) ->> 'payment_method' = any (p_values)
            or coalesce(a.new_data, a.old_data) ->> 'status' = any (p_values)))
      -- an exact amount
      or (p_amount is not null and exists (
            select 1
            from (values ('amount_total'), ('amount'), ('total_amount'), ('subtotal'), ('gross_salary'), ('monthly_rent_amount')) f(key)
            where coalesce(a.new_data, a.old_data) ->> f.key ~ '^-?[0-9]+(\.[0-9]+)?$'
              and (coalesce(a.new_data, a.old_data) ->> f.key)::numeric = p_amount))
    )
  order by a.created_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.search_activity(text, text[], numeric, text, text[], uuid[], timestamptz, uuid, integer) from public, anon;
grant execute on function public.search_activity(text, text[], numeric, text, text[], uuid[], timestamptz, uuid, integer) to authenticated;

comment on function public.search_activity(text, text[], numeric, text, text[], uuid[], timestamptz, uuid, integer) is
  'The activity page''s free search: actions whose record holds the word, or are about a customer/project/person/product of that name, a payment method or status, or an exact amount. Invoker rights (admins only read the log).';
