alter table public.payments
  drop constraint if exists payment_amounts_valid;

alter table public.payments
  drop constraint if exists payments_split_consistency_chk;

alter table public.payments
  add constraint payments_split_consistency_chk
  check (
    (
      requires_split = false
      and amount_total is not null
      and round(net_amount::numeric, 2) = round(amount_total::numeric, 2)
      and amount_including_vat is null
      and amount_before_vat is null
    )
    or
    (
      requires_split = true
      and amount_total is not null
      and amount_including_vat is not null
      and amount_before_vat is not null
      and round(amount_including_vat::numeric, 2) = round(amount_total::numeric, 2)
      and round(net_amount::numeric, 2) = round(amount_before_vat::numeric, 2)
    )
  );
