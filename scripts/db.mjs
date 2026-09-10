// Manages the project-local Postgres (.pgdata, port 5433) through pg_ctl.
//
// Why a script instead of calling pg_ctl straight from package.json: npm runs
// scripts through cmd.exe on Windows, and a command line that starts with a
// quoted path ("C:\Program Files\...") and carries further quoted arguments
// has its quotes stripped by cmd — the old one-liner died with
// "'C:\Program' is not recognized as an internal or external command".
// Spawning pg_ctl with an argument array involves no shell and no quoting.
//
// Usage: node scripts/db.mjs <start|stop|status>
// Set PG_BIN when PostgreSQL 17 isn't installed in the default location.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const binDir = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/17/bin";
const pgCtl = path.join(binDir, process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");

const args = {
  start: ["-D", ".pgdata", "-o", "-p 5433", "-l", ".pgdata/pg.log", "-w", "start"],
  stop: ["-D", ".pgdata", "stop"],
  status: ["-D", ".pgdata", "status"],
};

const command = process.argv[2];
if (!Object.hasOwn(args, command)) {
  console.error(`usage: node scripts/db.mjs <${Object.keys(args).join("|")}>`);
  process.exit(2);
}
if (!existsSync(pgCtl)) {
  console.error(`pg_ctl not found at ${pgCtl} — set PG_BIN to your PostgreSQL bin directory.`);
  process.exit(1);
}

// Inherit stdio rather than piping it: the postgres process that pg_ctl
// launches can keep its parent's output handles open for as long as the
// server runs, so a piped stream here would never reach end-of-file.
const result = spawnSync(pgCtl, args[command], { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
