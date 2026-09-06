#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(project, ".scratch", "pack");
const cache = path.join(scratch, "npm-cache");
const temp = path.join(scratch, "temp");
mkdirSync(cache, { recursive: true });
mkdirSync(temp, { recursive: true });

const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli)) {
  throw new Error("pack:check must run through npm so npm_execpath is available");
}
const result = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--ignore-scripts"], {
  cwd: project,
  stdio: "inherit",
  env: {
    ...process.env,
    npm_config_cache: cache,
    TMP: temp,
    TEMP: temp,
    TMPDIR: temp,
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
