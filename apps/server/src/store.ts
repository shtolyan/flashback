import type { PoolClient } from "pg";
import { EventEmitter } from "node:events";
import {
  statuses,
  type Report,
  type CommitPatch,
  type Update,
  type Page,
  type View,
  type ChangeEvent,
} from "@flashback/contracts";
import { pool, transaction } from "./database.ts";

export const events = new EventEmitter();
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public actualRevision?: number,
  ) {
    super(message);
  }
}
export const now = () =>
  new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const projection = `to_jsonb(r) || jsonb_build_object(
 'comments',COALESCE((SELECT jsonb_agg(jsonb_build_object('whenUtc',c."whenUtc",'author',c.author,'text',c.text) ORDER BY ordinal) FROM comments c WHERE c."reportId"=r.id),'[]'::jsonb),
 'fixCommits',COALESCE((SELECT jsonb_agg(sha ORDER BY ordinal) FROM fix_commits f WHERE f."reportId"=r.id),'[]'::jsonb)) AS report`;
const summary = `to_jsonb(r)-'agentHandoff' || jsonb_build_object('commentCount',(SELECT count(*)::int FROM comments c WHERE c."reportId"=r.id),
 'commitCount',GREATEST((SELECT count(*)::int FROM fix_commits f WHERE f."reportId"=r.id),CASE WHEN r."fixCommit"<>'' THEN 1 ELSE 0 END)) AS report`;
type DB = Pick<PoolClient, "query">;
export async function getReport(id: number, db: DB = pool): Promise<Report> {
  const { rows } = await db.query(
    `SELECT ${projection} FROM reports r WHERE id=$1`,
    [id],
  );
  if (!rows.length) throw new ApiError(404, "Отчёт не найден");
  return rows[0].report;
}
export async function listReports(
  status?: string,
  includeArchived = true,
  db: DB = pool,
): Promise<Report[]> {
  const { rows } = await db.query(
    `SELECT ${projection} FROM reports r WHERE ($1::text IS NULL OR status=$1) AND ($2 OR NOT archived) ORDER BY id`,
    [status || null, includeArchived],
  );
  return rows.map((x) => x.report);
}
export async function queryReports(
  params: Record<string, string>,
): Promise<Page> {
  const view: View = ["open", "fixed", "archive"].includes(params.view)
    ? (params.view as View)
    : "open";
  const scope =
    view === "archive"
      ? "archived"
      : view === "fixed"
        ? "NOT archived AND status='fixed'"
        : "NOT archived AND status<>'fixed'";
  const q = (params.q ?? "").trim().toLocaleLowerCase();
  // Position() implements literal, case-insensitive substring search, including % and _.
  const search = `($1='' OR position($1 in lower(text || ' ' || context || ' ' || "assignedAgent"))>0 OR id::text=replace($1,'#',''))`;
  const status = statuses.includes(params.status as any) ? params.status : null;
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const counts = await db.query(
      `SELECT count(*) FILTER(WHERE NOT archived AND status<>'fixed')::int AS open,count(*) FILTER(WHERE NOT archived AND status='fixed')::int AS fixed,count(*) FILTER(WHERE archived)::int AS archive FROM reports`,
    );
    const groups = await db.query(
      `SELECT status,count(*)::int AS n FROM reports WHERE ${scope} AND ${search} GROUP BY status`,
      [q],
    );
    const statusCounts = Object.fromEntries(
      statuses.map((s) => [s, groups.rows.find((x) => x.status === s)?.n ?? 0]),
    ) as Page["statuses"];
    const total = status
      ? statusCounts[status as keyof typeof statusCounts]
      : Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const pageSize = 24,
      pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, Math.max(1, parseInt(params.page) || 1));
    const result = await db.query(
      `SELECT ${summary} FROM reports r WHERE ${scope} AND ${search} AND ($2::text IS NULL OR status=$2) ORDER BY id DESC LIMIT $3 OFFSET $4`,
      [q, status, pageSize, (page - 1) * pageSize],
    );
    return {
      items: result.rows.map((x) => x.report),
      total,
      page,
      pageSize,
      pages,
      counts: counts.rows[0],
      statuses: statusCounts,
    };
  });
}
const emit = (e: ChangeEvent) => events.emit("change", e);
async function changed(id: number, fn: (db: PoolClient) => Promise<void>) {
  const report = await transaction(async (db) => {
    await fn(db);
    return getReport(id, db);
  });
  emit({ type: "report.changed", id, revision: report.revision });
  return report;
}
export async function createReport(body: {
  text: string;
  context?: string | null;
  reportedInVersion?: string | null;
}) {
  const report = await transaction(async (db) => {
    const { rows } = await db.query(
      'INSERT INTO reports("createdUtc",status,text,context,"reportedInVersion") VALUES($1,\'created\',$2,$3,$4) RETURNING id',
      [
        now(),
        body.text,
        body.context?.trim() ?? "",
        body.reportedInVersion?.trim() ?? "",
      ],
    );
    return getReport(rows[0].id, db);
  });
  emit({ type: "report.changed", id: report.id, revision: report.revision });
  return report;
}
async function lock(id: number, db: PoolClient, revision?: number | null) {
  const { rows } = await db.query(
    "SELECT revision FROM reports WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!rows.length) throw new ApiError(404, "Отчёт не найден");
  if (revision != null && rows[0].revision !== revision)
    throw new ApiError(
      409,
      "The report changed; reload it before saving.",
      rows[0].revision,
    );
}
export async function updateReport(id: number, body: Update) {
  return changed(id, async (db) => {
    await lock(id, db, body.expectedRevision);
    const fields = [
      "text",
      "status",
      "assignedAgent",
      "agentHandoff",
      "readyForTestInVersion",
      "fixedInVersion",
      "archived",
    ] as const;
    const values: unknown[] = [id];
    const updates: string[] = [];
    for (const key of fields)
      if (body[key] != null) {
        values.push(body[key]);
        updates.push(`"${key}"=$${values.length}`);
      }
    await db.query(
      `UPDATE reports SET ${[...updates, "revision=revision+1"].join(",")} WHERE id=$1`,
      values,
    );
    if (body.fixCommits != null) {
      await db.query('DELETE FROM fix_commits WHERE "reportId"=$1', [id]);
      const shas = [
        ...new Set(body.fixCommits.map((x) => x.trim()).filter(Boolean)),
      ];
      for (const [i, sha] of shas.entries())
        await db.query("INSERT INTO fix_commits VALUES($1,$2,$3)", [
          id,
          i,
          sha,
        ]);
    }
  });
}
export async function addComment(
  id: number,
  body: { text: string; author?: string | null },
  ordinal?: number,
) {
  return changed(id, async (db) => {
    await lock(id, db);
    if (ordinal === undefined) {
      await db.query(
        'INSERT INTO comments SELECT $1,COALESCE(max(ordinal)+1,0),$2,$3,$4 FROM comments WHERE "reportId"=$1',
        [id, now(), body.author?.trim() || "user", body.text],
      );
      await db.query("UPDATE reports SET revision=revision+1 WHERE id=$1", [
        id,
      ]);
    } else {
      const result = await db.query(
        'UPDATE comments SET text=$3,"whenUtc"=$4 WHERE "reportId"=$1 AND ordinal=$2',
        [id, ordinal, body.text, now()],
      );
      if (result.rowCount)
        await db.query("UPDATE reports SET revision=revision+1 WHERE id=$1", [
          id,
        ]);
    }
  });
}
// The UI's existing confirm/rework flow is atomic, including its user comment.
export async function transitionReport(
  id: number,
  action: "confirm" | "rework",
  revision: number,
  text: string,
) {
  return changed(id, async (db) => {
    await lock(id, db, revision);
    const r = await getReport(id, db);
    if (r.status !== "ready_for_test")
      throw new ApiError(
        409,
        "Статус изменился. Обновите карточку.",
        r.revision,
      );
    if (action === "rework")
      await db.query(
        `UPDATE reports SET status='rework',archived=false,"readyForTestInVersion"='',"fixedInVersion"='',revision=revision+1 WHERE id=$1`,
        [id],
      );
    else
      await db.query(
        "UPDATE reports SET status='fixed',revision=revision+1 WHERE id=$1",
        [id],
      );
    const comment =
      action === "confirm"
        ? "Подтверждено пользователем: исправлено."
        : text.trim();
    if (comment)
      await db.query(
        "INSERT INTO comments SELECT $1,COALESCE(max(ordinal)+1,0),$2,'user',$3 FROM comments WHERE \"reportId\"=$1",
        [id, now(), comment],
      );
  });
}
export async function deleteReport(id: number) {
  const result = await pool.query("DELETE FROM reports WHERE id=$1", [id]);
  if (!result.rowCount) throw new ApiError(404, "Отчёт не найден");
  emit({ type: "report.deleted", id });
}
export async function getPatch(sha: string): Promise<CommitPatch> {
  sha = sha.trim().toLowerCase();
  if (!/^[a-f0-9]{7,}$/.test(sha)) throw new ApiError(404, "Патч не найден");
  const { rows } = await pool.query(
    "SELECT data FROM commit_patches WHERE sha=$1 OR starts_with(sha,$1) ORDER BY sha LIMIT 2",
    [sha],
  );
  if (!rows.length || (rows.length > 1 && rows[0].data.sha !== sha))
    throw new ApiError(404, "Патч не найден");
  return rows[0].data;
}
export async function putPatch(sha: string, body: Partial<CommitPatch>) {
  sha = sha.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new ApiError(400, "A full 40-character commit SHA is required.");
  if (body.sha && body.sha.trim().toLowerCase() !== sha)
    throw new ApiError(400, "sha in the body differs from the route");
  const patch: CommitPatch = {
    sha,
    subject: body.subject?.trim() ?? "",
    message: body.message?.trim() ?? "",
    author: body.author?.trim() ?? "",
    whenUtc: body.whenUtc?.trim() ?? "",
    files: body.files ?? [],
    patch: (body.patch ?? "").slice(0, 1_000_000),
    truncated: !!body.truncated || (body.patch?.length ?? 0) > 1_000_000,
    storedUtc: now(),
  };
  await pool.query(
    "INSERT INTO commit_patches VALUES($1,$2) ON CONFLICT(sha) DO UPDATE SET data=excluded.data",
    [sha, patch],
  );
  emit({ type: "commit.changed", sha });
  return patch;
}
