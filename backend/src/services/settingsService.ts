import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";

export const SETTINGS_KEYS = {
  pollCron: "poll_cron",
  digestCron: "digest_cron",
  followupAfterDays: "followup_after_days",
  syncFromDate: "sync_from_date",
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
  syncFromDate: string | null;
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
  syncFromDate: null,
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
    [SETTINGS_KEYS.syncFromDate, DEFAULT_SETTINGS.syncFromDate ?? ""],
    [SETTINGS_KEYS.modelEmail, DEFAULT_SETTINGS.modelEmail],
    [SETTINGS_KEYS.modelCv, DEFAULT_SETTINGS.modelCv],
    [SETTINGS_KEYS.modelMatcher, DEFAULT_SETTINGS.modelMatcher],
    [SETTINGS_KEYS.modelExplorer, DEFAULT_SETTINGS.modelExplorer],
    [SETTINGS_KEYS.modelClassification, DEFAULT_SETTINGS.modelClassification],
  ];

  for (const [key, value] of defaults) {
    await (prisma as any).appSetting.upsert({
      where: { userEmail_key: { userEmail: "", key } },
      update: {},
      create: { userEmail: "", key, value },
    });
  }
};

export const getSettings = async (userEmail: string | null): Promise<AppSettings> => {
  if (userEmail === null) return DEFAULT_SETTINGS;

  const rows = await (prisma as any).appSetting.findMany({
    where: {
      userEmail,
      key: {
        in: Object.values(SETTINGS_KEYS),
      },
    },
  });

  const map = new Map<string, string>(rows.map((row: any) => [row.key, row.value]));

  return {
    pollCron: String(map.get(SETTINGS_KEYS.pollCron) ?? DEFAULT_SETTINGS.pollCron),
    digestCron: String(map.get(SETTINGS_KEYS.digestCron) ?? DEFAULT_SETTINGS.digestCron),
    followupAfterDays: Number(map.get(SETTINGS_KEYS.followupAfterDays) ?? DEFAULT_SETTINGS.followupAfterDays),
    syncFromDate: map.get(SETTINGS_KEYS.syncFromDate) ? String(map.get(SETTINGS_KEYS.syncFromDate)) : null,
    modelEmail: String(map.get(SETTINGS_KEYS.modelEmail) ?? DEFAULT_SETTINGS.modelEmail),
    modelCv: String(map.get(SETTINGS_KEYS.modelCv) ?? DEFAULT_SETTINGS.modelCv),
    modelMatcher: String(map.get(SETTINGS_KEYS.modelMatcher) ?? DEFAULT_SETTINGS.modelMatcher),
    modelExplorer: String(map.get(SETTINGS_KEYS.modelExplorer) ?? DEFAULT_SETTINGS.modelExplorer),
    modelClassification: String(map.get(SETTINGS_KEYS.modelClassification) ?? DEFAULT_SETTINGS.modelClassification),
  };
};

export const updateSettings = async (userEmail: string, payload: Partial<AppSettings>): Promise<AppSettings> => {
  const writes: Promise<unknown>[] = [];

  const updateOrStore = (key: string, value: string) => {
    writes.push(
      (prisma as any).appSetting.upsert({
        where: { userEmail_key: { userEmail, key } },
        update: { value },
        create: { userEmail, key, value },
      }),
    );
  };

  if (payload.pollCron) updateOrStore(SETTINGS_KEYS.pollCron, payload.pollCron);
  if (payload.digestCron) updateOrStore(SETTINGS_KEYS.digestCron, payload.digestCron);
  if (typeof payload.followupAfterDays === "number") updateOrStore(SETTINGS_KEYS.followupAfterDays, String(payload.followupAfterDays));
  if (payload.syncFromDate !== undefined) updateOrStore(SETTINGS_KEYS.syncFromDate, payload.syncFromDate ?? "");
  if (payload.modelEmail) updateOrStore(SETTINGS_KEYS.modelEmail, payload.modelEmail);
  if (payload.modelCv) updateOrStore(SETTINGS_KEYS.modelCv, payload.modelCv);
  if (payload.modelMatcher) updateOrStore(SETTINGS_KEYS.modelMatcher, payload.modelMatcher);
  if (payload.modelExplorer) updateOrStore(SETTINGS_KEYS.modelExplorer, payload.modelExplorer);
  if (payload.modelClassification) updateOrStore(SETTINGS_KEYS.modelClassification, payload.modelClassification);

  if (writes.length > 0) {
    try {
      await Promise.all(writes);
      console.log(`[Settings] Successfully updated ${writes.length} settings for ${userEmail}`);
    } catch (err) {
      console.error(`[Settings] Failed to update settings for ${userEmail}:`, err);
      throw err;
    }
  }

  return getSettings(userEmail);
};
