-- Vehicle INCOME was invisible to a vehicles-access worker, and — worse —
-- addable but not viewable.
--
-- payments_worker_select_order is the only worker read policy on payments, and
-- it requires `order_id is not null` on an OPEN order. Income booked against a
-- car is standalone (tagged through entity_tags, no order), so the הכנסות card
-- on /vehicles/[id] rendered "אין הכנסות" — while the same car's ₪ figure on
-- the /vehicles list came out right, because that comes from tag_rollup(),
-- which is SECURITY DEFINER and bypasses RLS. The list and the detail page
-- contradicted each other.
--
-- Meanwhile worker_insert_payment (INSERT, unconditional) let him ADD income
-- from that same card: it saved, the toast said so, and it vanished on
-- refresh — the row was there, just unreadable by its own author.
--
-- Same shape as expenses_worker_select_vehicle_tagged (20260907100558) and its
-- delete sibling (20260907102351): active, system-access worker with
-- section_access.vehicles = true, AND the payment is tagged to a kind='vehicle'
-- tag. No UPDATE policy — unlike expenses, the vehicle card has no edit
-- affordance for income (only add + delete), and payments carry allocation and
-- collection logic that stays staff-only.

drop policy if exists "payments_worker_select_vehicle_tagged" on public.payments;
create policy "payments_worker_select_vehicle_tagged" on public.payments
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
    and exists (
      select 1 from public.entity_tags et
      join public.tags t on t.id = et.tag_id
      where et.entity_type = 'payment'
        and et.entity_id = payments.id
        and t.kind = 'vehicle'
    )
  );

drop policy if exists "payments_worker_delete_vehicle_tagged" on public.payments;
create policy "payments_worker_delete_vehicle_tagged" on public.payments
  for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
    and exists (
      select 1 from public.entity_tags et
      join public.tags t on t.id = et.tag_id
      where et.entity_type = 'payment'
        and et.entity_id = payments.id
        and t.kind = 'vehicle'
    )
  );
