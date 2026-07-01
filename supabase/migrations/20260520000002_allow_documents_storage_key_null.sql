-- Allow `documents.storage_key` to be NULL so we can record external documents
-- (Morning invoices/receipts, etc.) whose binary lives outside our storage bucket.
-- For these rows, `notes` holds the external URL while `storage_key` stays NULL.
-- Local uploaded documents continue to populate storage_key as before.

ALTER TABLE public.documents
  ALTER COLUMN storage_key DROP NOT NULL;
