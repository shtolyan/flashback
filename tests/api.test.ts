import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { WebSocket } from "ws";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const dbName = "flashback_test_" + Date.now();
const source =
  process.env.DATABASE_URL ??
  "postgres://flashback:flashback_local@127.0.0.1:5437/flashback";
const admin = new pg.Pool({ connectionString: source });
const url = new URL(source);
url.pathname = "/" + dbName;
process.env.DATABASE_URL = url.toString();
await admin.query(`CREATE DATABASE "${dbName}"`);
const { migrate, pool } = await import("../apps/server/src/database.ts");
const { buildApp } = await import("../apps/server/src/app.ts");
await migrate();
const { createKey, hash, listKeys } =
  await import("../apps/server/src/access.ts");
const adminSecret = "test-compatibility-token";
const adminKey = (
  await createKey(
    { name: "Test admin", isAdmin: true, allowedStatuses: [] },
    undefined,
    adminSecret,
  )
).key;
const app = await buildApp();
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address() as { port: number };
const origin = `http://127.0.0.1:${address.port}`;
const base = "/api/bugs/v1";
const request = async (method: any, path: string, payload?: any) =>
  app.inject({
    method,
    url: base + path,
    payload,
    headers: { authorization: "Bearer " + adminSecret },
  });
const create = async (text = "Тестовый баг") =>
  (
    await request("POST", "/reports", {
      text,
      context: "seed=42 tick=100",
      reportedInVersion: "0.1.105",
    })
  ).json();
after(async () => {
  await app.close();
  await pool.end();
  await admin.query(`DROP DATABASE "${dbName}"`);
  await admin.end();
});

test("legacy shape, partial updates, nulls, archived filter and errors", async () => {
  const r = await create();
  assert.equal(r.revision, 1);
  assert.deepEqual(r.comments, []);
  assert.equal(r.status, "created");
  const changed = await request("POST", "/reports/" + r.id, {
    text: "Изменён",
    context: "ignored",
    assignedAgent: "/test",
    expectedRevision: 1,
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().context, "seed=42 tick=100");
  assert.equal(changed.json().revision, 2);
  const conflict = await request("POST", "/reports/" + r.id, {
    text: "stale",
    expectedRevision: 1,
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().actualRevision, 2);
  const unchanged = (
    await request("POST", "/reports/" + r.id, { text: null })
  ).json();
  assert.equal(unchanged.text, "Изменён");
  assert.equal(
    (await request("POST", "/reports", { text: "  " })).statusCode,
    400,
  );
  assert.equal(
    (await request("POST", "/reports/" + r.id, { status: "unknown" }))
      .statusCode,
    400,
  );
  assert.equal((await request("GET", "/reports/999999")).statusCode, 404);
  await request("POST", "/reports/" + r.id, {
    status: "fixed",
    archived: true,
  });
  assert.ok(
    (await request("GET", "/reports")).json().some((x: any) => x.id === r.id),
  );
  assert.ok(
    !(await request("GET", "/reports?archived=false"))
      .json()
      .some((x: any) => x.id === r.id),
  );
});
test("concurrent edits have exactly one winner", async () => {
  const r = await create();
  const results = await Promise.all(
    ["one", "two"].map((text) =>
      request("POST", "/reports/" + r.id, { text, expectedRevision: 1 }),
    ),
  );
  assert.deepEqual(results.map((x) => x.statusCode).sort(), [200, 409]);
  assert.equal((await request("GET", "/reports/" + r.id)).json().revision, 2);
});
test("concurrent comments retain ordinals and original authors on edit", async () => {
  const r = await create();
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      request("POST", `/reports/${r.id}/comments`, {
        text: "comment " + i,
        author: i % 2 ? "codex" : "user",
      }),
    ),
  );
  const current = (await request("GET", "/reports/" + r.id)).json();
  assert.equal(current.comments.length, 8);
  assert.equal(current.revision, 9);
  const edited = (
    await request("POST", `/reports/${r.id}/comments/0`, {
      text: "edited",
      author: "evil",
    })
  ).json();
  assert.equal(edited.comments[0].author, current.comments[0].author);
  assert.equal(edited.comments[0].text, "edited");
  assert.equal(edited.revision, 10);
});
test("legacy fixes replacement and atomic player transitions preserve handoff", async () => {
  const r = await create();
  await request("POST", "/reports/" + r.id, {
    status: "ready_for_test",
    assignedAgent: "agent",
    agentHandoff: "handoff",
    fixCommits: ["abc", "def"],
    readyForTestInVersion: "1",
    fixedInVersion: "1",
  });
  const back = (
    await request("POST", `/reports/${r.id}/transition`, {
      action: "rework",
      expectedRevision: 2,
      text: "Ещё воспроизводится",
    })
  ).json();
  assert.equal(back.status, "rework");
  assert.equal(back.readyForTestInVersion, "");
  assert.equal(back.fixedInVersion, "");
  assert.equal(back.agentHandoff, "handoff");
  assert.equal(back.comments[0].text, "Ещё воспроизводится");
  await request("POST", "/reports/" + r.id, { fixCommits: ["xyz"] });
  assert.deepEqual(
    (await request("GET", "/reports/" + r.id)).json().fixCommits,
    ["xyz"],
  );
  assert.equal(
    (
      await request("POST", `/reports/${r.id}/transition`, {
        action: "confirm",
        expectedRevision: 1,
      })
    ).statusCode,
    409,
  );
});
test("pagination is bounded, stable and clamps last page; search treats wildcard literals literally", async () => {
  for (let i = 0; i < 51; i++) await create("pagination " + i);
  const a = (await request("GET", "/query?q=pagination&page=1")).json(),
    b = (await request("GET", "/query?q=pagination&page=2")).json();
  assert.equal(a.items.length, 24);
  assert.equal(a.total, 51);
  assert.equal(a.pages, 3);
  assert.ok(a.items[0].id > a.items[23].id);
  assert.equal(
    a.items.filter((x: any) => b.items.some((y: any) => x.id === y.id)).length,
    0,
  );
  const last = (await request("GET", "/query?q=pagination&page=999")).json();
  assert.equal(last.page, 3);
  assert.equal(last.items.length, 3);
  const literal = await create("literal 100%_bug");
  assert.equal((await request("GET", "/query?q=%25_")).json().total, 1);
  assert.equal(
    (await request("GET", "/query?q=%23" + literal.id)).json().items[0].id,
    literal.id,
  );
});
test("commit upload, short SHA lookup, ambiguous prefix and truncation", async () => {
  const sha = "a".repeat(40);
  const body = { sha, subject: "fix", patch: "x".repeat(1_000_001), files: [] };
  const uploaded = (await request("PUT", "/commits/" + sha, body)).json();
  assert.equal(uploaded.patch.length, 1_000_000);
  assert.equal(uploaded.truncated, true);
  assert.equal((await request("GET", "/commits/aaaaaaa")).json().sha, sha);
  await request("PUT", "/commits/" + "a".repeat(39) + "b", {
    subject: "other",
  });
  assert.equal((await request("GET", "/commits/aaaaaaa")).statusCode, 404);
  assert.equal((await request("GET", "/commits/" + sha)).statusCode, 200);
  assert.equal(
    (await request("PUT", "/commits/" + sha, { sha: "b".repeat(40) }))
      .statusCode,
    400,
  );
});
test("WebSocket emits only after durable writes, including deletion and patches", async () => {
  const ws = new WebSocket(origin.replace("http", "ws") + base + "/events", {
    headers: { Authorization: "Bearer " + adminSecret },
  });
  await once(ws, "open");
  const seen: any[] = [];
  ws.on("message", (data) => seen.push(JSON.parse(data.toString())));
  const r = await create("realtime");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(seen.some((e) => e.type === "report.changed" && e.id === r.id));
  assert.equal((await request("GET", "/reports/" + r.id)).statusCode, 200);
  await request("POST", `/reports/${r.id}/delete`, {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(seen.some((e) => e.type === "report.deleted" && e.id === r.id));
  ws.close();
  await once(ws, "close");
});
test("HexLive Python CLI preserves commands with authenticated reads", async () => {
  const cli = new URL("./fixtures/legacy-bugs.py", import.meta.url).pathname;
  const run = async (...args: string[]) =>
    JSON.parse(
      (
        await exec("python3", [cli, "--api", origin + base, ...args], {
          env: {
            ...process.env,
            HEXLIVE_BUG_TOKEN: "test-compatibility-token",
          },
        })
      ).stdout || "null",
    );
  const r = await run("create", "--text", "Old CLI compatibility");
  const claimed = await run(
    "update",
    String(r.id),
    "--status",
    "in_progress",
    "--assigned-agent",
    "test-agent",
    "--handoff",
    "Взял в работу",
  );
  assert.equal(claimed.assignedAgent, "test-agent");
  const commented = await run(
    "comment",
    String(r.id),
    "--text",
    "Готово",
    "--author",
    "codex",
  );
  assert.equal(commented.comments[0].author, "codex");
  const ready = await run(
    "update",
    String(r.id),
    "--status",
    "ready_for_test",
    "--fix-commits",
    "1".repeat(40),
    "--no-patch",
  );
  assert.equal(ready.status, "ready_for_test");
  assert.equal((await run("get", String(r.id))).id, r.id);
  await run("delete", String(r.id));
  assert.equal((await request("GET", "/reports/" + r.id)).statusCode, 404);
});

test("all report and patch reads and writes require a key; request cannot spoof its actor", async () => {
  for (const method of ["GET", "POST", "DELETE"] as const)
    assert.equal(
      (
        await app.inject({
          method,
          url: base + "/reports/1",
          payload: method === "POST" ? {} : undefined,
        })
      ).statusCode,
      401,
    );
  for (const route of ["/query", "/commits", "/reports", "/events"])
    assert.equal(
      (await app.inject({ method: "GET", url: base + route })).statusCode,
      401,
    );
  assert.equal((await app.inject({ url: "/api/access-keys" })).statusCode, 401);
  const result = await request("POST", "/reports", {
    text: "Attributed",
    createdBy: "forged",
    tokenId: "forged",
  });
  const r = result.json();
  const meta = (await request("GET", "/reports/" + r.id + "/access")).json();
  assert.equal(meta.created.tokenId, adminKey.id);
  assert.equal(meta.created.name, "Test admin");
  assert(!JSON.stringify(meta).includes(adminSecret));
  const stored = await pool.query(
    "SELECT secret_hash FROM access_tokens WHERE id=$1",
    [adminKey.id],
  );
  assert.equal(stored.rows[0].secret_hash, hash(adminSecret));
});

test("status restrictions cannot be bypassed through transitions, archive, versions or token endpoints", async () => {
  const agent = await createKey(
    {
      name: "Limited agent",
      isAdmin: false,
      allowedStatuses: ["created", "in_progress", "ready_for_test", "rework"],
    },
    adminKey,
  );
  const asAgent = (method: any, path: string, payload?: any) =>
    app.inject({
      method,
      url: path,
      payload,
      headers: { authorization: "Bearer " + agent.secret },
    });
  const r = (
    await asAgent("POST", base + "/reports", { text: "Agent issue" })
  ).json();
  assert.equal(
    (
      await asAgent("POST", base + "/reports/" + r.id, {
        status: "ready_for_test",
      })
    ).statusCode,
    200,
  );
  const ready = (await request("GET", "/reports/" + r.id)).json();
  for (const body of [
    { status: "fixed" },
    { archived: true },
    { fixedInVersion: "999" },
    { status: "fixed", text: "bypass" },
  ])
    assert.equal(
      (await asAgent("POST", base + "/reports/" + r.id, body)).statusCode,
      403,
    );
  assert.equal(
    (
      await asAgent("POST", base + "/reports/" + r.id + "/transition", {
        action: "confirm",
        expectedRevision: ready.revision,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await asAgent("DELETE", base + "/reports/" + r.id)).statusCode,
    403,
  );
  assert.equal(
    (
      await asAgent("POST", "/api/access-keys", {
        name: "escalation",
        isAdmin: true,
        allowedStatuses: [],
      })
    ).statusCode,
    403,
  );
  assert.equal((await asAgent("GET", "/api/access-keys")).statusCode, 403);
  assert.deepEqual((await request("GET", "/reports/" + r.id)).json(), ready);
  assert.equal(
    (await request("GET", "/reports/" + r.id + "/access")).json().ready.tokenId,
    agent.key.id,
  );
  const confirmed = await request("POST", "/reports/" + r.id + "/transition", {
    action: "confirm",
    expectedRevision: ready.revision,
  });
  assert.equal(confirmed.statusCode, 200);
  const meta = (await request("GET", "/reports/" + r.id + "/access")).json();
  assert.equal(meta.fixed.tokenId, adminKey.id);
  assert.equal(meta.ready.tokenId, agent.key.id);
  const denied = await createKey(
    { name: "No statuses", isAdmin: false, allowedStatuses: [] },
    adminKey,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base + "/reports",
        headers: { authorization: "Bearer " + denied.secret },
        payload: { text: "No creation" },
      })
    ).statusCode,
    403,
  );
});

test("browser sessions are HttpOnly, protected against cross-site writes, and logout invalidates them", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/session",
    payload: { token: adminSecret },
  });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers["set-cookie"]);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/i);
  assert(!cookie.includes(adminSecret));
  const value = cookie.split(";")[0];
  const headers = { cookie: value, origin: "http://localhost:8082" };
  assert.equal(
    (await app.inject({ url: "/api/auth/me", headers })).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base + "/reports",
        headers: { cookie: value, origin: "https://evil.invalid" },
        payload: { text: "csrf" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base + "/reports",
        headers: { cookie: value },
        payload: { text: "csrf" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/auth/logout", headers }))
      .statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: "/api/auth/me", headers })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/session",
        headers: { origin: "https://evil.invalid" },
        payload: { token: adminSecret },
      })
    ).statusCode,
    403,
  );
});

test("revocation closes sockets, invalidates sessions and bearer; last administrator cannot be revoked", async () => {
  const issued = await app.inject({
    method: "POST",
    url: "/api/access-keys",
    headers: { authorization: "Bearer " + adminSecret },
    payload: {
      name: "Revoke me",
      isAdmin: false,
      allowedStatuses: ["created"],
    },
  });
  assert.equal(issued.statusCode, 201);
  const key = issued.json();
  assert(key.secret);
  assert(!("secret_hash" in key.key));
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/session",
    payload: { token: key.secret },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const ticket = (
    await app.inject({
      method: "POST",
      url: "/api/auth/socket-ticket",
      headers: { cookie, origin: "http://localhost:8082" },
    })
  ).json().ticket;
  const ws = new WebSocket(
    origin.replace("http", "ws") + base + "/events?ticket=" + ticket,
  );
  await once(ws, "open");
  const closed = once(ws, "close");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/access-keys/" + key.key.id + "/revoke",
        headers: { authorization: "Bearer " + adminSecret },
      })
    ).statusCode,
    204,
  );
  const [code] = await closed;
  assert.equal(code, 4401);
  assert.equal(
    (await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        url: base + "/reports",
        headers: { authorization: "Bearer " + key.secret },
      })
    ).statusCode,
    401,
  );
  const keys = await listKeys();
  assert(!JSON.stringify(keys).includes(key.secret));
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/access-keys/" + adminKey.id + "/revoke",
        headers: { authorization: "Bearer " + adminSecret },
      })
    ).statusCode,
    409,
  );
});

test("socket tickets are one-time and unauthenticated upgrades fail", async () => {
  const ticket = (
    await app.inject({
      method: "POST",
      url: "/api/auth/socket-ticket",
      headers: { authorization: "Bearer " + adminSecret },
    })
  ).json().ticket;
  const first = new WebSocket(
    origin.replace("http", "ws") + base + "/events?ticket=" + ticket,
  );
  await once(first, "open");
  first.close();
  await once(first, "close");
  const rejected = async (url: string) =>
    new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode!);
        res.resume();
        ws.terminate();
      });
      ws.on("error", () => {});
      ws.on("open", () => {
        ws.close();
        reject(new Error("Unexpected authenticated socket"));
      });
    });
  assert.equal(
    await rejected(
      origin.replace("http", "ws") + base + "/events?ticket=" + ticket,
    ),
    401,
  );
  assert.equal(
    await rejected(origin.replace("http", "ws") + base + "/events"),
    401,
  );
});
