import type { FastifyRequest } from "fastify";
import { actor } from "./auth-http.ts";
import { ApiError } from "./errors.ts";
import { pool, transaction } from "./database.ts";
import { getKey } from "./access.ts";
import type { AccessKey } from "@flashback/contracts";

export async function projectFor(request: FastifyRequest) {
  const requested = request.headers["x-flashback-project"];
  const key = actor(request);
  const project =
    typeof requested === "string"
      ? requested
      : typeof (request.query as any)?.project === "string"
        ? (request.query as any).project
        : (key?.reporterProject ?? "hexlive");
  if (key?.reporterProject && project !== key.reporterProject)
    throw new ApiError(403, "Ключ не имеет доступа к этому проекту.");
  if (
    !/^[a-z0-9-]{1,48}$/.test(project) ||
    !(await pool.query("SELECT 1 FROM projects WHERE slug=$1", [project]))
      .rowCount
  )
    throw new ApiError(404, "Проект не найден.");
  return project;
}
export async function createProject(
  input: { slug: string; name: string; repository?: string },
  key: AccessKey,
) {
  return transaction(async (db) => {
    if (!(await getKey(key.id, db, true)).isAdmin)
      throw new ApiError(403, "Только администратор создаёт проекты.");
    const result = await db.query(
      "INSERT INTO projects(slug,name,repository) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *",
      [input.slug, input.name, input.repository ?? ""],
    );
    if (!result.rowCount) throw new ApiError(409, "Проект уже существует.");
    return result.rows[0];
  });
}
