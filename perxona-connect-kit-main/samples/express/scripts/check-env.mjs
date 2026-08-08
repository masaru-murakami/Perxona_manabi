#!/usr/bin/env node
// Pre-flight checks run before `npm start` / `npm run dev` (see package.json
// "prestart"/"predev"). Two independent guards, both meant to fail fast with a
// friendly message instead of a cryptic native error:
//
// 1. Node version — `npm install` only enforces "engines" when `engine-strict`
//    is set (see .npmrc), so a participant who already has node_modules from
//    an older install, or whose shell later switches Node versions (e.g. nvm
//    without `.nvmrc` picked up), can still reach `npm start`/`dev` on an
//    unsupported Node. Catch that here with an actionable message.
// 2. `.env` file — `node --env-file=.env` exits first with Node's generic
//    "node: .env: not found" if `.env` doesn't exist yet (e.g. a fresh clone
//    that skipped `cp .env.example .env`), before server.mjs's own credential
//    checks (which only cover blank *values*) ever get a chance to run.
import { existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url)),
);
const requiredMajor = Number(pkg.engines.node.match(/\d+/)[0]);
const currentMajor = Number(process.versions.node.split(".")[0]);

if (currentMajor < requiredMajor) {
  console.error(
    `ERROR: Node ${process.version} is too old — this kit requires Node >=${requiredMajor}.\n` +
      "If you use nvm:  nvm install && nvm use   (reads .nvmrc)\n" +
      "Otherwise, upgrade Node: https://nodejs.org/",
  );
  process.exit(1);
}

if (!existsSync(".env")) {
  console.error(
    "ERROR: .env not found. Copy .env.example to .env and fill in your Perxona credentials:\n" +
      "  cp .env.example .env",
  );
  process.exit(1);
}
