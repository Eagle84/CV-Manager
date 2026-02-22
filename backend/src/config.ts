import "dotenv/config";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "backend", ".env") }); // Also check subfolder if run from root
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("127.0.0.1"),
  FRONTEND_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  APP_BASE_URL: z.string().url().default("http://127.0.0.1:8787"),
  DATABASE_URL: z.string().default("file:./dev.db"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().url().default("http://127.0.0.1:8787/api/auth/google/callback"),
  ALLOWED_GMAIL: z.string().default(""),
  ENCRYPTION_KEY: z.string().min(16).default("change-this-to-a-32-byte-random-secret"),
  POLL_CRON: z.string().default("*/5 * * * *"),
  DIGEST_CRON: z.string().default("0 8 * * *"),
  FOLLOWUP_AFTER_DAYS: z.coerce.number().int().positive().default(7),
  SYNC_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(3650).default(120),
  STATUS_FORCE_OVERRIDE: z.coerce.boolean().default(false),
  SYNC_SUBJECT_FOCUS: z.string().default(""),
  OLLAMA_ENABLED: z.coerce.boolean().default(true),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("llama31_16k:latest"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  OLLAMA_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const config = parsed.data;

export const hasGoogleConfig =
  config.GOOGLE_CLIENT_ID.length > 0 && config.GOOGLE_CLIENT_SECRET.length > 0;
