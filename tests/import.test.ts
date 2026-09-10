import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("import rolls back failed verification; IDs, dates and revisions round-trip; repeat preserves edits", async () => {
  const source =
    process.env.DATABASE_URL ??
    "postgres://flashback:flashback_local@127.0.0.1:5437/flashback";
  const db = "flashback_import_test_" + Date.now();
  const admin = new pg.Pool({ connectionString: source });
  const url = new URL(source);
  url.pathname = "/" + db;
  await admin.query(`CREATE DATABASE "${db}"`);
  const target = new pg.Pool({ connectionString: url.toString() });
  const dir = await mkdtemp(path.join(tmpdir(), "flashback-import-"));
  const report = {
    id: 70,
    createdUtc: "2020-01-01 00:00 UTC",
    status: "ready_for_test",
    text: "Original",
    context: "seed=1",
    assignedAgent: "codex",
    agentHandoff: "Resume here",
    fixCommit: "abc1234",
    fixCommits: ["abc1234"],
    reportedInVersion: "1",
    readyForTestInVersion: "2",
    fixedInVersion: "",
    archived: false,
    revision: 13,
    comments: [{ whenUtc: "", author: "user", text: "Original date missing" }],
  };
  const snapshot = {
    reports: [report],
    patches: [],
    source: "test",
    capturedUtc: "test",
  };
  const file = path.join(dir, "snapshot.json");
  const run = () =>
    exec(process.execPath, ["--import", "tsx", "scripts/import.ts", file], {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        FLASHBACK_SNAPSHOT_DIR: dir,
      },
    });
  try {
    await writeFile(
      file,
      JSON.stringify({
        ...snapshot,
        reports: [{ ...report, unknownField: "must not silently disappear" }],
      }),
    );
    await assert.rejects(run, /Report verification mismatch/);
    assert.equal(
      (await target.query("SELECT count(*)::int n FROM reports")).rows[0].n,
      0,
    );
    await writeFile(file, JSON.stringify(snapshot));
    await run();
    const actual = (await target.query("SELECT * FROM reports WHERE id=70"))
      .rows[0];
    assert.equal(actual.revision, 13);
    assert.equal(actual.createdUtc, report.createdUtc);
    assert.equal(
      (await target.query('SELECT "whenUtc" FROM comments')).rows[0].whenUtc,
      "",
    );
    await target.query("UPDATE reports SET text='Local edit' WHERE id=70");
    assert.match((await run()).stdout, /Already imported/);
    assert.equal(
      (await target.query("SELECT text FROM reports WHERE id=70")).rows[0].text,
      "Local edit",
    );
    await writeFile(
      file,
      JSON.stringify({
        ...snapshot,
        reports: [{ ...report, text: "Different snapshot" }],
      }),
    );
    await assert.rejects(run, /Database is not empty/);
  } finally {
    await target.end();
    await admin.query(`DROP DATABASE "${db}"`);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
