import { migrate, pool } from "../apps/server/src/database.ts";
try {
  await migrate();
  console.log("Migrations applied.");
} finally {
  await pool.end();
}
