#!/usr/bin/env node
// Run a command against the loopback Postgres from docker-compose.local.yml
// instead of whatever backend/.env points at.
//
// backend/.env carries a remote Supabase URL, so a plain `npm run dev` reaches
// hosted infrastructure. Compose already solves this for the containerised
// backend; this is the same guarantee for the host-run path, without editing
// .env and losing your Supabase access when you do want it.
//
//   node scripts/with-local-db.js nodemon src/server.js
//   node scripts/with-local-db.js prisma migrate deploy
//
// dotenv does not override variables already present in process.env, so the
// values set here win over .env by the time src/config/env.js reads them.

const { spawn } = require("node:child_process");
const net = require("node:net");

// Matches docker-compose.local.yml: the container publishes 5432 on loopback
// 55432, with local-only fixture credentials that are not secrets.
const LOCAL_DATABASE_URL =
  "postgresql://quest:local_quest@127.0.0.1:55432/quest?schema=public";
const HOST = "127.0.0.1";
const PORT = 55432;

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("usage: node scripts/with-local-db.js <command> [args...]");
  process.exit(64);
}

// A missing container is the overwhelmingly likely failure here, and Prisma's
// own error for it is opaque. Say the actual fix instead.
const assertDatabaseReachable = () =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port: PORT });
    const done = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(2000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });

(async () => {
  if (!(await assertDatabaseReachable())) {
    console.error(
      `No Postgres on ${HOST}:${PORT}. Start it first:\n` +
        "  docker compose -f docker-compose.local.yml up -d postgres",
    );
    process.exit(69);
  }

  const child = spawn(command, args, {
    stdio: "inherit",
    // Resolves node_modules/.bin entries (nodemon, prisma) the way npm does.
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: LOCAL_DATABASE_URL,
      DIRECT_URL: LOCAL_DATABASE_URL,
    },
  });

  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
  });
})();
