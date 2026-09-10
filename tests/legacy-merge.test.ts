import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeReport } from "../scripts/lib/legacy-merge.ts";
import type { Report } from "@flashback/contracts";
const base: Report = {
  id: 1,
  createdUtc: "2026-09-01",
  status: "in_progress",
  text: "bug",
  context: "",
  assignedAgent: "agent",
  agentHandoff: "",
  fixCommit: "",
  fixCommits: [],
  reportedInVersion: "",
  readyForTestInVersion: "",
  fixedInVersion: "",
  archived: false,
  revision: 3,
  comments: [],
};
test("imports legacy progress and extra history without mutating inputs", () => {
  const legacy = {
    ...base,
    revision: 5,
    status: "ready_for_test" as const,
    fixCommits: ["abc"],
    comments: [{ whenUtc: "today", author: "codex", text: "done" }],
  };
  const result = mergeReport(base, base, legacy);
  assert.equal(result.status, "ready_for_test");
  assert.equal(result.revision, 6);
  assert.deepEqual(result.fixCommits, ["abc"]);
  assert.equal(base.comments.length, 0);
});
test("keeps player confirmation and version while merging agent history", () => {
  const live = {
    ...base,
    status: "fixed" as const,
    revision: 6,
    fixedInVersion: "1.0",
  };
  const result = mergeReport(live, base, {
    ...base,
    status: "ready_for_test",
    readyForTestInVersion: "0.9",
    revision: 9,
    fixCommits: ["abc"],
  });
  assert.equal(result.status, "fixed");
  assert.equal(result.fixedInVersion, "1.0");
  assert.equal(result.readyForTestInVersion, "");
  assert.deepEqual(result.fixCommits, ["abc"]);
});
test("does not restore baseline comments edited after cutover or duplicate extra comments", () => {
  const old = { whenUtc: "today", author: "user", text: "old" },
    newer = { ...old, text: "edited" },
    extra = { ...old, author: "codex", text: "extra" };
  const before = { ...base, comments: [old] };
  const live = { ...base, revision: 7, comments: [newer, extra] };
  assert.deepEqual(
    mergeReport(live, before, { ...base, comments: [old, extra] }).comments,
    [newer, extra],
  );
});
test("rejects colliding identities and ignores stale scalar state", () => {
  assert.throws(() =>
    mergeReport(base, base, { ...base, createdUtc: "other" }),
  );
  assert.equal(
    mergeReport(base, base, { ...base, revision: 2, text: "stale" }).text,
    "bug",
  );
});
