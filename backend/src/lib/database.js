const { prisma } = require("./prisma");

const initializeDatabase = async () => {
  await prisma.$connect();
};

const closeDatabase = async () => {
  await prisma.$disconnect();
};

module.exports = {
  initializeDatabase,
  closeDatabase,
};
