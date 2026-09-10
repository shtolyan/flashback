import type { FastifyInstance, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { z } from "zod";
import type { AccessKey } from "@flashback/contracts";
import { statuses } from "@flashback/contracts";
import * as access from "./access.ts";
import { ApiError } from "./errors.ts";
const cookieName = "flashback_session";
export type AuthRequest = FastifyRequest & {
  accessKey: AccessKey;
  sessionHash?: string;
};
export const actor = (r: FastifyRequest) => (r as AuthRequest).accessKey;
const attempts = new Map<string, { count: number; until: number }>();
export function allowedOrigin(request: FastifyRequest, origin: string) {
  const configured = (
    process.env.ALLOWED_ORIGINS ??
    process.env.PUBLIC_ORIGIN ??
    ""
  )
    .split(",")
    .filter(Boolean);
  const local = process.env.COOKIE_SECURE !== "true";
  return (
    configured.includes(origin) ||
    (local &&
      [
        `http://${request.headers.host}`,
        "http://localhost:8082",
        "http://127.0.0.1:8082",
      ].includes(origin))
  );
}
export async function authRoutes(app: FastifyInstance) {
  await app.register(cookie);
  app.decorateRequest("accessKey", null);
  app.decorateRequest("sessionHash", null);
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0];
    if (!url.startsWith("/api/") || request.method === "OPTIONS") return;
    reply.header("Cache-Control", "no-store");
    const origin = request.headers.origin;
    if (origin && !allowedOrigin(request, origin))
      throw new ApiError(403, "Источник запроса не разрешён.");
    if (url === "/api/auth/session" && request.method === "POST") return;
    if (
      url === "/api/bugs/v1/events" &&
      request.headers.upgrade?.toLowerCase() === "websocket"
    ) {
      const ticket = new URL(request.url, "http://localhost").searchParams.get(
        "ticket",
      );
      if (ticket) {
        const result = await access.useTicket(ticket);
        (request as AuthRequest).accessKey = result.key;
        (request as AuthRequest).sessionHash = result.session;
        return;
      }
    }
    const authorization = request.headers.authorization;
    if (authorization) {
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      if (!match) throw new ApiError(401, "Неверный формат ключа доступа.");
      (request as AuthRequest).accessKey = await access.authenticate(match[1]);
    } else {
      const secret = request.cookies[cookieName];
      if (!secret) throw new ApiError(401, "Введите ключ доступа.");
      // SameSite cookies plus an explicit Origin requirement prevent cross-site writes.
      if (!["GET", "HEAD"].includes(request.method) && !origin)
        throw new ApiError(403, "Для сессии браузера требуется Origin.");
      (request as AuthRequest).accessKey = await access.sessionKey(secret);
      (request as AuthRequest).sessionHash = access.hash(secret);
    }
  });
  app.post("/api/auth/session", async (request, reply) => {
    const t = Date.now();
    for (const [id, x] of attempts) if (x.until < t) attempts.delete(id);
    const a = attempts.get(request.ip) ?? { count: 0, until: t + 60000 };
    if (a.count >= 30)
      throw new ApiError(429, "Слишком много попыток. Повторите через минуту.");
    a.count++;
    attempts.set(request.ip, a);
    const body = z
      .object({ token: z.string().min(1).max(4096) })
      .parse(request.body);
    const key = await access.authenticate(body.token.trim());
    attempts.delete(request.ip);
    const secret = await access.makeSession(key);
    reply.setCookie(cookieName, secret, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: "strict",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return key;
  });
  app.get("/api/auth/me", async (request) => actor(request));
  app.post("/api/auth/logout", async (request, reply) => {
    if (request.cookies[cookieName])
      await access.endSession(request.cookies[cookieName]);
    reply.clearCookie(cookieName, {
      path: "/",
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: "strict",
      httpOnly: true,
    });
    return reply.code(204).send();
  });
  app.post("/api/auth/socket-ticket", async (request) => ({
    ticket: access.makeTicket(
      actor(request),
      (request as AuthRequest).sessionHash,
    ),
  }));
  const admin = (r: FastifyRequest) => {
    if (!actor(r).isAdmin)
      throw new ApiError(403, "Только администратор управляет ключами.");
    return actor(r);
  };
  app.get("/api/access-keys", async (request) => {
    admin(request);
    return access.listKeys();
  });
  app.post("/api/access-keys", async (request, reply) => {
    const creator = admin(request);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        isAdmin: z.boolean().default(false),
        allowedStatuses: z.array(z.enum(statuses)).max(5).default([]),
      })
      .parse(request.body);
    return reply.code(201).send(await access.createKey(body, creator));
  });
  app.post("/api/access-keys/:id/revoke", async (request, reply) => {
    const creator = admin(request),
      id = z
        .string()
        .uuid()
        .parse((request.params as any).id);
    await access.revokeKey(id, creator);
    return reply.code(204).send();
  });
}
