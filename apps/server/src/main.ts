import { buildApp } from "./app.ts";
import { migrate, pool } from "./database.ts";
import { settings } from "./config.ts";
await migrate();
const app = await buildApp();
await app.listen({ port: settings.port, host: settings.host });
console.log(`Flashback · ${settings.name} · http://localhost:${settings.port}`);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
