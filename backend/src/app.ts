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
import multer from "multer";
import { listCvs, deleteCv, setDefaultCv, processCvUpload } from "./services/cvService.js";
import { analyzeJobUrl, findMatchingJobsOnPage, listTargetCompanies, saveTargetCompanies } from "./services/analyzerService.js";
import { randomUUID } from "crypto";

interface BatchItem {
  url: string;
  company?: string;
  status: "pending" | "running" | "done" | "error";
  result?: any;
  error?: string;
}

interface BatchJob {
  id: string;
  status: "running" | "done";
  items: BatchItem[];
  progress: { done: number; total: number };
}

const batchJobs = new Map<string, BatchJob>();


const upload = multer({ dest: "uploads/cvs" });

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
  modelEmail: z.string().optional(),
  modelCv: z.string().optional(),
  modelMatcher: z.string().optional(),
  modelExplorer: z.string().optional(),
  modelClassification: z.string().optional(),
});

const getAllowedFrontendOrigins = (frontendOrigin: string): Set<string> => {
  const allowedOrigins = new Set<string>([
    frontendOrigin,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
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
    "/api/ollama/models",
    asyncHandler(async (_req, res) => {
      try {
        const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`);
        if (!response.ok) throw new Error("Failed to fetch models from Ollama");
        const data = await response.json() as any;
        res.json(data.models.map((m: any) => m.name));
      } catch (err) {
        res.json([]); // Return empty list on failure instead of error
      }
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

  // --- CV Management ---

  app.get(
    "/api/cvs",
    asyncHandler(async (_req, res) => {
      const cvs = await listCvs();
      res.json(cvs);
    }),
  );

  app.post(
    "/api/cvs",
    upload.single("cv"),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const cv = await processCvUpload(req.file.path, req.file.originalname, req.file.mimetype);
      res.json(cv);
    }),
  );

  app.delete(
    "/api/cvs/:id",
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      await deleteCv(id);
      res.json({ ok: true });
    }),
  );

  app.patch(
    "/api/cvs/:id/default",
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      await setDefaultCv(id);
      res.json({ ok: true });
    }),
  );

  // --- Job Analysis ---

  app.post(
    "/api/analyze/url",
    asyncHandler(async (req, res) => {
      const { url } = z.object({ url: z.string().url() }).parse(req.body);
      const result = await analyzeJobUrl(url);
      res.json(result);
    }),
  );

  app.post(
    "/api/analyze/explore",
    asyncHandler(async (req, res) => {
      const { url } = z.object({ url: z.string().url() }).parse(req.body);
      const result = await findMatchingJobsOnPage(url);
      res.json(result);
    }),
  );

  app.get(
    "/api/analyze/target-companies",
    asyncHandler(async (req, res) => {
      const page = parseInt(String(req.query.page || "1"));
      const limit = parseInt(String(req.query.limit || "10"));
      const search = req.query.search ? String(req.query.search) : undefined;
      const result = await listTargetCompanies(page, limit, search);
      res.json(result);
    }),
  );

  app.post(
    "/api/analyze/import",
    asyncHandler(async (req, res) => {
      const itemsSchema = z.array(z.object({ url: z.string().url(), company: z.string().optional() }));
      const { items } = z.object({ items: itemsSchema }).parse(req.body);

      // Only persist to DB, do not start background analysis
      const result = await saveTargetCompanies(items.map(it => ({ name: it.company || "Unknown Company", url: it.url })));
      res.json({ count: result.length });
    }),
  );

  app.post(
    "/api/analyze/batch",
    asyncHandler(async (req, res) => {
      const itemsSchema = z.array(z.object({ url: z.string().url(), company: z.string().optional() }));
      const { items } = z.object({ items: itemsSchema }).parse(req.body);

      const batchId = randomUUID();
      const job: BatchJob = {
        id: batchId,
        status: "running",
        items: items.map((it) => ({ ...it, status: "pending" })),
        progress: { done: 0, total: items.length },
      };

      batchJobs.set(batchId, job);

      // Sequential processing loop (not awaited)
      (async () => {
        // Persist these to DB in background so we don't block the UI
        try {
          await saveTargetCompanies(items.map(it => ({ name: it.company || "Unknown Company", url: it.url })));
        } catch (err) {
          console.error("Failed to save target companies in background:", err);
        }

        for (const item of job.items) {
          item.status = "running";
          try {
            item.result = await analyzeJobUrl(item.url);
            item.status = "done";
          } catch (err: any) {
            item.status = "error";
            item.error = err.message || "Failed to analyze URL";
          }
          job.progress.done++;
        }
        job.status = "done";
      })();

      res.json({ batchId });
    }),
  );

  app.get(
    "/api/analyze/batch/:id",
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const job = batchJobs.get(id);
      if (!job) {
        return res.status(404).json({ error: "Batch job not found" });
      }
      res.json(job);
    }),
  );


  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    res.status(500).json({ error: message });
  });

  return app;
};
