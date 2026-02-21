import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";

export const SETTINGS_KEYS = {
  pollCron: "poll_cron",
  digestCron: "digest_cron",
  followupAfterDays: "followup_after_days",
  syncLookbackDays: "sync_lookback_days",
} as const;

export interface AppSettings {
  pollCron: string;
  digestCron: string;
  followupAfterDays: number;
  syncLookbackDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  pollCron: config.POLL_CRON,
  digestCron: config.DIGEST_CRON,
  followupAfterDays: config.FOLLOWUP_AFTER_DAYS,
  syncLookbackDays: config.SYNC_LOOKBACK_DAYS,
};

export const ensureDefaultSettings = async (): Promise<void> => {
  const defaults: Array<[string, string]> = [
    [SETTINGS_KEYS.pollCron, DEFAULT_SETTINGS.pollCron],
    [SETTINGS_KEYS.digestCron, DEFAULT_SETTINGS.digestCron],
    [SETTINGS_KEYS.followupAfterDays, String(DEFAULT_SETTINGS.followupAfterDays)],
    [SETTINGS_KEYS.syncLookbackDays, String(DEFAULT_SETTINGS.syncLookbackDays)],
  ];

  for (const [key, value] of defaults) {
    await prisma.appSetting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }
};

export const getSettings = async (): Promise<AppSettings> => {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          SETTINGS_KEYS.pollCron,
          SETTINGS_KEYS.digestCron,
          SETTINGS_KEYS.followupAfterDays,
          SETTINGS_KEYS.syncLookbackDays,
        ],
      },
    },
  });

  const map = new Map(rows.map((row) => [row.key, row.value]));

  return {
    pollCron: map.get(SETTINGS_KEYS.pollCron) ?? DEFAULT_SETTINGS.pollCron,
    digestCron: map.get(SETTINGS_KEYS.digestCron) ?? DEFAULT_SETTINGS.digestCron,
    followupAfterDays: Number(map.get(SETTINGS_KEYS.followupAfterDays) ?? DEFAULT_SETTINGS.followupAfterDays),
    syncLookbackDays: Number(map.get(SETTINGS_KEYS.syncLookbackDays) ?? DEFAULT_SETTINGS.syncLookbackDays),
  };
};

export const updateSettings = async (payload: Partial<AppSettings>): Promise<AppSettings> => {
  const writes: Promise<unknown>[] = [];

  if (payload.pollCron) {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: SETTINGS_KEYS.pollCron },
        update: { value: payload.pollCron },
        create: { key: SETTINGS_KEYS.pollCron, value: payload.pollCron },
      }),
    );
  }

  if (payload.digestCron) {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: SETTINGS_KEYS.digestCron },
        update: { value: payload.digestCron },
        create: { key: SETTINGS_KEYS.digestCron, value: payload.digestCron },
      }),
    );
  }

  if (typeof payload.followupAfterDays === "number") {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: SETTINGS_KEYS.followupAfterDays },
        update: { value: String(payload.followupAfterDays) },
        create: { key: SETTINGS_KEYS.followupAfterDays, value: String(payload.followupAfterDays) },
      }),
    );
  }

  if (typeof payload.syncLookbackDays === "number") {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: SETTINGS_KEYS.syncLookbackDays },
        update: { value: String(payload.syncLookbackDays) },
        create: { key: SETTINGS_KEYS.syncLookbackDays, value: String(payload.syncLookbackDays) },
      }),
    );
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }

  return getSettings();
};
