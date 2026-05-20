-- RLS for morning_documents. The original create_morning_integration.sql created
-- the table without policies, so writes from the application (running under the
-- end-user's auth) are rejected by the default-deny RLS behaviour.
--
-- Policies:
--  * Any active system user can SELECT (order/project/payment detail pages list
--    Morning documents for context, including office and worker roles).
--  * Admin and office can INSERT/UPDATE (they issue, sync, and close documents).
--  * No public DELETE — Morning documents are part of the tax-audit trail and
--    should be cancelled on Morning's side via the "סגירה" flow, not deleted.

ALTER TABLE public.morning_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "System users can read morning documents" ON public.morning_documents;
CREATE POLICY "System users can read morning documents"
ON public.morning_documents
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

DROP POLICY IF EXISTS "Admins and office can insert morning documents" ON public.morning_documents;
CREATE POLICY "Admins and office can insert morning documents"
ON public.morning_documents
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.active = true
      AND COALESCE(u.system_access, false) = true
      AND u.role IN ('admin', 'office')
  )
);

DROP POLICY IF EXISTS "Admins and office can update morning documents" ON public.morning_documents;
CREATE POLICY "Admins and office can update morning documents"
ON public.morning_documents
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.active = true
      AND COALESCE(u.system_access, false) = true
      AND u.role IN ('admin', 'office')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.active = true
      AND COALESCE(u.system_access, false) = true
      AND u.role IN ('admin', 'office')
  )
);
