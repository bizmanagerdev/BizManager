-- Register the "תשלומים לתשלום" (outgoing bills due) live rule in the unified
-- alert center so it can be toggled/edited in Settings → התראות. Run in the
-- Supabase SQL Editor. Idempotent.
--
-- Rule: unpaid (or partly-paid) expenses whose pay date has arrived (overdue /
-- today) or is a few days away (heads-up) surface as ONE silent summary line in
-- "מה דורש טיפול", linking to the payments calendar where they get paid. Matches
-- the calendar's outflow set (bills, taxes, recurring, installments, hand-added
-- payments); wages are covered separately by wage_overdue.

insert into public.push_alert_config (title, body, url, mode, rule_key, audience_role, enabled, send_hour_israel)
values ('תשלומים לתשלום', '', '/financial/payments-calendar', 'live', 'payment_outflow_due', 'office', true, 8)
on conflict (rule_key) where rule_key is not null do nothing;
