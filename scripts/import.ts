import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pool, migrate, transaction } from "../apps/server/src/database.ts";
import { root } from "../apps/server/src/config.ts";
import { listReports } from "../apps/server/src/store.ts";
import type { Report, CommitPatch } from "@flashback/contracts";

const source =
  process.env.HEXLIVE_SOURCE_API ??
  "https://163-245-204-96.sslip.io/api/bugs/v1";
async function fetchJSON(route: string) {
  const r = await fetch(source + route, {
    signal: AbortSignal.timeout(30000),
    headers: process.env.HEXLIVE_BUG_TOKEN
      ? { Authorization: "Bearer " + process.env.HEXLIVE_BUG_TOKEN }
      : {},
  });
  if (!r.ok) throw new Error(`Source returned ${r.status} for ${route}`);
  return r.json();
}
const stable = (value: any): any =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, stable(value[k])]),
        )
      : value;
try {
  await migrate();
  let snapshot: {
    reports: Report[];
    patches: CommitPatch[];
    source: string;
    capturedUtc: string;
  };
  const input = process.argv[2];
  if (input) snapshot = JSON.parse(await readFile(input, "utf8"));
  else {
    const reports: Report[] = await fetchJSON("/reports");
    const shas: string[] = await fetchJSON("/commits");
    const patches: CommitPatch[] = [];
    for (let i = 0; i < shas.length; i += 8)
      patches.push(
        ...(await Promise.all(
          shas.slice(i, i + 8).map((sha) => fetchJSON("/commits/" + sha)),
        )),
      );
    snapshot = {
      reports,
      patches,
      source,
      capturedUtc: new Date().toISOString(),
    };
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        stable({ reports: snapshot.reports, patches: snapshot.patches }),
      ),
    )
    .digest("hex");
  const snapshotDir =
    process.env.FLASHBACK_SNAPSHOT_DIR ?? path.join(root, "data");
  await mkdir(snapshotDir, { recursive: true });
  const snapshotFile = path.join(
    snapshotDir,
    `hexlive-${fingerprint.slice(0, 12)}.json`,
  );
  await writeFile(snapshotFile, JSON.stringify(snapshot, null, 2), {
    mode: 0o600,
  });
  const result = await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(4310002)");
    await db.query(
      "LOCK TABLE reports,comments,fix_commits,commit_patches IN ACCESS EXCLUSIVE MODE",
    );
    if (
      (
        await db.query("SELECT 1 FROM import_history WHERE fingerprint=$1", [
          fingerprint,
        ])
      ).rowCount
    )
      return "Already imported; existing edits preserved.";
    if ((await db.query("SELECT 1 FROM reports LIMIT 1")).rowCount)
      throw new Error(
        "Database is not empty. Import refused: use a new instance to avoid overwriting local changes.",
      );
    const fields = [
      "id",
      "createdUtc",
      "status",
      "text",
      "context",
      "assignedAgent",
      "agentHandoff",
      "fixCommit",
      "reportedInVersion",
      "readyForTestInVersion",
      "fixedInVersion",
      "archived",
      "revision",
    ] as const;
    for (const r of snapshot.reports) {
      await db.query(
        `INSERT INTO reports (${fields.map((k) => `"${k}"`).join(",")}) VALUES (${fields.map((_, i) => "$" + (i + 1)).join(",")})`,
        fields.map((k) => r[k]),
      );
      for (const [i, c] of r.comments.entries())
        await db.query("INSERT INTO comments VALUES($1,$2,$3,$4,$5)", [
          r.id,
          i,
          c.whenUtc,
          c.author,
          c.text,
        ]);
      for (const [i, sha] of r.fixCommits.entries())
        await db.query("INSERT INTO fix_commits VALUES($1,$2,$3)", [
          r.id,
          i,
          sha,
        ]);
    }
    for (const patch of snapshot.patches)
      await db.query("INSERT INTO commit_patches VALUES($1,$2)", [
        patch.sha,
        patch,
      ]);
    await db.query(
      "SELECT setval(pg_get_serial_sequence('reports','id'),COALESCE((SELECT max(id) FROM reports),1),EXISTS(SELECT 1 FROM reports))",
    );
    await db.query(
      "INSERT INTO import_history(fingerprint,count) VALUES($1,$2)",
      [fingerprint, snapshot.reports.length],
    );
    const actual = await listReports(undefined, true, db);
    if (
      JSON.stringify(stable(actual)) !==
      JSON.stringify(stable([...snapshot.reports].sort((a, b) => a.id - b.id)))
    )
      throw new Error("Report verification mismatch");
    const patches = (
      await db.query("SELECT data FROM commit_patches ORDER BY sha")
    ).rows.map((x) => x.data);
    if (
      JSON.stringify(stable(patches)) !==
      JSON.stringify(
        stable(
          [...snapshot.patches].sort((a, b) => a.sha.localeCompare(b.sha)),
        ),
      )
    )
      throw new Error("Patch verification mismatch");
    return "Imported";
  });
  console.log(
    JSON.stringify(
      {
        result,
        reports: snapshot.reports.length,
        comments: snapshot.reports.reduce((n, r) => n + r.comments.length, 0),
        patches: snapshot.patches.length,
        fingerprint,
        snapshotFile,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
