import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { migrate, pool } from "../apps/server/src/database.ts";
import { createKey, hash, listKeys } from "../apps/server/src/access.ts";
import { statuses } from "@flashback/contracts";
// Operator-only CLI through a database connection. Secrets never go to stdout.
const [command, ...args] = process.argv.slice(2);
const option = (name: string) => {
  const n = args.indexOf("--" + name);
  return n < 0 ? undefined : args[n + 1];
};
try {
  await migrate();
  if (command === "list")
    console.log(JSON.stringify(await listKeys(), null, 2));
  else if (command === "bootstrap" || command === "import") {
    const name =
      option("name") ?? (command === "bootstrap" ? "Администратор" : "HexLive");
    const admin = command === "bootstrap";
    const output = option("output");
    const input = option("file");
    if (admin && !output) throw new Error("--output is required");
    if (admin && (await listKeys()).some((k) => k.isAdmin && !k.revokedAt))
      throw new Error("Administrator already exists; use the access-key UI.");
    if (!admin && !input) throw new Error("--file is required");
    const secret = input ? (await readFile(input, "utf8")).trim() : undefined;
    const supplied = option("statuses");
    const allowed = supplied
      ? supplied.split(",")
      : statuses.filter((s) => s !== "fixed");
    if (allowed.some((s) => !statuses.includes(s as any)))
      throw new Error("Unknown status");
    if (
      secret &&
      (
        await pool.query("SELECT 1 FROM access_tokens WHERE secret_hash=$1", [
          hash(secret),
        ])
      ).rowCount
    ) {
      console.log("Existing key retained.");
    } else {
      // Reserve output before creating a key so a file collision cannot lose the secret.
      if (output) {
        await mkdir(path.dirname(path.resolve(output)), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(output, "", { flag: "wx", mode: 0o600 });
      }
      const result = await createKey(
        { name, isAdmin: admin, allowedStatuses: allowed as any },
        undefined,
        secret,
      );
      if (output)
        await writeFile(output, result.secret + "\n", { mode: 0o600 });
      console.log(
        JSON.stringify({
          id: result.key.id,
          name: result.key.name,
          output: output ?? null,
        }),
      );
    }
  } else
    throw new Error(
      "Use bootstrap --output <file>, import --file <file> --name <name> [--statuses created,...], or list",
    );
} finally {
  await pool.end();
}
