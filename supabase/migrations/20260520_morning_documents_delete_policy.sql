-- Allow admins to DELETE rows from morning_documents.
-- This complements the INSERT/UPDATE policies added earlier — admin users
-- can unlink a Morning document on the BizH side via the UI (the document
-- still exists in Morning; this only removes the BizH-side bookkeeping row).

DROP POLICY IF EXISTS "Admins can delete morning documents" ON public.morning_documents;
CREATE POLICY "Admins can delete morning documents"
ON public.morning_documents
FOR DELETE
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
);
