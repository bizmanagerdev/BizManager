// Single source of truth for the Supabase Storage bucket that holds all business file
// uploads — documents, credit-card statement files, expense/order/task/project
// attachments, and check photos. Centralized so renaming the bucket, or splitting some
// uploads into a different bucket later, is a one-line change instead of a repo-wide hunt.
export const STORAGE_BUCKET = "business-documents";
