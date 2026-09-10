import { request } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import os from "node:os";
export default async function setup() {
  const token = (
    await readFile(
      process.env.FLASHBACK_TEST_TOKEN_FILE ??
        os.homedir() + "/.config/flashback/local-admin-token",
      "utf8",
    )
  ).trim();
  const api = await request.newContext({
    baseURL: "http://localhost:4310",
    extraHTTPHeaders: { Origin: "http://localhost:4310" },
  });
  const response = await api.post("/api/auth/session", { data: { token } });
  if (!response.ok())
    throw new Error("Local test login failed: " + response.status());
  await mkdir(".playwright", { recursive: true, mode: 0o700 });
  await api.storageState({ path: ".playwright/auth.json" });
  await api.dispose();
}
