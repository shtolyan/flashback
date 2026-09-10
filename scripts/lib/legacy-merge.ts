import type { Report } from "@flashback/contracts";

const editable = [
  "text",
  "context",
  "assignedAgent",
  "agentHandoff",
  "fixCommit",
  "reportedInVersion",
  "status",
  "readyForTestInVersion",
  "fixedInVersion",
  "archived",
] as const;
const commentKey = (c: Report["comments"][number]) =>
  JSON.stringify([c.whenUtc, c.author, c.text]);

/** A frozen legacy branch against its pre-cutover baseline. Current user edits win. */
export function mergeReport(
  current: Report,
  baseline: Report,
  legacy: Report,
): Report {
  if (
    current.createdUtc !== legacy.createdUtc ||
    baseline.createdUtc !== legacy.createdUtc
  )
    throw new Error(`Different report identities at #${legacy.id}`);
  const result = structuredClone(current);
  // Revision orders mutations only within one branch. It is not a cross-server timestamp.
  // A legacy branch with fewer revisions is stale: keep its extra history, never its scalar state.
  if (legacy.revision > baseline.revision) {
    for (const key of editable) {
      if (current[key] === baseline[key] && legacy[key] !== baseline[key])
        (result as any)[key] = legacy[key];
    }
    // Status and its version/archive state are one decision. Preserve a player's newer decision.
    if (
      current.status !== baseline.status ||
      current.archived !== baseline.archived
    ) {
      result.status = current.status;
      result.archived = current.archived;
      result.fixedInVersion = current.fixedInVersion;
      result.readyForTestInVersion = current.readyForTestInVersion;
    }
  }
  const existing = new Set(current.comments.map(commentKey));
  const original = new Set(baseline.comments.map(commentKey));
  for (const c of legacy.comments) {
    const key = commentKey(c);
    if (!original.has(key) && !existing.has(key)) {
      result.comments.push(c);
      existing.add(key);
    }
  }
  for (const sha of legacy.fixCommits)
    if (!result.fixCommits.includes(sha) && !baseline.fixCommits.includes(sha))
      result.fixCommits.push(sha);
  if (JSON.stringify(result) !== JSON.stringify(current))
    result.revision = Math.max(current.revision, legacy.revision) + 1;
  return result;
}
