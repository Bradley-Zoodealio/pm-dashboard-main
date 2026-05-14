#!/usr/bin/env tsx
// Apply supabase/migrations/*.sql in lexical order to the connection in POSTGRES_URL_NON_POOLING (or POSTGRES_URL).
// Idempotent if migrations use `if not exists` guards; otherwise re-running may error.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: ".env.local" });

const rawUrl = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!rawUrl) {
  console.error("POSTGRES_URL_NON_POOLING (or POSTGRES_URL) is not set in .env.local");
  process.exit(1);
}

// Strip sslmode from the URL so our explicit ssl object below wins. Supabase certs
// are signed by a chain Node doesn't trust by default; rejectUnauthorized=false is
// fine for a one-shot admin migration over the pgbouncer/direct connection.
const url = rawUrl.replace(/[?&]sslmode=[^&]+/g, "").replace(/\?$/, "");

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

if (files.length === 0) {
  console.log("No migrations to apply.");
  process.exit(0);
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false, require: true } as never,
});

async function run() {
  await client.connect();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    console.log(`Applying ${file} (${sql.length} bytes)…`);
    await client.query(sql);
    console.log(`  ✓ ${file}`);
  }
}

run()
  .catch((err) => {
    console.error("Migration failed:", err.message ?? err);
    process.exit(1);
  })
  .finally(() => client.end());
