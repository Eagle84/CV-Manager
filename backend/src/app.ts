import cors from "cors";
import express from "express";
import { z } from "zod";
import { config, hasGoogleConfig } from "./config.js";
import {
  checkDuplicate,
  getCompanyOverview,
  getApplicationDetail,
  getDashboardSummary,
  listApplications,
  patchApplication,
} from "./services/applicationService.js";
import { sendDigest } from "./services/digestService.js";
import { resetTrackingData } from "./services/dataResetService.js";
import {
  disconnectGoogleAccount,
  getConnectedAccount,
  getGoogleAuthUrl,
  handleGoogleOAuthCallback,
} from "./services/gmailService.js";
import { completeFollowup, listFollowups } from "./services/followupService.js";
import { rescheduleIfNeeded } from "./scheduler.js";
import { getSettings, updateSettings } from "./services/settingsService.js";
import { runSync } from "./services/syncService.js";

const asyncHandler =
  <T extends express.RequestHandler>(handler: T): express.RequestHandler =>
  async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };

const patchApplicationSchema = z.object({
  companyName: z.string().optional(),
  companyDomain: z.string().optional(),
  roleTitle: z.string().optional(),
  status: z
    .enum(["submitted", "received", "rejected", "interview", "assessment", "offer", "withdrawn"])
    .optional(),
  notes: z.string().optional(),
  manualStatusLocked: z.boolean().optional(),
});

const settingsSchema = z.object({
  pollCron: z.string().optional(),
  digestCron: z.string().optional(),
  followupAfterDays: z.coerce.number().int().min(1).max(60).optional(),
  syncLookbackDays: z.coerce.number().int().min(1).max(3650).optional(),
});

const getAllowedFrontendOrigins = (frontendOrigin: string): Set<string> => {
  const allowedOrigins = new Set<string>([frontendOrigin]);
  const parsed = new URL(frontendOrigin);

  if (parsed.hostname === "127.0.0.1") {
    parsed.hostname = "localhost";
    allowedOrigins.add(parsed.origin);
  } else if (parsed.hostname === "localhost") {
    parsed.hostname = "127.0.0.1";
    allowedOrigins.add(parsed.origin);
  }

  return allowedOrigins;
};

export const createApp = (): express.Express => {
  const app = express();
  const allowedFrontendOrigins = getAllowedFrontendOrigins(config.FRONTEND_ORIGIN);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedFrontendOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
      credentials: false,
    }),
  );

  app.use(express.json({ limit: "3mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "cv-gmail-tracker" });
  });

  app.get(
    "/api/auth/google/start",
    asyncHandler(async (_req, res) => {
      if (!hasGoogleConfig) {
        res.status(400).json({
          error: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        });
        return;
      }

      const url = getGoogleAuthUrl();
      res.json({ url });
    }),
  );

  app.get(
    "/api/auth/google/status",
    asyncHandler(async (_req, res) => {
      const account = await getConnectedAccount();
      res.json({
        connected: Boolean(account),
        email: account?.email ?? null,
      });
    }),
  );

  app.get(
    "/api/auth/google/callback",
    asyncHandler(async (req, res) => {
      const code = String(req.query.code ?? "");
      if (!code) {
        res.status(400).json({ error: "Missing OAuth code" });
        return;
      }

      await handleGoogleOAuthCallback(code);
      res.redirect(`${config.FRONTEND_ORIGIN}/settings?connected=true`);
    }),
  );

  app.post(
    "/api/auth/google/disconnect",
    asyncHandler(async (_req, res) => {
      await disconnectGoogleAccount();
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/sync/run",
    asyncHandler(async (_req, res) => {
      const result = await runSync();
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    }),
  );

  app.post(
    "/api/data/reset-and-sync",
    asyncHandler(async (_req, res) => {
      const reset = await resetTrackingData();
      const sync = await runSync();

      if (!sync.ok) {
        res.status(400).json({
          ok: false,
          reason: sync.reason,
          reset,
          stats: sync.stats,
        });
        return;
      }

      res.json({
        ok: true,
        reset,
        sync,
      });
    }),
  );

  app.get(
    "/api/dashboard",
    asyncHandler(async (_req, res) => {
      const summary = await getDashboardSummary();
      res.json(summary);
    }),
  );

  app.get(
    "/api/applications",
    asyncHandler(async (req, res) => {
      const result = await listApplications({
        status: req.query.status ? String(req.query.status) : undefined,
        statusGroup:
          req.query.statusGroup === "active" || req.query.statusGroup === "closed"
            ? req.query.statusGroup
            : undefined,
        company: req.query.company ? String(req.query.company) : undefined,
        domain: req.query.domain ? String(req.query.domain) : undefined,
        role: req.query.role ? String(req.query.role) : undefined,
        dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
        dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
        hideUnknownRole: req.query.hideUnknownRole === "true",
        hasNotes: req.query.hasNotes === "true",
        manualOnly: req.query.manualOnly === "true",
      });
      res.json(result);
    }),
  );

  app.get(
    "/api/applications/:id",
    asyncHandler(async (req, res) => {
      const item = await getApplicationDetail(String(req.params.id));
      if (!item) {
        res.status(404).json({ error: "Application not found" });
        return;
      }
      res.json(item);
    }),
  );

  app.get(
    "/api/companies/:companyDomain",
    asyncHandler(async (req, res) => {
      const companyDomain = decodeURIComponent(String(req.params.companyDomain ?? ""));
      const item = await getCompanyOverview(companyDomain);
      if (!item) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      res.json(item);
    }),
  );

  app.patch(
    "/api/applications/:id",
    asyncHandler(async (req, res) => {
      const payload = patchApplicationSchema.parse(req.body);
      const updated = await patchApplication(String(req.params.id), payload);
      if (!updated) {
        res.status(404).json({ error: "Application not found" });
        return;
      }
      res.json(updated);
    }),
  );

  app.get(
    "/api/duplicates/check",
    asyncHandler(async (req, res) => {
      const companyDomain = String(req.query.companyDomain ?? "").trim();
      const roleTitle = String(req.query.roleTitle ?? "").trim();
      if (!companyDomain || !roleTitle) {
        res.status(400).json({ error: "companyDomain and roleTitle are required" });
        return;
      }
      const result = await checkDuplicate(companyDomain, roleTitle);
      res.json(result);
    }),
  );

  app.get(
    "/api/followups",
    asyncHandler(async (req, res) => {
      const state = req.query.state ? String(req.query.state) : undefined;
      const followups = await listFollowups(
        state === "open" || state === "done" || state === "snoozed" ? state : undefined,
      );

      res.json(
        followups.map((item) => ({
          id: item.id,
          applicationId: item.applicationId,
          dueAt: item.dueAt.toISOString(),
          reason: item.reason,
          state: item.state,
          application: {
            id: item.application.id,
            companyName: item.application.companyName,
            companyDomain: item.application.companyDomain,
            roleTitle: item.application.roleTitle,
            status: item.application.status,
          },
        })),
      );
    }),
  );

  app.post(
    "/api/followups/:id/done",
    asyncHandler(async (req, res) => {
      const updated = await completeFollowup(String(req.params.id));
      res.json({
        id: updated.id,
        state: updated.state,
      });
    }),
  );

  app.post(
    "/api/digest/send",
    asyncHandler(async (_req, res) => {
      const result = await sendDigest();
      if (!result.sent) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    }),
  );

  app.get(
    "/api/settings",
    asyncHandler(async (_req, res) => {
      const settings = await getSettings();
      const account = await getConnectedAccount();
      res.json({
        ...settings,
        connectedEmail: account?.email ?? null,
      });
    }),
  );

  app.patch(
    "/api/settings",
    asyncHandler(async (req, res) => {
      const payload = settingsSchema.parse(req.body);
      const updated = await updateSettings(payload);
      await rescheduleIfNeeded();
      res.json(updated);
    }),
  );

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    res.status(500).json({ error: message });
  });

  return app;
};
