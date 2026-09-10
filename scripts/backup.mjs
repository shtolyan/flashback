import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const restoring = process.argv[2] === "restore";
mkdirSync(path.join(root, "backups"), { recursive: true });
const file = restoring
  ? process.argv[3]
  : path.join(
      root,
      "backups",
      `flashback-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`,
    );
if (!file || (restoring && !existsSync(file)))
  throw new Error(
    "Usage: npm run restore -- <backup.dump> <empty-target-database>",
  );
// Restore only into a separately named empty database, never silently over a running instance.
const target = process.argv[4];
if (
  restoring &&
  (!target || target === "flashback" || !/^[a-z][a-z0-9_]+$/.test(target))
)
  throw new Error("Provide a new target database name (not flashback).");
if (restoring) {
  const r = spawnSync(
    "docker",
    ["compose", "exec", "-T", "db", "createdb", "-U", "flashback", target],
    { cwd: root, stdio: "inherit" },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const fd = openSync(file, restoring ? "r" : "wx", 0o600);
const args = [
  "compose",
  "exec",
  "-T",
  "db",
  ...(restoring
    ? [
        "pg_restore",
        "-U",
        "flashback",
        "--no-owner",
        "--exit-on-error",
        "--single-transaction",
        "-d",
        target,
      ]
    : ["pg_dump", "-U", "flashback", "-Fc", "--no-owner", "flashback"]),
];
const r = spawnSync("docker", args, {
  cwd: root,
  stdio: restoring ? [fd, "inherit", "inherit"] : ["ignore", fd, "inherit"],
});
closeSync(fd);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(
  restoring
    ? `Restored into ${target}. Set DATABASE_URL to use it.`
    : `Backup: ${file}`,
);
