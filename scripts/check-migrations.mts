import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const migrationsDir = path.resolve("supabase/migrations");
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  fail("No Supabase migrations found.");
}

const seen = new Set<string>();
let previousTimestamp = "";

for (const file of files) {
  const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match) {
    fail(
      `${file} must use the format YYYYMMDDHHMMSS_lower_snake_name.sql.`,
    );
  }

  const timestamp = match[1];
  if (seen.has(timestamp)) {
    fail(`${file} reuses migration timestamp ${timestamp}.`);
  }
  seen.add(timestamp);

  if (previousTimestamp && timestamp <= previousTimestamp) {
    fail(`${file} is not strictly newer than the previous migration.`);
  }
  previousTimestamp = timestamp;

  const sql = readFileSync(path.join(migrationsDir, file), "utf8");
  if (sql.trim().length === 0) {
    fail(`${file} is empty.`);
  }
  if (!sql.endsWith("\n")) {
    fail(`${file} must end with a newline.`);
  }
}

console.log(`Checked ${files.length} Supabase migration${files.length === 1 ? "" : "s"}.`);

function fail(message: string): never {
  console.error(`Migration check failed: ${message}`);
  process.exit(1);
}
