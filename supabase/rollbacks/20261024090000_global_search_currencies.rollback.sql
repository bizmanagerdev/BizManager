-- Rollback for 20261024090000_global_search_currencies.sql.
-- Puts back the search as it was before: 20261019120000_global_search_customer_details.sql
-- with the property line of 20261023100000 and 20261023120000 — amounts in ₪ only.
-- Read-only function; no data changes either way.

create or replace function public.global_search(
  p_tokens jsonb,
  p_query text default '',
  p_kinds text[] default null,
  p_limit integer default 5
)
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text,
  at timestamptz,
  info jsonb,
  reasons jsonb,
  rank integer,
  total bigint
)
language plpgsql
stable
security invoker
set search_path = public
set plan_cache_mode = force_generic_plan
as $fn$
#variable_conflict use_column
declare
  v_n integer;          -- tokens sent
  v_tre text[];         -- one pattern per plain word (any accepted spelling)
  v_tre_exact text[];   -- the same words exactly as typed
  v_tre_ws text[];      -- … found at the start of a word (one prefix letter allowed: בצ׳ק)
  v_qre text;           -- the whole query as one phrase (for ranking)
  v_allres text[];      -- every pattern (for "why it matched")
  v_ns integer;         -- amount / date / phone / hour tokens (the first three are used)
  v_sre text[];         -- … each one's pattern in words (or null)
  v_sa numeric[];       -- … its amount (or null)
  v_sd date[];          -- … its date (or null)
  v_sp text[];          -- … its phone pattern (or null)
  v_amts numeric[];
  v_dts date[];
begin
  with tok as (
    select
      e.ord,
      case when jsonb_typeof(e.v -> 'a') = 'number' then (e.v ->> 'a')::numeric end as amt,
      case when coalesce(e.v ->> 'd', '') ~ '^\d{4}-\d{2}-\d{2}$' then (e.v ->> 'd')::date end as dt,
      nullif(regexp_replace(coalesce(e.v ->> 'p', ''), '\D', '', 'g'), '') as ph,
      -- an hour, always "HH:MM"
      case when coalesce(e.v ->> 'h', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then e.v ->> 'h' end as hr,
      array(
        select
          case when coalesce(e.v ->> 'w', '') = 'true' then '(^|[^0-9a-z.,:])' else '' end
          || string_agg(
               case s.ch
                 when 'כ' then '[כך]' when 'ך' then '[כך]' when 'מ' then '[מם]' when 'ם' then '[מם]'
                 when 'נ' then '[נן]' when 'ן' then '[נן]' when 'פ' then '[פף]' when 'ף' then '[פף]'
                 when 'צ' then '[צץ]' when 'ץ' then '[צץ]' else s.ch end,
               '[׳״"''`’‘,֑-ׇ]*' order by s.ord)
          || case when coalesce(e.v ->> 'w', '') = 'true' then '(?![0-9a-z]|[.,:][0-9])' else '' end
        from jsonb_array_elements_text(case when jsonb_typeof(e.v -> 't') = 'array' then e.v -> 't' else '[]'::jsonb end)
               with ordinality as x(word, xo)
        cross join lateral regexp_split_to_table(
               regexp_replace(lower(x.word), '[^0-9a-zא-ת؀-ۿ]', '', 'g'), '') with ordinality as s(ch, ord)
        where s.ch <> ''
        group by x.xo
        order by x.xo
      ) as res
    from jsonb_array_elements(case when jsonb_typeof(p_tokens) = 'array' then p_tokens else '[]'::jsonb end)
           with ordinality as e(v, ord)
  ),
  tk as (
    select tok.*,
      (tok.amt is not null or tok.dt is not null or tok.ph is not null or tok.hr is not null) as special,
      -- what the token looks like written in text: an hour as "14:30" (not
      -- inside a longer number), anything else as typed
      case when tok.hr is not null then '(^|[^0-9])' || tok.hr || '(?![0-9])' else tok.res[1] end as sre,
      -- a phone: its digits in order, any of - . ( ) / + or a space between them,
      -- and a leading 0 also matching +972
      case when tok.ph is not null then
        case when tok.ph like '0%' and length(tok.ph) > 1 then '(0|972)[-. ()/+]*' else '' end
        || (select string_agg(z.ch, '[-. ()/+]*' order by z.o)
            from regexp_split_to_table(case when tok.ph like '0%' and length(tok.ph) > 1 then substr(tok.ph, 2) else tok.ph end, '')
                 with ordinality as z(ch, o))
      end as pre
    from tok
  )
  select
    count(*),
    coalesce(array_agg('(' || array_to_string(res, '|') || ')' order by ord) filter (where not special and cardinality(res) > 0), '{}'),
    coalesce(array_agg(res[1] order by ord) filter (where not special and cardinality(res) > 0), '{}'),
    coalesce(array_agg('(^|[^0-9a-zא-ת])[ובכלמשה]?' || res[1] order by ord) filter (where not special and cardinality(res) > 0), '{}'),
    string_agg(res[1], '[^0-9a-zא-ת]+' order by ord) filter (where cardinality(res) > 0 and hr is null),
    coalesce((select array_agg(r) from tok t2, unnest(t2.res) r), '{}')
      || coalesce(array_agg(sre) filter (where hr is not null), '{}'),
    count(*) filter (where special),
    coalesce(array_agg(sre order by ord) filter (where special), '{}'),
    coalesce(array_agg(amt order by ord) filter (where special), '{}'),
    coalesce(array_agg(dt order by ord) filter (where special), '{}'),
    coalesce(array_agg(pre order by ord) filter (where special), '{}'),
    coalesce(array_agg(amt) filter (where amt is not null), '{}'),
    coalesce(array_agg(dt) filter (where dt is not null), '{}')
  into v_n, v_tre, v_tre_exact, v_tre_ws, v_qre, v_allres, v_ns, v_sre, v_sa, v_sd, v_sp, v_amts, v_dts
  from tk;

  if coalesce(v_n, 0) = 0 or (cardinality(v_tre) = 0 and v_ns = 0) then
    return;
  end if;

  return query
  with
tc as (
  select task_id, string_agg(body, ' | ' order by created_at) as bodies
  from task_comments group by task_id
),
pt as (
  select t.project_id,
    string_agg(t.subject, ' | ') as subjects,
    string_agg(nullif(t.description, ''), ' | ') as descriptions,
    string_agg(tc.bodies, ' | ') as comments,
    coalesce(array_agg((t.due_date at time zone 'Asia/Jerusalem')::date) filter (where t.due_date is not null), '{}') as due_dates,
    string_agg(nullif(t.due_time, ''), ' | ') as due_times
  from tasks t left join tc on tc.task_id = t.id
  where t.project_id is not null
  group by t.project_id
),
-- An order's / a project's payments: what was written on them, their amounts,
-- the day each is for and the day (and hour) each was recorded.
opay as (
  select pm.order_id as owner_id,
    string_agg(nullif(pm.notes, ''), ' | ') as notes,
    string_agg(nullif(concat_ws(' ', nullif(pm.reference_number, ''), nullif(pm.check_number, '')), ''), ' | ') as refs,
    string_agg(distinct case lower(pm.payment_method) when 'cash' then 'מזומן' when 'bank_transfer' then 'העברה בנקאית' when 'credit_card' then 'כרטיס אשראי' when 'check' then 'צ׳ק' when 'bit' then 'ביט' when 'card_refund' then 'זיכוי בכרטיס' end, ' ') as methods,
    string_agg(to_char(pm.created_at at time zone 'Asia/Jerusalem', 'HH24:MI'), ' | ') as times,
    array_agg(pm.amount_total) as amounts,
    array_agg((pm.payment_date at time zone 'Asia/Jerusalem')::date) as pay_dates,
    array_agg((pm.created_at at time zone 'Asia/Jerusalem')::date) as rec_dates
  from payments pm
  where pm.order_id is not null
  group by pm.order_id
),
ppay as (
  select pm.project_id as owner_id,
    string_agg(nullif(pm.notes, ''), ' | ') as notes,
    string_agg(nullif(concat_ws(' ', nullif(pm.reference_number, ''), nullif(pm.check_number, '')), ''), ' | ') as refs,
    string_agg(distinct case lower(pm.payment_method) when 'cash' then 'מזומן' when 'bank_transfer' then 'העברה בנקאית' when 'credit_card' then 'כרטיס אשראי' when 'check' then 'צ׳ק' when 'bit' then 'ביט' when 'card_refund' then 'זיכוי בכרטיס' end, ' ') as methods,
    string_agg(to_char(pm.created_at at time zone 'Asia/Jerusalem', 'HH24:MI'), ' | ') as times,
    array_agg(pm.amount_total) as amounts,
    array_agg((pm.payment_date at time zone 'Asia/Jerusalem')::date) as pay_dates,
    array_agg((pm.created_at at time zone 'Asia/Jerusalem')::date) as rec_dates
  from payments pm
  where pm.project_id is not null
  group by pm.project_id
),
-- A project's expenses (on the expense itself or through project_expenses).
pexp as (
  select l.project_id,
    string_agg(nullif(concat_ws(' · ', nullif(e.description, ''), nullif(e.category, '')), ''), ' | ') as texts,
    string_agg(nullif(concat_ws(' ', nullif(e.notes, ''), nullif(l.link_notes, '')), ''), ' | ') as notes,
    string_agg(to_char(e.created_at at time zone 'Asia/Jerusalem', 'HH24:MI'), ' | ') as times,
    array_agg(e.amount) as amounts,
    array_agg((e.expense_date at time zone 'Asia/Jerusalem')::date) as dates
  from (
    select x.expense_id, x.project_id, string_agg(nullif(x.link_notes, ''), ' | ') as link_notes
    from (
      select id as expense_id, project_id, null::text as link_notes from expenses where project_id is not null
      union all
      select expense_id, project_id, notes from project_expenses where project_id is not null
    ) x
    group by x.expense_id, x.project_id
  ) l
  join expenses e on e.id = l.expense_id
  group by l.project_id
),
-- A project's shifts: who worked, when, what it cost.
pshift as (
  select s.project_id,
    string_agg(distinct u.full_name, ' | ') as workers,
    string_agg(nullif(concat_ws(' ', nullif(s.notes, ''), nullif(s.notes_he, '')), ''), ' | ') as notes,
    string_agg(to_char(s.clock_in at time zone 'Asia/Jerusalem', 'HH24:MI')
      || coalesce('–' || to_char(s.clock_out at time zone 'Asia/Jerusalem', 'HH24:MI'), ''), ' | ') as times,
    array_agg(s.labor_cost) filter (where s.labor_cost is not null) as costs,
    array_agg((s.clock_in at time zone 'Asia/Jerusalem')::date) as dates
  from attendance_sessions s
  left join users u on u.id = s.user_id
  where s.project_id is not null
  group by s.project_id
),
cb as (
  select customer_id,
    string_agg(name, ' | ') as names,
    string_agg(coalesce(nullif(addr_formatted, ''), address), ' | ') as addrs,
    array_agg(phone) as phones
  from customer_branches group by customer_id
),
ct as (
  select customer_id,
    string_agg(full_name, ' | ') as names,
    string_agg(email, ' | ') as emails,
    array_agg(phone) || array_agg(whatsapp) as phones
  from contacts where coalesce(active, true) group by customer_id
),
oi as (
  select i.order_id,
    string_agg(pr.name, ' | ') as products,
    string_agg(i.description, ' | ') as descriptions,
    string_agg(i.notes, ' | ') as notes,
    array_agg(i.line_total) as totals
  from order_items i left join products pr on pr.id = i.product_id
  group by i.order_id
),
tagged as (
  select et.entity_type, et.entity_id, string_agg(tg.name, ' | ') as names
  from entity_tags et join tags tg on tg.id = et.tag_id
  group by et.entity_type, et.entity_id
),
doclinks as (
  select dl.document_id,
    string_agg(coalesce(c.name, pr.name, tk.subject, coalesce(pp.name, pp.address), u.full_name), ' | ') as names
  from document_links dl
  left join customers c on dl.entity_type = 'customer' and c.id = dl.entity_id
  left join projects pr on dl.entity_type = 'project' and pr.id = dl.entity_id
  left join tasks tk on dl.entity_type = 'task' and tk.id = dl.entity_id
  left join properties pp on dl.entity_type = 'property' and pp.id = dl.entity_id
  left join users u on dl.entity_type = 'user' and u.id = dl.entity_id
  where dl.entity_type in ('customer', 'project', 'task', 'property', 'user')
  group by dl.document_id
),
vdocs as (
  select et.tag_id, string_agg(coalesce(nullif(d.title, ''), d.file_name), ' | ') as titles
  from entity_tags et join documents d on d.id = et.entity_id
  where et.entity_type = 'document'
  group by et.tag_id
),
mi as (
  select meeting_id, string_agg(concat_ws(' ', title, notes), ' | ' order by position) as items
  from meeting_items group by meeting_id
),

-- ── every kind of record, in one shape ──────────────────────────────────────
-- kind, id, title, subtitle, at (for sorting), info (for the screen),
-- tl/tv: word labels/values (a null label = shown in the title already),
-- al/av: amount labels/values, dl/dv: date labels/values (a shorter label array
-- repeats its last label), rs..re/rl: a date range and its label,
-- pl/pv: phone labels/values.
src as (
  -- Customers (+ their branches and contacts)
  select 'customer'::text as kind, c.id, c.name as title,
    coalesce(nullif(c.addr_formatted, ''), nullif(c.address, ''), nullif(coalesce(c.addr_city, c.city), '')) as subtitle,
    c.created_at as at,
    jsonb_build_object('phone', coalesce(nullif(c.phone, ''), c.whatsapp), 'inactive', c.active is false) as info,
    array[null, 'שם לחשבונית', 'ח.פ. / ת.ז.', 'אימייל', 'כתובת', 'כתובת', 'עיר', 'הערה', 'הוראות משלוח', 'סניף', 'כתובת סניף', 'איש קשר', 'אימייל איש קשר']::text[] as tl,
    array[c.name, c.name_for_invoice, c.registration_number, c.email, c.address, c.addr_formatted, coalesce(c.addr_city, c.city), c.notes, c.delivery_instructions, cb.names, cb.addrs, ct.names, ct.emails]::text[] as tv,
    '{}'::text[] as al, '{}'::numeric[] as av,
    array['נוסף למערכת']::text[] as dl,
    array[(c.created_at at time zone 'Asia/Jerusalem')::date] as dv,
    null::date as rs, null::date as re, null::text as rl,
    array['טלפון', 'וואטסאפ', 'טלפון סניף / איש קשר']::text[] as pl,
    array[c.phone, c.whatsapp]::text[] || coalesce(cb.phones, '{}') || coalesce(ct.phones, '{}') as pv
  from customers c
  left join cb on cb.customer_id = c.id
  left join ct on ct.customer_id = c.id
  where p_kinds is null or 'customer' = any (p_kinds)

  union all
  -- Contacts (אנשי קשר) — open their customer
  select 'contact', k.id, k.full_name, c.name, k.created_at,
    jsonb_build_object('customer_id', k.customer_id, 'phone', coalesce(nullif(k.phone, ''), k.whatsapp), 'role', k.role),
    array[null, 'תפקיד', 'אימייל', 'הערה']::text[],
    array[k.full_name, k.role, k.email, k.notes]::text[],
    '{}', '{}', '{}', '{}', null, null, null,
    array['טלפון', 'וואטסאפ']::text[], array[k.phone, k.whatsapp]::text[]
  from contacts k left join customers c on c.id = k.customer_id
  where coalesce(k.active, true) and (p_kinds is null or 'contact' = any (p_kinds))

  union all
  -- Projects (+ their notes, addresses, items, tasks and task replies, and
  -- the payments, expenses and shifts recorded on them)
  select 'project', p.id, p.name,
    nullif(concat_ws(' · ', c.name, coalesce(nullif(c.phone, ''), c.whatsapp)), ''),
    p.created_at,
    jsonb_build_object('status', p.status, 'type', p.project_type, 'price', coalesce(p.actual_price, p.agreed_base_price),
      'start_date', p.start_date, 'customer_id', p.customer_id),
    array[null, 'לקוח', 'שם לחשבונית', 'ח.פ. / ת.ז.', 'אימייל לקוח', 'עיר', 'איש קשר', 'אימייל איש קשר',
      'סטטוס', 'סוג', 'הערה', 'כתובת מוצא', 'כתובת יעד', 'פריטים להובלה', 'תנאי תשלום', 'סניף', 'משימה', 'תיאור משימה', 'תגובה במשימה',
      'הערת תשלום', 'אסמכתא / צ׳ק', 'אמצעי תשלום', 'הוצאה', 'הערת הוצאה', 'עובד במשמרת', 'הערת משמרת',
      'שעת פתיחה', 'שעת סיום', 'שעת יעד של משימה', 'שעת תשלום', 'שעת הוצאה', 'שעות משמרת']::text[],
    array[p.name, c.name, c.name_for_invoice, c.registration_number, c.email, coalesce(c.addr_city, c.city), ct.names, ct.emails,
      case p.status::text when 'quote' then 'הצעת מחיר' when 'planned' then 'מתוכנן' when 'active' then 'פעיל' when 'on_hold' then 'בהמתנה' when 'completed' then 'הושלם' when 'cancelled' then 'בוטל' end,
      case p.project_type::text when 'moving' then 'הובלה' when 'construction' then 'שיפוצים' when 'logistics' then 'לוגיסטיקה' when 'home' then 'בית' end,
      p.notes,
      coalesce(nullif(p.origin_formatted, ''), p.origin_address),
      coalesce(nullif(p.destination_formatted, ''), p.destination_address),
      array_to_string(p.items_to_move, ', '),
      case p.payment_terms when 'immediate' then 'מיידי' when 'eom' then 'שוטף' when 'eom_30' then 'שוטף+30' when 'eom_40' then 'שוטף+40' when 'eom_60' then 'שוטף+60' when 'eom_90' then 'שוטף+90' else p.payment_terms end,
      b.name, pt.subjects, pt.descriptions, pt.comments,
      pp.notes, pp.refs, pp.methods, px.texts, px.notes, ps.workers, ps.notes,
      to_char(p.created_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
      case when extract(epoch from p.completed_at)::bigint % 86400 <> 0 then to_char(p.completed_at at time zone 'Asia/Jerusalem', 'HH24:MI') end,
      pt.due_times, pp.times, px.times, ps.times]::text[],
    array['מחיר', 'מחיר בפועל']::text[]
      || array_fill('תשלום'::text, array[coalesce(cardinality(pp.amounts), 0)])
      || array_fill('הוצאה'::text, array[coalesce(cardinality(px.amounts), 0)])
      || array_fill('עלות משמרת'::text, array[coalesce(cardinality(ps.costs), 0)]),
    array[p.agreed_base_price, p.actual_price]::numeric[]
      || coalesce(pp.amounts, '{}') || coalesce(px.amounts, '{}') || coalesce(ps.costs, '{}'),
    array['נפתח', 'תאריך התחלה', 'תאריך סיום', 'הושלם', 'מועד תשלום']::text[]
      || array_fill('תאריך תשלום'::text, array[coalesce(cardinality(pp.pay_dates), 0)])
      || array_fill('תשלום נרשם'::text, array[coalesce(cardinality(pp.rec_dates), 0)])
      || array_fill('תאריך הוצאה'::text, array[coalesce(cardinality(px.dates), 0)])
      || array_fill('משמרת'::text, array[coalesce(cardinality(ps.dates), 0)])
      || array_fill('תאריך יעד של משימה'::text, array[coalesce(cardinality(pt.due_dates), 0)]),
    array[(p.created_at at time zone 'Asia/Jerusalem')::date, p.start_date, p.end_date, (p.completed_at at time zone 'Asia/Jerusalem')::date, p.due_date]
      || coalesce(pp.pay_dates, '{}') || coalesce(pp.rec_dates, '{}') || coalesce(px.dates, '{}')
      || coalesce(ps.dates, '{}') || coalesce(pt.due_dates, '{}'),
    p.start_date, coalesce(p.end_date, p.start_date), 'פעיל בתאריך',
    array['טלפון לקוח', 'וואטסאפ לקוח', 'טלפון איש קשר']::text[], array[c.phone, c.whatsapp]::text[] || coalesce(ct.phones, '{}')
  from projects p
  left join customers c on c.id = p.customer_id
  left join ct on ct.customer_id = p.customer_id
  left join customer_branches b on b.id = p.branch_id
  left join pt on pt.project_id = p.id
  left join ppay pp on pp.owner_id = p.id
  left join pexp px on px.project_id = p.id
  left join pshift ps on ps.project_id = p.id
  where p_kinds is null or 'project' = any (p_kinds)

  union all
  -- Tasks (+ their replies)
  select 'task', t.id, t.subject, coalesce(pr.name, c.name), t.created_at,
    jsonb_build_object('status', t.status, 'priority', t.priority, 'due_date', t.due_date, 'due_time', t.due_time,
      'assignee', u.full_name, 'project_id', t.project_id),
    array[null, 'תיאור', 'הערה', 'כתובת', 'כתובת', 'עיר', 'פרויקט', 'לקוח', 'אחראי', 'סטטוס', 'עדיפות', 'תגובה',
      'שעת יעד', 'שעת יצירה', 'שעת ביצוע']::text[],
    array[t.subject, t.description, t.notes, t.address, t.addr_formatted, coalesce(t.addr_city, t.city), pr.name, c.name, u.full_name,
      case t.status::text when 'todo' then 'לביצוע' when 'in_progress' then 'בתהליך' when 'blocked' then 'חסום' when 'done' then 'בוצע' when 'cancelled' then 'בוטל' end,
      case t.priority::text when 'low' then 'נמוכה' when 'medium' then 'בינונית' when 'high' then 'גבוהה' when 'urgent' then 'דחופה' end,
      tc.bodies,
      nullif(t.due_time, ''),
      to_char(t.created_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
      to_char(t.completed_at at time zone 'Asia/Jerusalem', 'HH24:MI')]::text[],
    '{}', '{}',
    array['נוצרה', 'תאריך יעד', 'בוצעה']::text[],
    array[(t.created_at at time zone 'Asia/Jerusalem')::date, (t.due_date at time zone 'Asia/Jerusalem')::date, (t.completed_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from tasks t
  left join projects pr on pr.id = t.project_id
  left join customers c on c.id = t.customer_id
  left join users u on u.id = t.assigned_user_id
  left join tc on tc.task_id = t.id
  where p_kinds is null or 'task' = any (p_kinds)

  union all
  -- Orders (+ their comments, products and lines, and the payments on them)
  select 'order', o.id, coalesce(c.name, 'הזמנה'), b.name, o.order_date,
    jsonb_build_object('status', o.status, 'payment_status', o.payment_status, 'total', o.total_amount,
      'order_date', o.order_date, 'delivered_at', o.delivery_confirmed_at, 'customer_id', o.customer_id),
    array[null, 'מספר הזמנה', 'הערה', 'מוצר', 'פריט', 'הערת פריט', 'סטטוס', 'תשלום', 'תנאי תשלום', 'סניף', 'כתובת לקוח',
      'שם לחשבונית', 'ח.פ. / ת.ז.', 'אימייל לקוח', 'עיר', 'איש קשר', 'אימייל איש קשר',
      'הערת תשלום', 'אסמכתא / צ׳ק', 'אמצעי תשלום', 'שעת פתיחה', 'שעת מסירה', 'שעת סגירה', 'שעת תשלום']::text[],
    array[c.name, left(o.id::text, 8), o.notes, oi.products, oi.descriptions, oi.notes,
      case o.status when 'draft' then 'פתוח פתוחה' when 'reserved' then 'בהזמנה' when 'partially_delivered' then 'סופק חלקית' when 'delivered' then 'סופק נמסר נמסרה' when 'closed' then 'סגור סגורה' when 'cancelled' then 'בוטל' end,
      case o.payment_status when 'paid' then 'שולם' when 'partial' then 'שולם חלקית' when 'unpaid' then 'לא שולם' when 'not_paid' then 'לא שולם' when 'overpaid' then 'שולם יתר' end,
      case o.payment_terms when 'immediate' then 'מיידי' when 'eom' then 'שוטף' when 'eom_30' then 'שוטף+30' when 'eom_40' then 'שוטף+40' when 'eom_60' then 'שוטף+60' when 'eom_90' then 'שוטף+90' else o.payment_terms end,
      b.name, coalesce(nullif(c.addr_formatted, ''), c.address),
      c.name_for_invoice, c.registration_number, c.email, coalesce(c.addr_city, c.city), ct.names, ct.emails,
      op.notes, op.refs, op.methods,
      to_char(o.created_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
      case when extract(epoch from o.delivery_confirmed_at)::bigint % 86400 <> 0 then to_char(o.delivery_confirmed_at at time zone 'Asia/Jerusalem', 'HH24:MI') end,
      case when extract(epoch from o.closed_at)::bigint % 86400 <> 0 then to_char(o.closed_at at time zone 'Asia/Jerusalem', 'HH24:MI') end,
      op.times]::text[],
    array['סכום ההזמנה', 'לפני הנחה']::text[]
      || array_fill('שורה בהזמנה'::text, array[coalesce(cardinality(oi.totals), 0)])
      || array_fill('תשלום'::text, array[coalesce(cardinality(op.amounts), 0)]),
    array[o.total_amount, o.subtotal]::numeric[] || coalesce(oi.totals, '{}') || coalesce(op.amounts, '{}'),
    array['תאריך הזמנה', 'נפתחה', 'נמסרה', 'נסגרה', 'מועד משלוח', 'מועד תשלום']::text[]
      || array_fill('תאריך תשלום'::text, array[coalesce(cardinality(op.pay_dates), 0)])
      || array_fill('תשלום נרשם'::text, array[coalesce(cardinality(op.rec_dates), 0)]),
    array[(o.order_date at time zone 'Asia/Jerusalem')::date, (o.created_at at time zone 'Asia/Jerusalem')::date,
      (o.delivery_confirmed_at at time zone 'Asia/Jerusalem')::date, (o.closed_at at time zone 'Asia/Jerusalem')::date,
      o.requested_delivery_date, o.due_date]
      || coalesce(op.pay_dates, '{}') || coalesce(op.rec_dates, '{}'),
    null, null, null,
    array['טלפון לקוח', 'וואטסאפ לקוח', 'טלפון איש קשר']::text[], array[c.phone, c.whatsapp]::text[] || coalesce(ct.phones, '{}')
  from orders o
  left join customers c on c.id = o.customer_id
  left join ct on ct.customer_id = o.customer_id
  left join customer_branches b on b.id = o.branch_id
  left join oi on oi.order_id = o.id
  left join opay op on op.owner_id = o.id
  where p_kinds is null or 'order' = any (p_kinds)

  union all
  -- Products
  select 'product', pd.id, pd.name, pd.description, pd.updated_at,
    jsonb_build_object('price', pd.base_price, 'sku', pd.sku, 'inactive', pd.active is false),
    array[null, 'מק"ט', 'ברקוד', 'תיאור', 'קטגוריה']::text[],
    array[pd.name, pd.sku, pd.barcode, pd.description, cat.name]::text[],
    array['מחיר', 'עלות']::text[], array[pd.base_price, pd.base_cost]::numeric[],
    '{}', '{}', null, null, null,
    array['ברקוד']::text[], array[pd.barcode]::text[]
  from products pd left join product_categories cat on cat.id = pd.category_id
  where p_kinds is null or 'product' = any (p_kinds)

  union all
  -- Incomes (payments, checks)
  select 'payment', pm.id, coalesce(oc.name, pc.name, nullif(pm.notes, ''), 'תשלום'), pr.name, pm.payment_date,
    jsonb_build_object('amount', pm.amount_total, 'method', pm.payment_method, 'status', pm.payment_status,
      'date', pm.payment_date, 'order_id', pm.order_id, 'project_id', pm.project_id, 'check_number', pm.check_number),
    array[null, 'פרויקט', 'הערה', 'אסמכתא', 'מספר צ׳ק', 'אמצעי תשלום', 'סטטוס', 'תחום', 'שעת רישום']::text[],
    array[coalesce(oc.name, pc.name), pr.name, pm.notes, pm.reference_number, pm.check_number,
      case lower(pm.payment_method) when 'cash' then 'מזומן' when 'bank_transfer' then 'העברה בנקאית' when 'credit_card' then 'כרטיס אשראי' when 'check' then 'צ׳ק' when 'bit' then 'ביט' when 'other' then 'אחר' when 'card_refund' then 'זיכוי בכרטיס' when 'friend_transfer' then 'הועבר דרך חבר' else pm.payment_method end,
      case pm.payment_status::text when 'pending' then 'תשלום צפוי ממתין' when 'cleared' then 'התקבל נפרע' when 'rejected' then 'נדחה חזר' end,
      case pm.business_domain::text when 'general_business' then 'שוטף' when 'property_management' then 'ניהול נכסים' when 'sales' then 'מכירות' when 'logistics_projects' then 'פרויקטים' when 'home' then 'בית' when 'charity' then 'צדקה' when 'spaceit' then 'ספייסיט' end,
      to_char(pm.created_at at time zone 'Asia/Jerusalem', 'HH24:MI')]::text[],
    array['סכום', 'כולל מע"מ', 'לפני מע"מ', 'נטו']::text[],
    array[pm.amount_total, pm.amount_including_vat, pm.amount_before_vat, pm.net_amount]::numeric[],
    array['תאריך תשלום', 'נרשם', 'מועד פירעון', 'נפרע']::text[],
    array[(pm.payment_date at time zone 'Asia/Jerusalem')::date, (pm.created_at at time zone 'Asia/Jerusalem')::date, pm.due_date, (pm.cleared_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from payments pm
  left join orders o on o.id = pm.order_id
  left join customers oc on oc.id = o.customer_id
  left join projects pr on pr.id = pm.project_id
  left join customers pc on pc.id = pr.customer_id
  where p_kinds is null or 'payment' = any (p_kinds)

  union all
  -- Expenses
  select 'expense', e.id, coalesce(nullif(e.description, ''), nullif(e.category, ''), 'הוצאה'), pr.name, e.expense_date,
    jsonb_build_object('amount', e.amount, 'category', e.category, 'status', e.payment_status, 'date', e.expense_date,
      'method', e.payment_method, 'installment', case when e.installment_count > 1 then e.installment_index || '/' || e.installment_count end),
    array[null, 'קטגוריה', 'הערה', 'אמצעי תשלום', 'פרויקט', 'רכב / תגית', 'חשבון', 'סטטוס', 'תחום', 'שעת רישום']::text[],
    array[e.description, e.category, e.notes,
      case lower(e.payment_method) when 'cash' then 'מזומן' when 'bank_transfer' then 'העברה בנקאית' when 'credit_card' then 'כרטיס אשראי' when 'check' then 'צ׳ק' when 'bit' then 'ביט' when 'other' then 'אחר' else e.payment_method end,
      pr.name, tg.names, a.name,
      case e.payment_status when 'paid' then 'שולם' when 'partial' then 'שולם חלקית' when 'not_paid' then 'לא שולם' end,
      case e.business_domain::text when 'general_business' then 'שוטף' when 'property_management' then 'ניהול נכסים' when 'sales' then 'מכירות' when 'logistics_projects' then 'פרויקטים' when 'home' then 'בית' when 'charity' then 'צדקה' when 'spaceit' then 'ספייסיט' end,
      to_char(e.created_at at time zone 'Asia/Jerusalem', 'HH24:MI')]::text[],
    array['סכום', 'שולם']::text[], array[e.amount, e.paid_amount]::numeric[],
    array['תאריך הוצאה', 'שולם בתאריך', 'תאריך עסקה', 'נרשם']::text[],
    array[(e.expense_date at time zone 'Asia/Jerusalem')::date, e.paid_date, e.transaction_date, (e.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from expenses e
  left join projects pr on pr.id = e.project_id
  left join accounts a on a.id = e.account_id
  left join tagged tg on tg.entity_type = 'expense' and tg.entity_id = e.id
  where p_kinds is null or 'expense' = any (p_kinds)

  union all
  -- Payments to workers
  select 'worker_payment', wp.id, coalesce(u.full_name, 'עובד'), null, wp.payment_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('amount', wp.amount, 'method', wp.payment_method, 'date', wp.payment_date, 'user_id', wp.user_id),
    array[null, 'הערה', 'אסמכתא', 'אמצעי תשלום', 'שעת רישום']::text[],
    array[u.full_name, wp.notes, wp.reference_number,
      case lower(wp.payment_method) when 'cash' then 'מזומן' when 'bank_transfer' then 'העברה בנקאית' when 'check' then 'צ׳ק' when 'bit' then 'ביט' else wp.payment_method end,
      to_char(wp.created_at at time zone 'Asia/Jerusalem', 'HH24:MI')]::text[],
    array['סכום']::text[], array[wp.amount]::numeric[],
    array['תאריך תשלום', 'נרשם']::text[], array[wp.payment_date, (wp.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from worker_payments wp left join users u on u.id = wp.user_id
  where p_kinds is null or 'worker_payment' = any (p_kinds)

  union all
  -- Shifts (attendance)
  select 'shift', s.id, coalesce(u.full_name, 'עובד'), pr.name, s.clock_in,
    jsonb_build_object('clock_in', s.clock_in, 'clock_out', s.clock_out, 'minutes', s.worked_minutes, 'user_id', s.user_id, 'cost', s.labor_cost),
    array[null, 'פרויקט', 'הערה', 'הערה', 'שעות']::text[],
    array[u.full_name, pr.name, s.notes, s.notes_he,
      to_char(s.clock_in at time zone 'Asia/Jerusalem', 'HH24:MI') || coalesce('–' || to_char(s.clock_out at time zone 'Asia/Jerusalem', 'HH24:MI'), '')]::text[],
    array['עלות', 'לחיוב הלקוח']::text[], array[s.labor_cost, s.bill_to_customer_amount]::numeric[],
    array['משמרת']::text[], array[(s.clock_in at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from attendance_sessions s
  left join users u on u.id = s.user_id
  left join projects pr on pr.id = s.project_id
  where p_kinds is null or 'shift' = any (p_kinds)

  union all
  -- Phone attendance reports
  select 'attendance_report', r.id, coalesce(u.full_name, 'עובד'),
    case r.status when 'pending_review' then 'ממתין לאישור' when 'approved' then 'אושר' when 'rejected' then 'נדחה' end,
    r.clock_in,
    jsonb_build_object('clock_in', r.clock_in, 'clock_out', r.clock_out, 'minutes', r.worked_minutes, 'user_id', r.user_id),
    array[null, 'הערה', 'הערה', 'סטטוס', 'שעות']::text[],
    array[u.full_name, r.notes, r.notes_he,
      case r.status when 'pending_review' then 'ממתין לאישור' when 'approved' then 'אושר' when 'rejected' then 'נדחה' end,
      to_char(r.clock_in at time zone 'Asia/Jerusalem', 'HH24:MI') || coalesce('–' || to_char(r.clock_out at time zone 'Asia/Jerusalem', 'HH24:MI'), '')]::text[],
    '{}', '{}',
    array['דיווח שעות', 'נשלח']::text[], array[(r.clock_in at time zone 'Asia/Jerusalem')::date, (r.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from phone_attendance_reports r left join users u on u.id = r.user_id
  where p_kinds is null or 'attendance_report' = any (p_kinds)

  union all
  -- Worker absences
  select 'absence', wa.id, coalesce(u.full_name, 'עובד'), wa.absence_type, wa.absence_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('date', wa.absence_date, 'paid', wa.paid, 'user_id', wa.user_id),
    array[null, 'סוג', 'הערה']::text[],
    array[concat_ws(' ', u.full_name, 'היעדרות'), wa.absence_type, wa.notes]::text[],
    '{}', '{}',
    array['היעדרות']::text[], array[wa.absence_date],
    null, null, null, '{}', '{}'
  from worker_absences wa left join users u on u.id = wa.user_id
  where p_kinds is null or 'absence' = any (p_kinds)

  union all
  -- Workers
  select 'worker', u.id, coalesce(nullif(u.full_name, ''), u.email), u.email, u.created_at,
    jsonb_build_object('role', u.role, 'active', u.active, 'phone', u.phone),
    array[null, 'אימייל', 'הערה', 'תפקיד']::text[],
    array[u.full_name, u.email, u.notes,
      case u.role::text when 'admin' then 'מנהל' when 'office' then 'משרד' when 'worker' then 'עובד' when 'worker_no_access' then 'עובד ללא גישה' end]::text[],
    '{}', '{}', '{}', '{}', null, null, null,
    array['טלפון']::text[], array[u.phone]::text[]
  from users u
  where p_kinds is null or 'worker' = any (p_kinds)

  union all
  -- Salary agreements
  select 'salary', sa.id, coalesce(u.full_name, 'עובד'),
    case sa.salary_type when 'hourly' then 'שכר שעתי' when 'monthly' then 'שכר חודשי' end,
    sa.valid_from::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('type', sa.salary_type, 'hourly', sa.hourly_rate, 'monthly', sa.monthly_salary, 'user_id', sa.user_id),
    array[null, 'סוג שכר', 'הערה']::text[],
    array[u.full_name, case sa.salary_type when 'hourly' then 'שכר שעתי' when 'monthly' then 'שכר חודשי' end, sa.notes]::text[],
    array['שכר לשעה', 'שכר חודשי', 'שעות נוספות']::text[], array[sa.hourly_rate, sa.monthly_salary, sa.overtime_rate]::numeric[],
    array['בתוקף מ', 'בתוקף עד']::text[], array[sa.valid_from, sa.valid_to],
    null, null, null, '{}', '{}'
  from salary_agreements sa left join users u on u.id = sa.user_id
  where p_kinds is null or 'salary' = any (p_kinds)

  union all
  -- Payslips
  select 'payslip', ps.id, coalesce(u.full_name, 'עובד'), pp.period_month,
    pp.start_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('gross', ps.gross_salary, 'month', pp.period_month, 'user_id', ps.user_id),
    array[null, 'חודש', 'הערה']::text[],
    array[u.full_name, pp.period_month, ps.notes]::text[],
    array['ברוטו', 'שכר בסיס', 'תיקונים']::text[], array[ps.gross_salary, ps.calculated_base_salary, ps.manual_adjustments]::numeric[],
    '{}', '{}', null, null, null, '{}', '{}'
  from payslips ps
  left join users u on u.id = ps.user_id
  left join payroll_periods pp on pp.id = ps.payroll_period_id
  where p_kinds is null or 'payslip' = any (p_kinds)

  union all
  -- Documents (+ what they belong to: customer, project, task, property, worker, car)
  select 'document', d.id, coalesce(nullif(d.title, ''), d.file_name, 'מסמך'),
    nullif(concat_ws(' · ', tg.names, dl2.names), ''),
    d.uploaded_at,
    jsonb_build_object('type', coalesce(cat.label, d.document_type), 'uploaded_at', d.uploaded_at, 'doc_date', d.doc_date,
      'amount', d.amount, 'valid_until', d.valid_until),
    array[null, 'קובץ', 'הערה', 'סוג', 'שייך ל', 'רכב / תגית', 'שעת העלאה']::text[],
    array[d.title, d.file_name, d.notes, coalesce(cat.label, d.document_type), dl2.names, tg.names,
      to_char(d.uploaded_at at time zone 'Asia/Jerusalem', 'HH24:MI')]::text[],
    array['סכום']::text[], array[d.amount]::numeric[],
    array['תאריך המסמך', 'הועלה', 'בתוקף עד']::text[],
    array[d.doc_date, (d.uploaded_at at time zone 'Asia/Jerusalem')::date, d.valid_until],
    null, null, null, '{}', '{}'
  from documents d
  left join document_categories cat on cat.code = d.document_type
  left join doclinks dl2 on dl2.document_id = d.id
  left join tagged tg on tg.entity_type = 'document' and tg.entity_id = d.id
  where p_kinds is null or 'document' = any (p_kinds)

  union all
  -- Vehicles and other tags (+ the documents filed under them)
  select 'vehicle', tg.id, tg.name,
    nullif(concat_ws(' · ', v.make_model, v.license_plate), ''),
    tg.created_at,
    jsonb_build_object('kind', tg.kind, 'plate', v.license_plate, 'test', v.test_due_date, 'insurance', v.insurance_due_date,
      'license', v.license_due_date, 'inactive', tg.is_active is false),
    array[null, 'מספר רישוי', 'דגם', 'בעלים', 'הערה', 'הערה', 'שנה', 'מסמך', 'סוג']::text[],
    array[tg.name, v.license_plate, v.make_model, v.owner_name, tg.notes, v.notes, v.year::text, vd.titles,
      case tg.kind when 'vehicle' then 'רכב' when 'campaign' then 'קמפיין' when 'equipment' then 'ציוד' when 'event' then 'אירוע' when 'vendor' then 'ספק' else 'תגית' end]::text[],
    array['קילומטראז׳']::text[], array[v.mileage::numeric],
    array['טסט', 'ביטוח', 'רישיון רכב']::text[], array[v.test_due_date, v.insurance_due_date, v.license_due_date],
    null, null, null,
    array['מספר רישוי']::text[], array[v.license_plate]::text[]
  from tags tg
  left join vehicles v on v.tag_id = tg.id
  left join vdocs vd on vd.tag_id = tg.id
  where p_kinds is null or 'vehicle' = any (p_kinds)

  union all
  -- Communications log
  select 'communication', cl.id, coalesce(c.name, 'תקשורת'),
    case cl.channel when 'phone' then 'שיחה' when 'whatsapp' then 'וואטסאפ' when 'email' then 'אימייל' else cl.channel end,
    cl.created_at,
    jsonb_build_object('channel', cl.channel, 'date', cl.created_at, 'customer_id', cl.customer_id),
    array[null, 'תוכן', 'ערוץ', 'נושא', 'שעה']::text[],
    array[c.name, cl.content,
      case cl.channel when 'phone' then 'שיחה טלפון' when 'whatsapp' then 'וואטסאפ' when 'email' then 'אימייל' else cl.channel end,
      cl.category,
      to_char(cl.created_at at time zone 'Asia/Jerusalem', 'HH24:MI')]::text[],
    '{}', '{}',
    array['תאריך']::text[], array[(cl.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from communication_logs cl left join customers c on c.id = cl.customer_id
  where p_kinds is null or 'communication' = any (p_kinds)

  union all
  -- Reminders someone set by hand (the system's own alerts are left out)
  select 'reminder', rm.id, coalesce(nullif(rm.title, ''), left(rm.content, 80), 'תזכורת'), null,
    coalesce(rm.remind_at, rm.reminder_at, rm.created_at),
    jsonb_build_object('when', coalesce(rm.remind_at, rm.reminder_at), 'task_id', rm.task_id, 'status', rm.status),
    array[null, 'תוכן', 'שעה']::text[],
    array[rm.title, rm.content,
      to_char(coalesce(rm.remind_at, rm.reminder_at) at time zone 'Asia/Jerusalem', 'HH24:MI')]::text[],
    '{}', '{}',
    array['מועד', 'נוצרה']::text[],
    array[(coalesce(rm.remind_at, rm.reminder_at) at time zone 'Asia/Jerusalem')::date, (rm.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from reminders rm
  where rm.source = 'manual' and (p_kinds is null or 'reminder' = any (p_kinds))

  union all
  -- Loans
  select 'loan', l.id,
    coalesce(lc.name, case when l.direction = 'taken' then l.lender else l.borrower end, l.lender, l.borrower, 'הלוואה'),
    case l.direction when 'taken' then 'הלוואה שקיבלנו' when 'given' then 'הלוואה שנתנו' end,
    l.loan_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('amount', l.amount, 'direction', l.direction, 'date', l.loan_date, 'due', l.due_date, 'status', l.status),
    array[null, 'מלווה', 'לווה', 'הערה', 'תיעוד', 'סוג']::text[],
    array[coalesce(lc.name, case when l.direction = 'taken' then l.lender else l.borrower end), l.lender, l.borrower, l.notes, l.documentation,
      case l.direction when 'taken' then 'הלוואה שקיבלנו' when 'given' then 'הלוואה שנתנו' end]::text[],
    array['סכום ההלוואה', 'ריבית']::text[], array[l.amount, l.interest_amount]::numeric[],
    array['תאריך ההלוואה', 'מועד החזר', 'נרשם']::text[],
    array[l.loan_date, l.due_date, (l.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from loans l left join customers lc on lc.id = l.counterparty_customer_id
  where p_kinds is null or 'loan' = any (p_kinds)

  union all
  -- Loan repayments
  select 'loan_repayment', lr.id,
    coalesce(lc.name, case when l.direction = 'taken' then l.lender else l.borrower end, 'הלוואה'),
    'החזר הלוואה', lr.repayment_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('amount', lr.amount, 'date', lr.repayment_date, 'loan_id', lr.loan_id, 'method', lr.method, 'status', lr.status),
    array[null, 'הערה', 'אמצעי']::text[],
    array[coalesce(lc.name, case when l.direction = 'taken' then l.lender else l.borrower end),
      concat_ws(' ', lr.notes, 'החזר הלוואה'),
      case lower(lr.method) when 'cash' then 'מזומן' when 'bank_transfer' then 'העברה בנקאית' when 'check' then 'צ׳ק' else lr.method end]::text[],
    array['סכום ההחזר', 'ריבית']::text[], array[lr.amount, lr.interest_amount]::numeric[],
    array['תאריך החזר', 'נרשם']::text[], array[lr.repayment_date, (lr.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from loan_repayments lr
  join loans l on l.id = lr.loan_id
  left join customers lc on lc.id = l.counterparty_customer_id
  where p_kinds is null or 'loan_repayment' = any (p_kinds)

  union all
  -- Transfers between accounts
  select 'transfer', tr.id, concat_ws(' ← ', ta.name, fa.name), 'העברה בין חשבונות',
    tr.transfer_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('amount', tr.amount, 'date', tr.transfer_date, 'from_account_id', tr.from_account_id, 'to_account_id', tr.to_account_id),
    array[null, 'מחשבון', 'לחשבון', 'הערה']::text[],
    array['העברה', fa.name, ta.name, tr.notes]::text[],
    array['סכום']::text[], array[tr.amount]::numeric[],
    array['תאריך העברה', 'נרשם']::text[], array[tr.transfer_date, (tr.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from account_transfers tr
  left join accounts fa on fa.id = tr.from_account_id
  left join accounts ta on ta.id = tr.to_account_id
  where p_kinds is null or 'transfer' = any (p_kinds)

  union all
  -- Bank / cash accounts
  select 'account', a.id, a.name, case a.kind when 'bank' then 'חשבון בנק' when 'cash' then 'קופת מזומן' else a.kind end,
    a.created_at,
    jsonb_build_object('kind', a.kind, 'number', a.account_number, 'inactive', a.is_active is false),
    array[null, 'מספר חשבון', 'הערה', 'סוג']::text[],
    array[a.name, a.account_number, a.notes, case a.kind when 'bank' then 'בנק' when 'cash' then 'מזומן קופה' end]::text[],
    array['יתרת פתיחה']::text[], array[a.opening_balance]::numeric[],
    array['תאריך פתיחה']::text[], array[a.opening_date],
    null, null, null,
    array['מספר חשבון']::text[], array[a.account_number]::text[]
  from accounts a
  where p_kinds is null or 'account' = any (p_kinds)

  union all
  -- Credit-card statement lines not (yet) turned into an expense or income
  select 'card_row', r.id, coalesce(nullif(r.description, ''), 'שורת אשראי'), r.card_label,
    coalesce(r.transaction_date, r.expense_date)::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('amount', r.amount, 'date', coalesce(r.transaction_date, r.expense_date), 'statement_id', r.statement_id),
    array[null, 'קטגוריה', 'הערה', 'כרטיס', 'קובץ']::text[],
    array[r.description, r.category, r.notes, r.card_label, cs.file_name]::text[],
    array['סכום']::text[], array[r.amount]::numeric[],
    array['תאריך חיוב', 'תאריך עסקה']::text[], array[r.expense_date, r.transaction_date],
    null, null, null, '{}', '{}'
  from card_statement_rows r left join card_statements cs on cs.id = r.statement_id
  where r.expense_id is null and r.income_payment_id is null
    and (p_kinds is null or 'card_row' = any (p_kinds))

  union all
  -- Credit-card charges (the monthly total that left the bank)
  select 'card_charge', ch.id, concat_ws(' ', 'חיוב כרטיס', ch.card_label), cs.file_name,
    ch.charge_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('amount', ch.amount, 'date', ch.charge_date, 'statement_id', ch.statement_id),
    array[null, 'הערה', 'קובץ']::text[],
    array[concat_ws(' ', 'חיוב כרטיס אשראי', ch.card_label), ch.notes, cs.file_name]::text[],
    array['סכום החיוב']::text[], array[ch.amount]::numeric[],
    array['תאריך חיוב']::text[], array[ch.charge_date],
    null, null, null, '{}', '{}'
  from card_statement_charges ch left join card_statements cs on cs.id = ch.statement_id
  where p_kinds is null or 'card_charge' = any (p_kinds)

  union all
  -- Uploaded credit-card statements
  select 'card_statement', cs.id, coalesce(cs.file_name, 'דף חיוב'), 'דף חיוב אשראי', cs.created_at,
    jsonb_build_object('rows', cs.total_rows, 'date', cs.created_at),
    array[null, 'מקור']::text[], array[concat_ws(' ', cs.file_name, 'דף חיוב אשראי'), cs.source]::text[],
    '{}', '{}',
    array['הועלה']::text[], array[(cs.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from card_statements cs
  where p_kinds is null or 'card_statement' = any (p_kinds)

  union all
  -- Recurring expenses (templates)
  select 'recurring_expense', rt.id, coalesce(nullif(rt.template_name, ''), rt.category, 'הוצאה קבועה'), rt.category, rt.created_at,
    jsonb_build_object('amount', rt.amount, 'day', rt.expense_day_of_month, 'active', rt.is_active),
    array[null, 'קטגוריה', 'תיאור', 'הערה', 'סוג']::text[],
    array[rt.template_name, rt.category, rt.description_template, rt.notes_template, 'הוצאה קבועה']::text[],
    array['סכום']::text[], array[rt.amount]::numeric[],
    array['מתחילה', 'מסתיימת']::text[], array[rt.start_date, rt.end_date],
    null, null, null, '{}', '{}'
  from recurring_expense_templates rt
  where p_kinds is null or 'recurring_expense' = any (p_kinds)

  union all
  -- Recurring tasks (templates)
  select 'recurring_task', rk.id, coalesce(nullif(rk.subject_template, ''), 'משימה קבועה'), 'משימה קבועה', rk.created_at,
    jsonb_build_object('active', rk.is_active, 'day', rk.due_day_of_month),
    array[null, 'תיאור', 'סוג']::text[],
    array[rk.subject_template, rk.description_template, 'משימה קבועה']::text[],
    '{}', '{}',
    array['מתחילה', 'מסתיימת']::text[], array[rk.start_date, rk.end_date],
    null, null, null, '{}', '{}'
  from recurring_task_templates rk
  where p_kinds is null or 'recurring_task' = any (p_kinds)

  union all
  -- Invoices and receipts issued through Morning (חשבונית ירוקה)
  select 'invoice', md.id, concat_ws(' ', coalesce(md.document_type_label, 'מסמך'), md.morning_document_number), c.name,
    coalesce(md.issued_at, md.created_at),
    jsonb_build_object('amount', md.amount, 'date', coalesce(md.issued_at, md.created_at), 'status', md.status, 'url', md.morning_url),
    array[null, 'לקוח', 'מספר', 'הערה']::text[],
    array[concat_ws(' ', md.document_type_label, md.morning_document_number), c.name, md.morning_document_number, md.notes]::text[],
    array['סכום']::text[], array[md.amount]::numeric[],
    array['הופק', 'נוצר']::text[], array[(md.issued_at at time zone 'Asia/Jerusalem')::date, (md.created_at at time zone 'Asia/Jerusalem')::date],
    null, null, null, '{}', '{}'
  from morning_documents md left join customers c on c.id = md.customer_id
  where p_kinds is null or 'invoice' = any (p_kinds)

  union all
  -- Meetings (+ their items)
  select 'meeting', m.id, 'ישיבה', null, m.meeting_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('date', m.meeting_date, 'status', m.status),
    array[null, 'הערות', 'סעיף']::text[],
    array['ישיבה', m.notes, mi.items]::text[],
    array['יעד גבייה']::text[], array[m.collection_target]::numeric[],
    array['תאריך הישיבה', 'הישיבה הבאה']::text[], array[m.meeting_date, m.next_meeting_date],
    null, null, null, '{}', '{}'
  from meetings m left join mi on mi.meeting_id = m.id
  where p_kinds is null or 'meeting' = any (p_kinds)

  union all
  -- Properties
  select 'property', pp.id, coalesce(nullif(pp.name, ''), pp.address, 'נכס'),
    case when nullif(pp.name, '') is not null then coalesce(nullif(pp.addr_formatted, ''), pp.address) end,
    pp.created_at,
    jsonb_build_object('inactive', pp.is_active is false, 'type', pp.property_type),
    array[null, 'כתובת', 'כתובת', 'תיאור', 'נרכש מ', 'סוג', 'גוש', 'חלקה', 'חוזה חשמל', 'חוזה מים', 'חוזה גז', 'ארנונה', 'ריהוט']::text[],
    array[pp.name, pp.address, pp.addr_formatted, pp.asset_description, pp.purchased_from, pp.property_type, pp.land_block,
      concat_ws(' ', pp.land_parcel, pp.land_sub_parcel), pp.electricity_contract_number, pp.water_contract_number,
      pp.gas_contract_number, pp.arnona_contract_number, array_to_string(pp.furniture_items, ', '),
      pp.management_company_name, pp.management_notes, pp.owner_company_name, pp.owner_company_number,
      pp.owner_company_type, pp.owner_company_notes, pp.zoning, pp.region, pp.tax_account_number]::text[],
    array['מחיר רכישה', 'מס רכישה']::text[], array[pp.purchase_price, pp.purchase_tax]::numeric[],
    array['תאריך רכישה']::text[], array[pp.purchase_date],
    null, null, null, '{}', '{}'
  from properties pp
  where p_kinds is null or 'property' = any (p_kinds)

  union all
  -- Leases
  select 'lease', la.id, coalesce(c.name, 'חוזה שכירות'), coalesce(nullif(pp.name, ''), pp.address), la.start_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('rent', la.monthly_rent_amount, 'start', la.start_date, 'end', la.end_date, 'property_id', la.property_id),
    array[null, 'נכס', 'הערה', 'אסמכתת פיקדון', 'סוג']::text[],
    array[c.name, coalesce(nullif(pp.name, ''), pp.address), la.notes, la.deposit_reference, 'חוזה שכירות']::text[],
    array['שכר דירה', 'פיקדון']::text[], array[la.monthly_rent_amount, la.deposit_amount]::numeric[],
    array['תחילת חוזה', 'סוף חוזה']::text[], array[la.start_date, la.end_date],
    null, null, null, '{}', '{}'
  from lease_agreements la
  left join customers c on c.id = la.customer_id
  left join properties pp on pp.id = la.property_id
  where p_kinds is null or 'lease' = any (p_kinds)

  union all
  -- Payment promises
  select 'promise', pr.id, coalesce(c.name, 'הבטחת תשלום'), 'הבטחת תשלום', pr.promised_date::timestamp at time zone 'Asia/Jerusalem',
    jsonb_build_object('amount', pr.amount, 'date', pr.promised_date, 'status', pr.status),
    array[null, 'הערה', 'סוג']::text[],
    array[c.name, pr.notes, 'הבטחת תשלום']::text[],
    array['סכום']::text[], array[pr.amount]::numeric[],
    array['תאריך מובטח']::text[], array[pr.promised_date],
    null, null, null, '{}', '{}'
  from payment_promises pr left join customers c on c.id = pr.customer_id
  where p_kinds is null or 'promise' = any (p_kinds)
),

-- ── match ───────────────────────────────────────────────────────────────────
-- Only the record's own columns and the patterns above, so the database checks
-- each table's rows before building anything else for them.
hit as (
  select s.*
  from src s
  where array_to_string(s.tv, ' ') ~* all (v_tre)
    and (v_ns < 1
      or coalesce(array_to_string(s.tv, ' ') ~* v_sre[1], false)
      or coalesce(v_sa[1] = any (s.av), false)
      or coalesce(v_sd[1] = any (s.dv), false)
      or coalesce(v_sd[1] between s.rs and s.re, false)
      or coalesce(array_to_string(s.pv, ' ; ') ~ v_sp[1], false))
    and (v_ns < 2
      or coalesce(array_to_string(s.tv, ' ') ~* v_sre[2], false)
      or coalesce(v_sa[2] = any (s.av), false)
      or coalesce(v_sd[2] = any (s.dv), false)
      or coalesce(v_sd[2] between s.rs and s.re, false)
      or coalesce(array_to_string(s.pv, ' ; ') ~ v_sp[2], false))
    and (v_ns < 3
      or coalesce(array_to_string(s.tv, ' ') ~* v_sre[3], false)
      or coalesce(v_sa[3] = any (s.av), false)
      or coalesce(v_sd[3] = any (s.dv), false)
      or coalesce(v_sd[3] between s.rs and s.re, false)
      or coalesce(array_to_string(s.pv, ' ; ') ~ v_sp[3], false))
),
scored as (
  select h.*,
    -- found only through a corrected spelling → after everything found as typed
    (case when array_to_string(h.tv, ' ') ~* all (v_tre_exact) then 0 else 5 end)
    + greatest(
        -- a worker's shift / payslip / … carries the worker's name as its title,
        -- but it is not what someone typing that name is looking for first
        case when h.kind in ('shift', 'attendance_report', 'absence', 'salary', 'payslip', 'lease', 'promise') then 3 else 0 end,
        case
          when v_qre is null or cardinality(v_tre_ws) = 0 then 3
          -- the title is what was typed / starts with it / holds every word
          when h.title ~* ('^[^0-9a-zא-ת]*' || v_qre || '[^0-9a-zא-ת]*$') then 0
          when h.title ~* ('^[^0-9a-zא-ת]*' || v_qre) then 1
          when h.title ~* all (v_tre_ws) then 2
          -- every word found as a word somewhere (צ׳ק as the payment method)
          when array_to_string(h.tv, ' ') ~* all (v_tre_ws) then 3
          -- only inside longer words (צק in לוצק)
          else 4 end) as rk
  from hit h
),
ranked as (
  select s.*,
    row_number() over (partition by s.kind order by s.rk, s.at desc nulls last, s.id) as rn,
    count(*) over (partition by s.kind) as cnt
  from scored s
)
select
  r.kind, r.id, r.title, r.subtitle, r.at, r.info,
  (
    select coalesce(jsonb_agg(y.x), '[]'::jsonb)
    from (
      -- the date that matched (or the range it falls in)
      (select jsonb_build_object('k', 'date', 'l', d.l, 'v', d.v) as x
       from (
         select 1 as o, i, coalesce(r.dl[i], r.dl[cardinality(r.dl)]) as l, r.dv[i]::text as v
         from generate_subscripts(r.dv, 1) i
         where r.dv[i] = any (v_dts)
         union all
         select 2, 0, r.rl, r.rs::text || '/' || r.re::text
         where r.rs is not null and exists (select 1 from unnest(v_dts) dd where dd between r.rs and r.re)
       ) d
       order by d.o, d.i limit 1)
      union all
      -- the amount that matched
      (select jsonb_build_object('k', 'amount', 'l', coalesce(r.al[i], r.al[cardinality(r.al)]), 'v', r.av[i]::text)
       from generate_subscripts(r.av, 1) i
       where r.av[i] = any (v_amts)
       order by i limit 1)
      union all
      -- the phone that matched
      (select jsonb_build_object('k', 'phone', 'l', coalesce(r.pl[i], r.pl[cardinality(r.pl)], 'טלפון'), 'v', r.pv[i])
       from generate_subscripts(r.pv, 1) i
       where r.pv[i] is not null
         and exists (select 1 from unnest(v_sp) sp where sp is not null and r.pv[i] ~ sp)
       order by i limit 1)
      union all
      -- the first word field (not already in the title) that holds a token
      (select jsonb_build_object('k', 'text', 'l', r.tl[i], 'v', r.tv[i])
       from generate_subscripts(r.tv, 1) i
       where r.tl[i] is not null and nullif(btrim(r.tv[i]), '') is not null
         and r.tv[i] ~* any (v_allres)
       order by i limit 1)
    ) y
  ),
  r.rk::integer,
  r.cnt
from ranked r
where r.rn <= greatest(1, least(coalesce(p_limit, 5), 500))
order by r.kind, r.rn;
end;
$fn$;

revoke all on function public.global_search(jsonb, text, text[], integer) from public, anon;
grant execute on function public.global_search(jsonb, text, text[], integer) to authenticated;

comment on function public.global_search(jsonb, text, text[], integer) is
  'The global search bar and the orders / projects page searches: every kind of record (an order with its payments, a project with its payments, expenses, shifts and tasks) matched against the query''s tokens (words, amounts, dates, hours, phones), with the reasons each one matched. Invoker rights.';
