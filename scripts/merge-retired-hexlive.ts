/** One-off final reconciliation. Defaults to rollback; --apply commits under exclusive table locks. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool } from "../apps/server/src/database.ts";
import { listReports } from "../apps/server/src/store.ts";
import { mergeReport } from "./lib/legacy-merge.ts";
import type { Report, CommitPatch } from "@flashback/contracts";

type Snapshot = { reports: Report[]; patches: CommitPatch[] };
const [legacyFile, baselineFile, mode] = process.argv.slice(2);
if (!legacyFile || !baselineFile || (mode && mode !== "--apply"))
  throw new Error(
    "Usage: tsx scripts/merge-retired-hexlive.ts legacy.json baseline.json [--apply]",
  );
const legacy: Snapshot = JSON.parse(await readFile(legacyFile, "utf8"));
const baseline: Snapshot = JSON.parse(await readFile(baselineFile, "utf8"));
const fingerprint =
  "retired-sg-v1:" +
  createHash("sha256")
    .update(JSON.stringify({ legacy, baseline }))
    .digest("hex");
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
const stable = (x: any): any =>
  Array.isArray(x)
    ? x.map(stable)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, stable(x[k])]),
        )
      : x;
const db = await pool.connect();
try {
  await db.query("BEGIN");
  await db.query("SET LOCAL lock_timeout='10s'");
  await db.query("SELECT pg_advisory_xact_lock(4310002)");
  await db.query(
    "LOCK TABLE reports,comments,fix_commits,commit_patches,report_access IN ACCESS EXCLUSIVE MODE",
  );
  if (
    (
      await db.query("SELECT 1 FROM import_history WHERE fingerprint=$1", [
        fingerprint,
      ])
    ).rowCount
  ) {
    console.log("Already reconciled; no changes.");
  } else {
    const current = new Map(
      (await listReports(undefined, true, db)).map((r) => [r.id, r]),
    );
    const base = new Map(baseline.reports.map((r) => [r.id, r]));
    const sequence = Number(
      (await db.query("SELECT last_value FROM reports_id_seq")).rows[0]
        .last_value,
    );
    const auditMax = Number(
      (
        await db.query(
          "SELECT COALESCE(max(report_id),0) AS n FROM report_access",
        )
      ).rows[0].n,
    );
    let next =
      Math.max(
        sequence,
        auditMax,
        ...current.keys(),
        ...legacy.reports.map((r) => r.id),
      ) + 1;
    const inserted: { oldId: number; id: number }[] = [],
      updated: number[] = [],
      deletedPreserved: number[] = [];
    let extraComments = 0,
      extraCommits = 0,
      patches = 0;
    for (const source of legacy.reports) {
      const live = current.get(source.id),
        before = base.get(source.id);
      let report: Report;
      const same = live?.createdUtc === source.createdUtc;
      if (same) {
        if (!before || before.createdUtc !== source.createdUtc)
          throw new Error(`Missing common baseline for #${source.id}`);
        report = mergeReport(live!, before, source);
        if (report.revision === live!.revision) continue;
        updated.push(report.id);
        extraComments += report.comments.length - live!.comments.length;
        extraCommits += report.fixCommits.length - live!.fixCommits.length;
      } else {
        // A report present at cutover but later deleted must not be resurrected.
        if (!live && before?.createdUtc === source.createdUtc) {
          deletedPreserved.push(source.id);
          continue;
        }
        report = structuredClone(source);
        if (live || source.id <= Math.max(sequence, auditMax))
          report.id = next++;
        inserted.push({ oldId: source.id, id: report.id });
        report.comments.push({
          whenUtc:
            new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
          author: "migration",
          text: `Перенесено из отдельного старого трекера Сингапура, исходный баг #${source.id}. История и коммиты сохранены. Текущий номер: #${report.id}.`,
        });
        extraComments += report.comments.length;
        extraCommits += report.fixCommits.length;
      }
      if (same) {
        await db.query(
          `UPDATE reports SET ${fields
            .slice(1)
            .map((k, i) => `"${k}"=$${i + 2}`)
            .join(",")} WHERE id=$1`,
          fields.map((k) => report[k]),
        );
        await db.query('DELETE FROM comments WHERE "reportId"=$1', [report.id]);
        await db.query('DELETE FROM fix_commits WHERE "reportId"=$1', [
          report.id,
        ]);
      } else {
        await db.query(
          `INSERT INTO reports (${fields.map((k) => `"${k}"`).join(",")}) VALUES (${fields.map((_, i) => "$" + (i + 1)).join(",")})`,
          fields.map((k) => report[k]),
        );
      }
      for (const [i, c] of report.comments.entries())
        await db.query("INSERT INTO comments VALUES($1,$2,$3,$4,$5)", [
          report.id,
          i,
          c.whenUtc,
          c.author,
          c.text,
        ]);
      for (const [i, sha] of report.fixCommits.entries())
        await db.query("INSERT INTO fix_commits VALUES($1,$2,$3)", [
          report.id,
          i,
          sha,
        ]);
      current.set(report.id, report);
    }
    for (const patch of legacy.patches) {
      patches +=
        (
          await db.query(
            "INSERT INTO commit_patches VALUES($1,$2) ON CONFLICT(sha) DO NOTHING",
            [patch.sha, patch],
          )
        ).rowCount ?? 0;
    }
    // Verify complete report content before commit, including all untouched reports.
    for (const actual of await listReports(undefined, true, db)) {
      const expected = current.get(actual.id)!;
      for (const field of [...fields, "comments", "fixCommits"] as const)
        if (
          JSON.stringify(stable(actual[field])) !==
          JSON.stringify(stable(expected[field]))
        )
          throw new Error(`Verification failed: #${actual.id} ${field}`);
    }
    if (mode === "--apply") {
      await db.query(
        "SELECT setval('reports_id_seq', GREATEST($1, (SELECT max(id) FROM reports)),true)",
        [sequence],
      );
      await db.query(
        "INSERT INTO import_history(fingerprint,count) VALUES($1,$2)",
        [fingerprint, inserted.length],
      );
    }
    console.log(
      JSON.stringify(
        {
          mode: mode ?? "dry-run (rolled back)",
          fingerprint,
          inserted,
          updated,
          deletedPreserved,
          extraComments,
          extraCommits,
          patches,
          totalReports: current.size,
        },
        null,
        2,
      ),
    );
  }
  await db.query(mode === "--apply" ? "COMMIT" : "ROLLBACK");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
