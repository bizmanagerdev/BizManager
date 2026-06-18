// Copies every file in the Supabase Storage bucket from the OLD project to the
// NEW (Frankfurt) project. A database dump does NOT move Storage files, so run
// this after restoring the database into the new project.
//
// Uploading each file recreates its storage.objects metadata row automatically,
// so there's nothing else to migrate for Storage.
//
// Usage (PowerShell/bash), from the project root:
//   OLD_SUPABASE_URL=https://OLDREF.supabase.co \
//   OLD_SERVICE_ROLE_KEY=... \
//   NEW_SUPABASE_URL=https://NEWREF.supabase.co \
//   NEW_SERVICE_ROLE_KEY=... \
//   node scripts/migrate-storage.mjs
//
// (BUCKET defaults to business-documents; override with BUCKET=...)
import { createClient } from "@supabase/supabase-js";

const OLD_URL = process.env.OLD_SUPABASE_URL;
const OLD_KEY = process.env.OLD_SERVICE_ROLE_KEY;
const NEW_URL = process.env.NEW_SUPABASE_URL;
const NEW_KEY = process.env.NEW_SERVICE_ROLE_KEY;
const BUCKET = process.env.BUCKET || "business-documents";

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY) {
  console.error(
    "Missing env. Required: OLD_SUPABASE_URL, OLD_SERVICE_ROLE_KEY, NEW_SUPABASE_URL, NEW_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const oldClient = createClient(OLD_URL, OLD_KEY, { auth: { persistSession: false } });
const newClient = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

// Storage list() returns up to `limit` entries per call and does not recurse,
// so we paginate and walk folders (folders come back with id === null).
async function listAll(client, prefix = "") {
  const out = [];
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await client.storage
      .from(BUCKET)
      .list(prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list "${prefix}": ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) out.push(...(await listAll(client, path)));
      else out.push(path);
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function ensureBucket() {
  const { data } = await newClient.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await newClient.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
  console.log(`Created bucket "${BUCKET}" on the target project (private).`);
}

async function main() {
  await ensureBucket();
  console.log("Listing files on the old project...");
  const files = await listAll(oldClient);
  console.log(`Found ${files.length} files in "${BUCKET}".`);

  let done = 0;
  let failed = 0;
  const failures = [];
  for (const path of files) {
    try {
      const { data: blob, error: dErr } = await oldClient.storage.from(BUCKET).download(path);
      if (dErr) throw dErr;
      const buf = Buffer.from(await blob.arrayBuffer());
      const { error: uErr } = await newClient.storage.from(BUCKET).upload(path, buf, {
        upsert: true,
        contentType: blob.type || "application/octet-stream",
      });
      if (uErr) throw uErr;
      done++;
      if (done % 25 === 0 || done === files.length) console.log(`  copied ${done}/${files.length}`);
    } catch (e) {
      failed++;
      failures.push(path);
      console.error(`  FAILED ${path}: ${e?.message ?? e}`);
    }
  }

  console.log(`\nDone. Copied ${done}, failed ${failed}, total ${files.length}.`);
  if (failures.length) {
    console.log("Failed files (re-run to retry — upload uses upsert so copies are safe):");
    failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
