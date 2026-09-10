import pg, { type PoolClient } from "pg";
import { settings } from "./config.ts";

export const pool = new pg.Pool({
  connectionString: settings.databaseUrl,
  max: 10,
});
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const migrations = [
  `CREATE TABLE reports (
    id SERIAL PRIMARY KEY, "createdUtc" TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('created','in_progress','ready_for_test','fixed','rework')),
    text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', "assignedAgent" TEXT NOT NULL DEFAULT '', "agentHandoff" TEXT NOT NULL DEFAULT '',
    "fixCommit" TEXT NOT NULL DEFAULT '', "reportedInVersion" TEXT NOT NULL DEFAULT '', "readyForTestInVersion" TEXT NOT NULL DEFAULT '',
    "fixedInVersion" TEXT NOT NULL DEFAULT '', archived BOOLEAN NOT NULL DEFAULT false, revision INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE comments ("reportId" INTEGER REFERENCES reports(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL,
    "whenUtc" TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY("reportId",ordinal));
   CREATE TABLE fix_commits ("reportId" INTEGER REFERENCES reports(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, sha TEXT NOT NULL,
    PRIMARY KEY("reportId",ordinal), UNIQUE("reportId",sha));
   CREATE TABLE commit_patches (sha TEXT PRIMARY KEY, data JSONB NOT NULL);
   CREATE TABLE import_history (fingerprint TEXT PRIMARY KEY, "importedUtc" TIMESTAMPTZ NOT NULL DEFAULT now(), count INTEGER NOT NULL);
   CREATE INDEX reports_status_archive_id ON reports(archived,status,id DESC);`,
  `CREATE TABLE access_tokens (
    id UUID PRIMARY KEY, name TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE,
    is_admin BOOLEAN NOT NULL DEFAULT false, allowed_statuses TEXT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by UUID REFERENCES access_tokens(id),
    revoked_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ);
   CREATE TABLE access_sessions (
    secret_hash TEXT PRIMARY KEY, token_id UUID NOT NULL REFERENCES access_tokens(id),
    expires_at TIMESTAMPTZ NOT NULL);
   CREATE INDEX access_sessions_token ON access_sessions(token_id);
   CREATE TABLE report_access (
    id BIGSERIAL PRIMARY KEY, report_id INTEGER NOT NULL,
    token_id UUID NOT NULL REFERENCES access_tokens(id), token_name TEXT NOT NULL,
    action TEXT NOT NULL, status TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now());
   CREATE INDEX report_access_report ON report_access(report_id,id DESC);
   CREATE TABLE patch_access (sha TEXT PRIMARY KEY REFERENCES commit_patches(sha) ON DELETE CASCADE,
    token_id UUID NOT NULL REFERENCES access_tokens(id), token_name TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now());`,
];

export async function migrate() {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(4310001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    for (const [i, sql] of migrations.entries()) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version=$1",
        [i + 1],
      );
      if (!existing.rowCount) {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(version) VALUES($1)",
          [i + 1],
        );
      }
    }
  });
}
