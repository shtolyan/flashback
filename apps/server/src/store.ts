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
import type { AccessKey } from "@flashback/contracts";
import { writeKey, record } from "./access.ts";
import { decodeImage, insertAttachment, type ImageInput } from "./images.ts";

export const events = new EventEmitter();
import { ApiError } from "./errors.ts";
export { ApiError } from "./errors.ts";
export const now = () =>
  new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const projection = `to_jsonb(r) || jsonb_build_object(
  'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'contentType',a.content_type,'size',octet_length(a.bytes),'sha256',a.sha256,'createdAt',a.created_at,'url','/api/bugs/v1/reports/'||r.id||'/attachments/'||a.id||'?project='||r.project) ORDER BY a.created_at,a.id) FROM report_attachments a WHERE a.report_id=r.id),'[]'::jsonb),
 'comments',COALESCE((SELECT jsonb_agg(jsonb_build_object('whenUtc',c."whenUtc",'author',c.author,'text',c.text) ORDER BY ordinal) FROM comments c WHERE c."reportId"=r.id),'[]'::jsonb),
 'fixCommits',COALESCE((SELECT jsonb_agg(sha ORDER BY ordinal) FROM fix_commits f WHERE f."reportId"=r.id),'[]'::jsonb)) AS report`;
const summary = `to_jsonb(r)-'agentHandoff' || jsonb_build_object('commentCount',(SELECT count(*)::int FROM comments c WHERE c."reportId"=r.id),
 'commitCount',GREATEST((SELECT count(*)::int FROM fix_commits f WHERE f."reportId"=r.id),CASE WHEN r."fixCommit"<>'' THEN 1 ELSE 0 END)) AS report`;
type DB = Pick<PoolClient, "query">;
export async function getReport(
  id: number,
  db: DB = pool,
  project?: string,
): Promise<Report> {
  const { rows } = await db.query(
    `SELECT ${projection} FROM reports r WHERE id=$1 AND ($2::text IS NULL OR project=$2)`,
    [id, project ?? null],
  );
  if (!rows.length) throw new ApiError(404, "Отчёт не найден");
  return rows[0].report;
}
export async function listReports(
  status?: string,
  includeArchived = true,
  db: DB = pool,
  project = "hexlive",
): Promise<Report[]> {
  const { rows } = await db.query(
    `SELECT ${projection} FROM reports r WHERE ($1::text IS NULL OR status=$1) AND ($2 OR NOT archived) AND project=$3 ORDER BY id`,
    [status || null, includeArchived, project],
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
  const project = params.project ?? "hexlive";
  const q = (params.q ?? "").trim().toLocaleLowerCase();
  // Position() implements literal, case-insensitive substring search, including % and _.
  const search = `($1='' OR position($1 in lower(text || ' ' || context || ' ' || "assignedAgent"))>0 OR id::text=replace($1,'#',''))`;
  const status = statuses.includes(params.status as any) ? params.status : null;
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const counts = await db.query(
      `SELECT count(*) FILTER(WHERE NOT archived AND status<>'fixed')::int AS open,count(*) FILTER(WHERE NOT archived AND status='fixed')::int AS fixed,count(*) FILTER(WHERE archived)::int AS archive FROM reports WHERE project=$1`,
      [project],
    );
    const groups = await db.query(
      `SELECT status,count(*)::int AS n FROM reports WHERE ${scope} AND ${search} AND project=$2 GROUP BY status`,
      [q, project],
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
      `SELECT ${summary} FROM reports r WHERE ${scope} AND ${search} AND ($2::text IS NULL OR status=$2) AND project=$5 ORDER BY id DESC LIMIT $3 OFFSET $4`,
      [q, status, pageSize, (page - 1) * pageSize, project],
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
export async function createReport(
  body: {
    text: string;
    context?: string | null;
    reportedInVersion?: string | null;
    attachments?: ImageInput[];
    requestId?: string;
  },
  actor: AccessKey,
  project = "hexlive",
) {
  const images = (body.attachments ?? []).map(decodeImage);
  const report = await transaction(async (db) => {
    const key = await writeKey(db, actor, "created", "bugs.create");
    if (key.reporterProject && key.reporterProject !== project)
      throw new ApiError(403, "Неверный проект игрового ключа.");
    if (body.requestId) {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        key.id + body.requestId,
      ]);
      const prior = await db.query(
        "SELECT report_id FROM report_submissions WHERE token_id=$1 AND request_id=$2",
        [key.id, body.requestId],
      );
      if (prior.rowCount)
        return getReport(prior.rows[0].report_id, db, project);
    }
    if (key.reporterProject) {
      if (images.length > 1)
        throw new ApiError(400, "Игровой репорт содержит один скриншот.");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "report-rate:" + key.id,
      ]);
      const rate = await db.query(
        "SELECT count(*) FROM report_access WHERE token_id=$1 AND action='created' AND at>now()-interval '1 hour'",
        [key.id],
      );
      if (Number(rate.rows[0].count) >= 60)
        throw new ApiError(429, "Лимит репортов достигнут. Попробуйте позже.");
    }
    const { rows } = await db.query(
      'INSERT INTO reports("createdUtc",status,text,context,"reportedInVersion",project) VALUES($1,\'created\',$2,$3,$4,$5) RETURNING id',
      [
        now(),
        body.text,
        body.context?.trim() ?? "",
        body.reportedInVersion?.trim() ?? "",
        project,
      ],
    );
    for (const image of images)
      await insertAttachment(db, rows[0].id, key, image);
    if (body.requestId)
      await db.query("INSERT INTO report_submissions VALUES($1,$2,$3)", [
        key.id,
        body.requestId,
        rows[0].id,
      ]);
    await record(db, key, rows[0].id, "created", "created");
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
export async function updateReport(id: number, body: Update, actor: AccessKey) {
  return changed(id, async (db) => {
    const key = await writeKey(db, actor, body.status ?? undefined);
    if (body.archived != null || body.fixedInVersion)
      await writeKey(db, actor, "fixed");
    await lock(id, db, body.expectedRevision);
    await record(
      db,
      key,
      id,
      body.fixCommits != null ? "fix_commits" : "updated",
      body.status ?? undefined,
    );
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
  ordinal: number | undefined,
  actor: AccessKey,
) {
  return changed(id, async (db) => {
    const key = await writeKey(db, actor);
    await lock(id, db);
    if (ordinal === undefined) {
      await record(db, key, id, "comment");
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
      if (result.rowCount) {
        await record(db, key, id, "comment_edited");
        await db.query("UPDATE reports SET revision=revision+1 WHERE id=$1", [
          id,
        ]);
      }
    }
  });
}
// The UI's existing confirm/rework flow is atomic, including its user comment.
export async function transitionReport(
  id: number,
  action: "confirm" | "rework",
  revision: number,
  text: string,
  actor: AccessKey,
) {
  return changed(id, async (db) => {
    const key = await writeKey(
      db,
      actor,
      action === "confirm" ? "fixed" : "rework",
    );
    await lock(id, db, revision);
    await record(
      db,
      key,
      id,
      "transition",
      action === "confirm" ? "fixed" : "rework",
    );
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
export async function deleteReport(id: number, actor: AccessKey) {
  await transaction(async (db) => {
    const key = await writeKey(db, actor, "fixed");
    await lock(id, db);
    await record(db, key, id, "deleted");
    await db.query("DELETE FROM reports WHERE id=$1", [id]);
  });
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
export async function putPatch(
  sha: string,
  body: Partial<CommitPatch>,
  actor: AccessKey,
) {
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
  await transaction(async (db) => {
    const key = await writeKey(db, actor);
    await db.query(
      "INSERT INTO commit_patches VALUES($1,$2) ON CONFLICT(sha) DO UPDATE SET data=excluded.data",
      [sha, patch],
    );
    await db.query(
      "INSERT INTO patch_access VALUES($1,$2,$3,now()) ON CONFLICT(sha) DO UPDATE SET token_id=excluded.token_id,token_name=excluded.token_name,at=now()",
      [sha, key.id, key.name],
    );
  });
  emit({ type: "commit.changed", sha });
  return patch;
}

export async function attachImage(
  id: number,
  image: ReturnType<typeof decodeImage>,
  actor: AccessKey,
  revision?: number,
) {
  return changed(id, async (db) => {
    const key = await writeKey(db, actor);
    await lock(id, db, revision);
    await insertAttachment(db, id, key, image);
    await db.query("UPDATE reports SET revision=revision+1 WHERE id=$1", [id]);
    await record(db, key, id, "attachment");
  });
}
