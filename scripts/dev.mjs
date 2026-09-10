import { spawn, spawnSync } from "node:child_process";
import "dotenv/config";
const database = spawnSync("npm", ["run", "db:up"], { stdio: "inherit" });
if (database.status !== 0) process.exit(database.status ?? 1);
const children = [
  spawn("npm", ["run", "start"], { stdio: "inherit" }),
  spawn("npm", ["run", "web"], { stdio: "inherit" }),
];
let ending = false;
const stop = () => {
  if (ending) return;
  ending = true;
  for (const c of children) c.kill("SIGTERM");
};
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, stop);
for (const c of children) c.on("exit", stop);
