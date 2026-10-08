const { prisma } = require("../src/lib/prisma");
const { closeDatabase } = require("../src/lib/database");

// Registration copies roster Discord handles from linked accounts once, at
// submission. Connecting Discord now fills those blanks as it happens, but
// members who connected before that change are still blank on rosters they
// were already on. This fills them from the same source: the OAuth link, with
// the snowflake as the fallback when no username was recorded.
//
// Only blank handles are touched. Preview by default; pass --apply to write.
const apply = process.argv.includes("--apply");

const main = async () => {
  const blankMembers = await prisma.registrationMember.findMany({
    where: { OR: [{ discord: null }, { discord: "" }] },
    select: {
      id: true,
      userId: true,
      emailNormalized: true,
      name: true,
      role: true,
      registration: { select: { teamName: true, tournament: { select: { title: true } } } },
    },
  });

  const userIds = [...new Set(blankMembers.map((member) => member.userId).filter(Boolean))];
  const emails = [...new Set(blankMembers.map((member) => member.emailNormalized).filter(Boolean))];
  // Matching by email only counts when that email is verified, for the same
  // reason as fillMissingRosterDiscord: an unverified account holding a roster
  // address proves nothing about who that roster member is.
  const linkedAccounts = await prisma.oAuthAccount.findMany({
    where: {
      provider: "discord",
      OR: [
        { userId: { in: userIds } },
        { user: { emailNormalized: { in: emails }, emailVerified: true } },
      ],
    },
    select: {
      userId: true,
      providerUserId: true,
      user: { select: { emailNormalized: true, emailVerified: true, discordTag: true } },
    },
  });

  const handleFor = (account) => String(account.user.discordTag || "").trim() || account.providerUserId;
  const handleByUserId = new Map(linkedAccounts.map((account) => [account.userId, handleFor(account)]));
  const handleByEmail = new Map(
    linkedAccounts
      .filter((account) => account.user.emailNormalized && account.user.emailVerified)
      .map((account) => [account.user.emailNormalized, handleFor(account)])
  );

  const fills = blankMembers
    .map((member) => ({
      member,
      handle: (member.userId && handleByUserId.get(member.userId)) || handleByEmail.get(member.emailNormalized) || null,
    }))
    .filter(({ handle }) => Boolean(handle));

  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "preview",
    blankMembers: blankMembers.length,
    fillable: fills.length,
    fills: fills.map(({ member, handle }) => ({
      memberId: member.id,
      name: member.name,
      role: member.role,
      team: member.registration.teamName,
      tournament: member.registration.tournament.title,
      discord: handle,
    })),
  }, null, 2)}\n`);
  if (!apply) return;

  let updated = 0;
  for (const { member, handle } of fills) {
    // Re-checks the blank so a handle written since the preview is kept.
    const result = await prisma.registrationMember.updateMany({
      where: { id: member.id, OR: [{ discord: null }, { discord: "" }] },
      data: { discord: handle },
    });
    updated += result.count;
  }
  process.stdout.write(`${JSON.stringify({ updated }, null, 2)}\n`);
};

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
