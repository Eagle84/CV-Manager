import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { startSchedulers } from "./scheduler.js";
import { ensureDefaultSettings } from "./services/settingsService.js";

const start = async (): Promise<void> => {
  await prisma.$connect();
  await ensureDefaultSettings();

  const app = createApp();
  app.listen(config.PORT, config.HOST, async () => {
    logger.info(`API listening on http://${config.HOST}:${config.PORT}`);
    await startSchedulers();
  });
};

start().catch(async (error) => {
  logger.error("Failed to start server", error);
  await prisma.$disconnect();
  process.exit(1);
});
