-- Rollback for 20261011200000_search_activity.sql: removes the activity page's
-- search. The page's search box then answers with an error; nothing else uses it.

drop function if exists public.search_activity(text, text[], numeric, text, text[], uuid[], timestamptz, uuid, integer);
