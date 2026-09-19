import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import type { AccessKey, Status, ReportAccess } from "@flashback/contracts";
import { statuses } from "@flashback/contracts";
import { pool, transaction } from "./database.ts";
import { ApiError } from "./errors.ts";
export const accessEvents = new EventEmitter();
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomSecret = () => "fb_" + randomBytes(32).toString("base64url");
const projection = `id,name,is_admin AS "isAdmin",allowed_statuses AS "allowedStatuses",created_at AS "createdAt",revoked_at AS "revokedAt",last_used_at AS "lastUsedAt"`;
// Central credentials stay only in process memory; browser sessions require a new login after restart.
const centralSecrets = new Map<string, string>();
const centralPermissions = new WeakMap<AccessKey, string[]>();
async function central(secret: string): Promise<AccessKey> {
  const root = process.env.HEXLIVE_IDENTITY_URL;
  if (!root || new URL(root).protocol !== "https:") throw new ApiError(503, "Центральный доступ не настроен.");
  let response: Response;
  try { response = await fetch(new URL("/api/identity/v1/validate", root), { method: "POST", headers: { Authorization: `Bearer ${secret}` }, redirect: "error", signal: AbortSignal.timeout(5000) }); }
  catch { throw new ApiError(503, "Сервис доступа недоступен."); }
  if (response.status === 401) throw new ApiError(401, "Ключ отозван.");
  if (!response.ok) throw new ApiError(503, "Сервис доступа недоступен.");
  const subject = await response.json() as { accountId: string; name: string; permissions: string[]; subjectType: string };
  if (!/^[a-f0-9]{32}$/.test(subject.accountId) || !Array.isArray(subject.permissions)) throw new ApiError(503, "Некорректный ответ сервиса доступа.");
  const digest = hash(secret);
  const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
  const allowed = subject.permissions.includes("bugs.manage") ? statuses.filter(s => subject.subjectType !== "agent" || s !== "fixed") : subject.permissions.includes("bugs.create") ? ["created" as Status] : [];
  const key = { id, name: subject.name, isAdmin: false, allowedStatuses: [...allowed], createdAt: new Date().toISOString(), revokedAt: null, lastUsedAt: null, accountId: subject.accountId } as AccessKey;
  centralPermissions.set(key, subject.permissions);
  centralSecrets.set(id, secret);
  return key;
}
export function requireCentralPermission(key: AccessKey, permission: string) {
  const rights = centralPermissions.get(key);
  if (rights && !rights.includes(permission)) throw new ApiError(403, `Нет права ${permission}.`);
}
export function isCentral(key: AccessKey) { return centralPermissions.has(key); }
export async function getKey(
  id: string,
  db: Pick<PoolClient, "query"> = pool,
  lock = false,
): Promise<AccessKey> {
  const r = await db.query(
    `SELECT ${projection},secret_hash FROM access_tokens WHERE id=$1 AND revoked_at IS NULL ${lock ? "FOR SHARE" : ""}`,
    [id],
  );
  if (!r.rowCount) throw new ApiError(401, "Ключ отозван. Войдите снова.");
  if (String(r.rows[0].secret_hash).startsWith("central:")) {
    const secret = centralSecrets.get(id);
    if (!secret) throw new ApiError(401, "Введите ключ заново.");
    return central(secret);
  }
  delete r.rows[0].secret_hash;
  return r.rows[0];
}
export function allowStatus(key: AccessKey, status: Status) {
  if (!key.isAdmin && !key.allowedStatuses.includes(status))
    throw new ApiError(
      403,
      "Этот ключ не может устанавливать выбранный статус.",
    );
}
export async function writeKey(
  db: PoolClient,
  key: AccessKey,
  status?: Status,
  permission = "bugs.manage",
) {
  const fresh = await getKey(key.id, db, true);
  requireCentralPermission(fresh, permission);
  if (status) allowStatus(fresh, status);
  return fresh;
}
export async function record(
  db: PoolClient,
  key: AccessKey,
  id: number,
  action: string,
  status?: Status,
) {
  await db.query(
    "INSERT INTO report_access(report_id,token_id,token_name,action,status) VALUES($1,$2,$3,$4,$5)",
    [id, key.id, key.name, action, status ?? null],
  );
}
export async function reportAccess(id: number): Promise<ReportAccess> {
  const r = await pool.query(
    `SELECT token_id AS "tokenId",token_name AS name,action,status,at FROM report_access WHERE report_id=$1 ORDER BY id DESC`,
    [id],
  );
  const rows = r.rows;
  return {
    created: rows.find((x) => x.action === "created") ?? null,
    updated: rows[0] ?? null,
    status: rows.find((x) => x.status) ?? null,
    fixed: rows.find((x) => x.status === "fixed") ?? null,
    ready: rows.find((x) => x.status === "ready_for_test") ?? null,
  };
}
export async function createKey(
  input: { name: string; isAdmin: boolean; allowedStatuses: Status[] },
  creator?: AccessKey,
  suppliedSecret?: string,
) {
  const secret = suppliedSecret ?? randomSecret();
  if (secret.length < 24 || secret.length > 4096)
    throw new ApiError(400, "Ключ слишком короткий или длинный.");
  const token = await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(4310003)");
    if (creator && !(await getKey(creator.id, db, true)).isAdmin)
      throw new ApiError(403, "Только администратор управляет ключами.");
    const result = await db.query(
      `INSERT INTO access_tokens(id,name,secret_hash,is_admin,allowed_statuses,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${projection}`,
      [
        randomUUID(),
        input.name.trim(),
        hash(secret),
        input.isAdmin,
        input.isAdmin ? [...statuses] : input.allowedStatuses,
        creator?.id ?? null,
      ],
    );
    return result.rows[0] as AccessKey;
  });
  return { key: token, secret };
}
export async function listKeys() {
  return (
    await pool.query(
      `SELECT ${projection} FROM access_tokens ORDER BY created_at DESC`,
    )
  ).rows as AccessKey[];
}
export async function revokeKey(id: string, actor: AccessKey) {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(4310003)");
    if (!(await getKey(actor.id, db, true)).isAdmin)
      throw new ApiError(403, "Только администратор управляет ключами.");
    const target = await getKey(id, db);
    if (
      target.isAdmin &&
      Number(
        (
          await db.query(
            "SELECT count(*) FROM access_tokens WHERE is_admin AND revoked_at IS NULL",
          )
        ).rows[0].count,
      ) <= 1
    )
      throw new ApiError(
        409,
        "Нельзя отозвать последний администраторский ключ.",
      );
    await db.query("UPDATE access_tokens SET revoked_at=now() WHERE id=$1", [
      id,
    ]);
    await db.query("DELETE FROM access_sessions WHERE token_id=$1", [id]);
  });
  accessEvents.emit("revoke", id);
}
export async function authenticate(secret: string): Promise<AccessKey> {
  if (secret.startsWith("hexlive_")) {
    const key = await central(secret);
    await pool.query(`INSERT INTO access_tokens(id,name,secret_hash,is_admin,allowed_statuses,central_account_id) VALUES($1,$2,$3,false,$4,$5) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,allowed_statuses=EXCLUDED.allowed_statuses`, [key.id, key.name, "central:" + hash(secret), key.allowedStatuses, (key as AccessKey & { accountId: string }).accountId]);
    return key;
  }
  if (!secret || secret.length > 4096)
    throw new ApiError(401, "Введите действующий ключ доступа.");
  const r = await pool.query(
    `SELECT ${projection} FROM access_tokens WHERE secret_hash=$1 AND revoked_at IS NULL`,
    [hash(secret)],
  );
  if (!r.rowCount) throw new ApiError(401, "Ключ недействителен или отозван.");
  await pool.query(
    "UPDATE access_tokens SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<now()-interval '1 minute')",
    [r.rows[0].id],
  );
  return r.rows[0];
}
export async function makeSession(key: AccessKey) {
  const secret = randomSecret();
  await transaction(async (db) => {
    await getKey(key.id, db, true);
    await db.query("DELETE FROM access_sessions WHERE expires_at<now()");
    await db.query(
      "INSERT INTO access_sessions VALUES($1,$2,now()+interval '30 days')",
      [hash(secret), key.id],
    );
  });
  return secret;
}
export async function sessionKey(secret: string) {
  const r = await pool.query(
    "SELECT token_id FROM access_sessions WHERE secret_hash=$1 AND expires_at>now()",
    [hash(secret)],
  );
  if (!r.rowCount)
    throw new ApiError(401, "Сессия истекла. Введите ключ доступа.");
  return getKey(r.rows[0].token_id);
}
export async function endSession(secret: string) {
  const id = hash(secret);
  await pool.query("DELETE FROM access_sessions WHERE secret_hash=$1", [id]);
  accessEvents.emit("logout", id);
}
const tickets = new Map<
  string,
  { tokenId: string; session?: string; expires: number }
>();
export function makeTicket(key: AccessKey, session?: string) {
  for (const [id, t] of tickets) if (t.expires < Date.now()) tickets.delete(id);
  if (tickets.size > 10000)
    throw new ApiError(429, "Повторите подключение позже.");
  const ticket = randomSecret();
  tickets.set(hash(ticket), {
    tokenId: key.id,
    session,
    expires: Date.now() + 30000,
  });
  return ticket;
}
export async function useTicket(ticket: string) {
  const id = hash(ticket),
    t = tickets.get(id);
  tickets.delete(id);
  if (!t || t.expires < Date.now())
    throw new ApiError(401, "Подключение истекло.");
  if (t.session) {
    const r = await pool.query(
      "SELECT 1 FROM access_sessions WHERE secret_hash=$1 AND expires_at>now()",
      [t.session],
    );
    if (!r.rowCount) throw new ApiError(401, "Сессия истекла.");
  }
  return { key: await getKey(t.tokenId), session: t.session };
}
