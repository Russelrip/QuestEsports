require("dotenv").config();
const app = require("./app");
const { env } = require("./config/env");
const { initializeDatabase, closeDatabase } = require("./config/database");
const { ensureUploadDirectories } = require("./middleware/upload");

const start = async () => {
  await ensureUploadDirectories();
  await initializeDatabase();

  const server = app.listen(env.PORT, () => {
    console.log(`Quest Esports API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down Quest Esports API.`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

start().catch(async (error) => {
  console.error("Failed to start Quest Esports API.", error);
  await closeDatabase();
  process.exit(1);
});
