// CI guard (deployment plan Task 6): Quest Prisma owns `public` only. Fail if
// backend/prisma ever references the `valorant` schema or its tables — Prisma
// must never model, migrate, or map VALORANT objects (design §7.1/§7.2).
const fs = require("node:fs");
const path = require("node:path");

const prismaDir = path.join(__dirname, "..", "prisma");

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "schema.prisma" || entry.name.endsWith(".sql")) files.push(full);
  }
})(prismaDir);

const offenders = [];
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  // Schema references only: qualified `valorant.` access or the quoted
  // identifier `"valorant"` (incl. `@@schema("valorant")`). The bare word is
  // legitimate Quest data (`'valorant'` game values, `ValorantBinding*` enums).
  if (/valorant\s*\.|"valorant"/i.test(content)) {
    offenders.push(`${path.relative(prismaDir, file)}: references the valorant schema`);
  }
}

if (offenders.length > 0) {
  console.error("Quest Prisma must never reference the valorant schema:");
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`prisma schema scope: PASS (${files.length} file(s) scanned, no 'valorant' references)`);
