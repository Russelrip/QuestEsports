const { prisma } = require("../src/lib/prisma");
const { closeDatabase } = require("../src/lib/database");
const { ensureMatchRoom } = require("../src/modules/match-rooms/match-room.service");

const apply = process.argv.includes("--apply");

const main = async () => {
  const matches = await prisma.match.findMany({
    where: {
      status: { notIn: ["completed", "cancelled", "walkover"] },
      matchRoom: null,
      participants: { some: {}, every: { registrationId: { not: null } } },
    },
    select: { id: true, identifier: true },
    take: 500,
  });
  process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "preview", eligible: matches.length, matches }, null, 2)}\n`);
  if (!apply) return;
  let created = 0;
  for (const match of matches) {
    if (await ensureMatchRoom({ matchId: match.id })) created += 1;
  }
  process.stdout.write(`${JSON.stringify({ created }, null, 2)}\n`);
};

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
