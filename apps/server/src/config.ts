import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const root = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: path.join(root, ".env"), quiet: true });
export const settings = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://flashback:flashback_local@127.0.0.1:5437/flashback",
  port: Number(process.env.PORT ?? 4310),
  host: process.env.HOST ?? "0.0.0.0",
  name: process.env.INSTANCE_NAME ?? "HexLive",
  repository:
    process.env.REPOSITORY_URL?.replace(/\.git$/, "").replace(/\/$/, "") ?? "",
};
