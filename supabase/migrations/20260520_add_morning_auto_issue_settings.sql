-- Singleton table that controls Morning auto-issue behaviors:
--  * auto_invoice_on_order_completion: when an order's status moves to a completion
--    state (delivered/completed/closed/Hebrew equivalents), automatically issue a
--    Morning tax invoice (305) or tax-invoice-receipt (320).
--  * auto_receipt_on_payment: when a payment row is created, automatically issue a
--    Morning receipt (400) or tax-invoice-receipt (320).
-- Document type codes mirror MorningDocumentType in lib/morning/types.ts.

CREATE TABLE IF NOT EXISTS public.morning_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  auto_invoice_on_order_completion boolean NOT NULL DEFAULT false,
  invoice_type_on_completion smallint NOT NULL DEFAULT 305
    CHECK (invoice_type_on_completion IN (305, 320)),
  auto_receipt_on_payment boolean NOT NULL DEFAULT false,
  receipt_type_on_payment smallint NOT NULL DEFAULT 400
    CHECK (receipt_type_on_payment IN (400, 320)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id)
);

INSERT INTO public.morning_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- Row-level security: any active system user can read settings (the auto-issue logic
-- runs as the user who triggered the order/payment update), only admins can change them.
ALTER TABLE public.morning_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "System users can read morning settings" ON public.morning_settings;
CREATE POLICY "System users can read morning settings"
ON public.morning_settings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.active = true
      AND COALESCE(u.system_access, false) = true
  )
);

DROP POLICY IF EXISTS "Admins can manage morning settings" ON public.morning_settings;
CREATE POLICY "Admins can manage morning settings"
ON public.morning_settings
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.active = true
      AND COALESCE(u.system_access, false) = true
      AND u.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.active = true
      AND COALESCE(u.system_access, false) = true
      AND u.role = 'admin'
  )
);
