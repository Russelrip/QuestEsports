const { prisma } = require("./prisma");
const { TOURNAMENT_CATALOGUE } = require("../constants/tournaments");

const initializeDatabase = async () => {
  await prisma.$connect();

  await Promise.all(
    TOURNAMENT_CATALOGUE.map((tournament) =>
      prisma.tournament.upsert({
        where: { slug: tournament.slug },
        update: {
          title: tournament.title,
          isActive: tournament.isActive,
        },
        create: {
          slug: tournament.slug,
          title: tournament.title,
          isActive: tournament.isActive,
        },
      })
    )
  );
};

const closeDatabase = async () => {
  await prisma.$disconnect();
};

module.exports = {
  initializeDatabase,
  closeDatabase,
};
