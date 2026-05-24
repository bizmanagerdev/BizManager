-- Add a free-text notes column to morning_documents so admins can annotate
-- a Morning document on the BizH side (e.g., "wrong customer, see #1234").
-- This does NOT propagate back to Morning — it's purely BizH metadata.

ALTER TABLE public.morning_documents
  ADD COLUMN IF NOT EXISTS notes text;
