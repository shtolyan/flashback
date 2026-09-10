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
const app = await buildApp();
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address() as { port: number };
const origin = `http://127.0.0.1:${address.port}`;
const base = "/api/bugs/v1";
const request = async (method: any, path: string, payload?: any) =>
  app.inject({ method, url: base + path, payload });
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
  const ws = new WebSocket(origin.replace("http", "ws") + base + "/events");
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
test("original HexLive Python CLI works unchanged with --api", async () => {
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
