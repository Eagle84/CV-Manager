import cron, { type ScheduledTask } from "node-cron";
import { logger } from "./lib/logger.js";
import { runSync } from "./services/syncService.js";
import { sendDigest } from "./services/digestService.js";
import { getSettings } from "./services/settingsService.js";

let pollTask: ScheduledTask | null = null;
let digestTask: ScheduledTask | null = null;

const createPollTask = (pollCron: string): ScheduledTask =>
  cron.schedule(pollCron, async () => {
    try {
      await runSync();
    } catch (error) {
      logger.error("Scheduled sync failed", error);
    }
  });

const createDigestTask = (digestCron: string): ScheduledTask =>
  cron.schedule(digestCron, async () => {
    try {
      await sendDigest();
    } catch (error) {
      logger.error("Scheduled digest failed", error);
    }
  });

const stopTask = (task: ScheduledTask | null): void => {
  if (!task) {
    return;
  }
  task.stop();
  task.destroy();
};

export const startSchedulers = async (): Promise<void> => {
  const settings = await getSettings("");
  pollTask = createPollTask(settings.pollCron);
  digestTask = createDigestTask(settings.digestCron);
  logger.info("Schedulers started", settings);
};

export const rescheduleIfNeeded = async (): Promise<void> => {
  const settings = await getSettings("");

  stopTask(pollTask);
  stopTask(digestTask);

  pollTask = createPollTask(settings.pollCron);
  digestTask = createDigestTask(settings.digestCron);

  logger.info("Schedulers reloaded", settings);
};
