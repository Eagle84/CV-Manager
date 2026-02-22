import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";

export const SETTINGS_KEYS = {
  pollCron: "poll_cron",
  digestCron: "digest_cron",
  followupAfterDays: "followup_after_days",
  syncLookbackDays: "sync_lookback_days",
  modelEmail: "model_email",
  modelCv: "model_cv",
  modelMatcher: "model_matcher",
  modelExplorer: "model_explorer",
  modelClassification: "model_classification",
} as const;

export interface AppSettings {
  pollCron: string;
  digestCron: string;
  followupAfterDays: number;
  syncLookbackDays: number;
  modelEmail: string;
  modelCv: string;
  modelMatcher: string;
  modelExplorer: string;
  modelClassification: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  pollCron: config.POLL_CRON,
  digestCron: config.DIGEST_CRON,
  followupAfterDays: config.FOLLOWUP_AFTER_DAYS,
  syncLookbackDays: config.SYNC_LOOKBACK_DAYS,
  modelEmail: config.OLLAMA_MODEL,
  modelCv: config.OLLAMA_MODEL,
  modelMatcher: config.OLLAMA_MODEL,
  modelExplorer: config.OLLAMA_MODEL,
  modelClassification: config.OLLAMA_MODEL,
};

export const ensureDefaultSettings = async (): Promise<void> => {
  const defaults: Array<[string, string]> = [
    [SETTINGS_KEYS.pollCron, DEFAULT_SETTINGS.pollCron],
    [SETTINGS_KEYS.digestCron, DEFAULT_SETTINGS.digestCron],
    [SETTINGS_KEYS.followupAfterDays, String(DEFAULT_SETTINGS.followupAfterDays)],
    [SETTINGS_KEYS.syncLookbackDays, String(DEFAULT_SETTINGS.syncLookbackDays)],
    [SETTINGS_KEYS.modelEmail, DEFAULT_SETTINGS.modelEmail],
    [SETTINGS_KEYS.modelCv, DEFAULT_SETTINGS.modelCv],
    [SETTINGS_KEYS.modelMatcher, DEFAULT_SETTINGS.modelMatcher],
    [SETTINGS_KEYS.modelExplorer, DEFAULT_SETTINGS.modelExplorer],
    [SETTINGS_KEYS.modelClassification, DEFAULT_SETTINGS.modelClassification],
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
          SETTINGS_KEYS.modelEmail,
          SETTINGS_KEYS.modelCv,
          SETTINGS_KEYS.modelMatcher,
          SETTINGS_KEYS.modelExplorer,
          SETTINGS_KEYS.modelClassification,
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
    modelEmail: map.get(SETTINGS_KEYS.modelEmail) ?? DEFAULT_SETTINGS.modelEmail,
    modelCv: map.get(SETTINGS_KEYS.modelCv) ?? DEFAULT_SETTINGS.modelCv,
    modelMatcher: map.get(SETTINGS_KEYS.modelMatcher) ?? DEFAULT_SETTINGS.modelMatcher,
    modelExplorer: map.get(SETTINGS_KEYS.modelExplorer) ?? DEFAULT_SETTINGS.modelExplorer,
    modelClassification: map.get(SETTINGS_KEYS.modelClassification) ?? DEFAULT_SETTINGS.modelClassification,
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

  if (payload.modelEmail) {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: SETTINGS_KEYS.modelEmail },
        update: { value: payload.modelEmail },
        create: { key: SETTINGS_KEYS.modelEmail, value: payload.modelEmail },
      }),
    );
  }

  if (payload.modelCv) {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: SETTINGS_KEYS.modelCv },
        update: { value: payload.modelCv },
        create: { key: SETTINGS_KEYS.modelCv, value: payload.modelCv },
      }),
    );
  }

  if (payload.modelMatcher) {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: SETTINGS_KEYS.modelMatcher },
        update: { value: payload.modelMatcher },
        create: { key: SETTINGS_KEYS.modelMatcher, value: payload.modelMatcher },
      }),
    );
  }

  if (payload.modelClassification) {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: SETTINGS_KEYS.modelClassification },
        update: { value: payload.modelClassification },
        create: { key: SETTINGS_KEYS.modelClassification, value: payload.modelClassification },
      }),
    );
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }

  return getSettings();
};
