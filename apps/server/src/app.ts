import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import serveStatic from "@fastify/static";
import { z } from "zod";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  createSchema,
  updateSchema,
  commentSchema,
  patchSchema,
} from "@flashback/contracts/schemas";
import type { ChangeEvent } from "@flashback/contracts";
import * as store from "./store.ts";
import { pool } from "./database.ts";
import { root, settings } from "./config.ts";
import { projectFor, createProject } from "./projects.ts";
import { decodeImage } from "./images.ts";
import { installVoice } from "./voice.ts";
import { openapi } from "./openapi.ts";
import { authRoutes, actor, type AuthRequest } from "./auth-http.ts";
import {
  accessEvents,
  getKey,
  reportAccess,
  requireCentralPermission,
} from "./access.ts";

export async function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: ["127.0.0.1", "172.16.0.0/12"],
  });
  await app.register(cors, { origin: true, credentials: true });
  await authRoutes(app);
  await app.register(websocket);
  app.setErrorHandler((error: any, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: error.issues.map((x) => x.message).join("; ") });
    const code = error.statusCode ?? 500;
    if (code >= 500) console.error("API error:", error.message);
    return reply.code(code).send({
      error: code >= 500 ? "Ошибка сервера" : error.message,
      ...(error.actualRevision !== undefined
        ? { actualRevision: error.actualRevision }
        : {}),
    });
  });
  const id = (request: any) => {
    const n = Number(request.params.id);
    if (!Number.isSafeInteger(n) || n < 1)
      throw new store.ApiError(404, "Отчёт не найден");
    return n;
  };
  const base = "/api/bugs/v1";
  app.decorateRequest("reportProject", "hexlive");
  const project = (request: any): string => request.reportProject;
  app.addHook("preHandler", async (request) => {
    if (
      !request.url.startsWith(base) ||
      request.url.startsWith(base + "/events")
    )
      return;
    (request as any).reportProject = await projectFor(request);
    if ((request.params as any)?.id)
      await store.getReport(id(request), undefined, project(request));
  });
  app.get(
    "/api/projects",
    async () => (await pool.query("SELECT * FROM projects ORDER BY name")).rows,
  );
  app.post("/api/projects", async (request, reply) => {
    if (!actor(request).isAdmin)
      throw new store.ApiError(403, "Только администратор создаёт проекты.");
    const input = z
      .object({
        slug: z.string().regex(/^[a-z0-9-]{1,48}$/),
        name: z.string().trim().min(1).max(100),
        repository: z.string().url().optional(),
      })
      .parse(request.body);
    return reply.code(201).send(await createProject(input, actor(request)));
  });
  app.addContentTypeParser(
    ["image/png", "image/jpeg", "audio/wav", "application/octet-stream"],
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  await installVoice(app, project);

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true, instance: settings.name };
  });
  app.get("/api/instance", async (request) => ({
    name: (
      await pool.query("SELECT name FROM projects WHERE slug=$1", [
        await projectFor(request),
      ])
    ).rows[0].name,
    repository: (
      await pool.query("SELECT repository FROM projects WHERE slug=$1", [
        await projectFor(request),
      ])
    ).rows[0].repository,
    auth: "token",
    version: "0.1.0",
  }));
  app.get("/openapi.json", async () => openapi);
  app.get(base + "/reports", async (request) => {
    const q = request.query as any;
    return store.listReports(
      q.status,
      q.archived?.toLowerCase() !== "false",
      undefined,
      project(request),
    );
  });
  app.get(base + "/query", async (request) =>
    store.queryReports({
      ...(request.query as Record<string, string>),
      project: project(request),
    }),
  );
  app.get(base + "/reports/:id", async (request) =>
    store.getReport(id(request), undefined, project(request)),
  );
  app.post(
    base + "/reports",
    { bodyLimit: 24 * 1024 * 1024 },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await store.createReport(
            createSchema.parse(request.body),
            actor(request),
            project(request),
          ),
        ),
  );
  app.get(
    base + "/reports/:id/attachments",
    async (request) => (await store.getReport(id(request))).attachments ?? [],
  );
  app.post(base + "/reports/:id/attachments", async (request) => {
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const q = request.query as any;
    const image = decodeImage({
      filename: q.filename ?? "screenshot.png",
      contentType: String(request.headers["content-type"]).split(";")[0],
      dataBase64: body.toString("base64"),
    });
    const revision =
      q.expectedRevision === undefined
        ? undefined
        : z.coerce.number().int().positive().parse(q.expectedRevision);
    return store.attachImage(id(request), image, actor(request), revision);
  });
  app.get(
    base + "/reports/:id/attachments/:attachment",
    async (request, reply) => {
      const aid = z
        .string()
        .uuid()
        .parse((request.params as any).attachment);
      const r = await pool.query(
        "SELECT bytes,content_type,filename,sha256 FROM report_attachments WHERE id=$1 AND report_id=$2",
        [aid, id(request)],
      );
      if (!r.rowCount) throw new store.ApiError(404, "Вложение не найдено.");
      const image = r.rows[0];
      return reply
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-store")
        .header("Content-Disposition", `inline; filename="${image.filename}"`)
        .header("ETag", `"${image.sha256}"`)
        .type(image.content_type)
        .send(image.bytes);
    },
  );
  app.post(base + "/reports/:id", async (request) =>
    store.updateReport(
      id(request),
      updateSchema.parse(request.body),
      actor(request),
    ),
  );
  app.post(base + "/reports/:id/comments", async (request) =>
    store.addComment(
      id(request),
      commentSchema.parse(request.body),
      undefined,
      actor(request),
    ),
  );
  app.post(base + "/reports/:id/comments/:ordinal", async (request) => {
    const ordinal = Number((request.params as any).ordinal);
    if (!Number.isSafeInteger(ordinal))
      throw new store.ApiError(404, "Комментарий не найден");
    return store.addComment(
      id(request),
      commentSchema.parse(request.body),
      ordinal,
      actor(request),
    );
  });
  app.post(base + "/reports/:id/transition", async (request) => {
    const body = z
      .object({
        action: z.enum(["confirm", "rework"]),
        expectedRevision: z.number().int(),
        text: z.string().default(""),
      })
      .parse(request.body);
    return store.transitionReport(
      id(request),
      body.action,
      body.expectedRevision,
      body.text,
      actor(request),
    );
  });
  for (const method of ["DELETE", "POST"] as const)
    app.route({
      method,
      url: base + "/reports/:id" + (method === "POST" ? "/delete" : ""),
      handler: async (request, reply) => {
        await store.deleteReport(id(request), actor(request));
        return reply.code(204).send();
      },
    });
  app.get(base + "/commits", async () => {
    const r = await pool.query("SELECT sha FROM commit_patches ORDER BY sha");
    return r.rows.map((x) => x.sha);
  });
  app.get(base + "/commits/:sha", async (request) =>
    store.getPatch((request.params as any).sha),
  );
  app.put(base + "/commits/:sha", async (request) =>
    store.putPatch(
      (request.params as any).sha,
      patchSchema.parse(request.body) as any,
      actor(request),
    ),
  );
  app.get(base + "/reports/:id/access", async (request) => {
    await store.getReport(id(request));
    return reportAccess(id(request));
  });
  app.get(base + "/events", { websocket: true }, (socket, request) => {
    const key = actor(request),
      session = (request as AuthRequest).sessionHash;
    const revoked = (id: string) => {
      if (id === key.id) socket.close(4401, "Key revoked");
    };
    const loggedOut = (id: string) => {
      if (id === session) socket.close(4401, "Signed out");
    };
    accessEvents.on("revoke", revoked);
    accessEvents.on("logout", loggedOut);
    const send = (event: ChangeEvent) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(event));
    };
    store.events.on("change", send);
    send({ type: "connected" });
    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    const timer = setInterval(async () => {
      try {
        requireCentralPermission(await getKey(key.id), "bugs.read");
        if (
          session &&
          !(
            await pool.query(
              "SELECT 1 FROM access_sessions WHERE secret_hash=$1 AND expires_at>now()",
              [session],
            )
          ).rowCount
        )
          return socket.close(4401, "Session expired");
      } catch {
        return socket.close(4401, "Key revoked");
      }
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, 25000);
    socket.on("close", () => {
      store.events.off("change", send);
      accessEvents.off("revoke", revoked);
      accessEvents.off("logout", loggedOut);
      clearInterval(timer);
    });
    socket.on("error", () => socket.close());
  });
  const dist = path.join(root, "apps/client/dist");
  if (existsSync(dist)) {
    await app.register(serveStatic, {
      root: dist,
      setHeaders(res, file) {
        if (file.endsWith("sw.js") || file.endsWith(".html"))
          res.header("Cache-Control", "no-cache");
      },
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Not found" })
        : reply.sendFile("index.html"),
    );
  }
  return app;
}
