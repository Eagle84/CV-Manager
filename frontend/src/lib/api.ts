import axios from "axios";
import type { ApplicationDetail, ApplicationSummary, DashboardSummary, DuplicateCheckResponse } from "shared";

const SESSION_TOKEN_KEY = "cv_manager_session_token";
const ACTIVE_USER_EMAIL_KEY = "cv_manager_active_email";

export const setSessionToken = (token: string | null) => {
  if (token) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
};

export const getSessionToken = (): string | null => {
  return localStorage.getItem(SESSION_TOKEN_KEY);
};

export const setActiveUserEmail = (email: string | null) => {
  if (email) {
    localStorage.setItem(ACTIVE_USER_EMAIL_KEY, email);
  } else {
    localStorage.removeItem(ACTIVE_USER_EMAIL_KEY);
  }
};

export const getActiveUserEmail = (): string | null => {
  return localStorage.getItem(ACTIVE_USER_EMAIL_KEY);
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8787",
  timeout: 60000,
});

// Attach the active user email to every request
// Attach the session token to every request
api.interceptors.request.use((config) => {
  const token = getSessionToken();
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// Handle unauthorized responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      setSessionToken(null);
      setActiveUserEmail(null);
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export interface FollowupItem {
  id: string;
  applicationId: string;
  dueAt: string;
  reason: string;
  state: "open" | "done" | "snoozed";
  application: {
    id: string;
    companyName: string;
    companyDomain: string;
    roleTitle: string;
    status: string;
  };
}

export interface CompanyOverviewPosition {
  id: string;
  roleTitle: string;
  normalizedRoleTitle: string;
  groupSenderDomain?: string;
  groupSubjectKey?: string;
  status: string;
  firstSeenAt: string;
  lastActivityAt: string;
  notes: string;
  manualStatusLocked: boolean;
  latestEvent: {
    eventType: string;
    eventAt: string;
  } | null;
  nextFollowupAt: string | null;
  latestEmail: {
    subject: string;
    receivedAt: string | null;
    classification: string;
  } | null;
}

export interface CompanyOverviewDto {
  companyName: string;
  companyDomain: string;
  totalApplications: number;
  activeApplications: number;
  closedApplications: number;
  followupsOpen: number;
  firstSeenAt: string;
  lastActivityAt: string;
  statusCounts: Record<string, number>;
  profile: {
    websiteUrl: string | null;
    careersUrl: string | null;
    sourceDomain: string;
    pageTitle: string | null;
    pageDescription: string | null;
  };
  insights: {
    emailsTracked: number;
    inboundEmails: number;
    uniqueRoles: number;
    responseRate: number;
    decisionRate: number;
    topSenderDomains: string[];
    lastIncomingEmailAt: string | null;
  };
  positions: CompanyOverviewPosition[];
}

export interface SettingsDto {
  pollCron: string;
  digestCron: string;
  followupAfterDays: number;
  syncFromDate: string | null;
  connectedEmail: string | null;
  connectedEmails: string[];
  modelEmail: string;
  modelCv: string;
  modelMatcher: string;
  modelExplorer: string;
  modelClassification: string;
}

export interface SyncResponse {
  ok: boolean;
  reason?: string;
  stats: {
    scanned: number;
    importedEmails: number;
    applicationsCreatedOrUpdated: number;
    statusesUpdated: number;
    needsReview: number;
    aiProcessed: number;
    aiFallbackUsed: number;
    aiSkipped: number;
  };
}

export interface ResetAndSyncResponse {
  ok: boolean;
  reason?: string;
  reset: {
    emailsDeleted: number;
    applicationsDeleted: number;
    checkpointsReset: number;
  };
  sync: SyncResponse;
}

export interface CvDto {
  id: string;
  filename: string;
  isDefault: boolean;
  skills: string;
  summary: string;
  rolePrimary: string;
  experienceYears: string;
  createdAt: string;
}

export interface JobAnalysisResult {
  url: string;
  jdSnippet: string;
  analysis: {
    matchScore: number;
    matchingSkills: string[];
    missingSkills: string[];
    strengths: string[];
    overqualifiedSkills: string[];
    advice: string;
  };
}

export interface BatchItem {
  url: string;
  company?: string;
  status: "pending" | "running" | "done" | "error";
  result?: JobAnalysisResult;
  error?: string;
}

export interface BatchJob {
  id: string;
  status: "running" | "done";
  items: BatchItem[];
  progress: { done: number; total: number };
}

export const apiClient = {
  fetchDashboard: async (): Promise<DashboardSummary> => {
    const response = await api.get<DashboardSummary>("/api/dashboard");
    return response.data;
  },
  fetchApplications: async (filters: {
    status?: string;
    statusGroup?: "active" | "closed";
    company?: string;
    domain?: string;
    role?: string;
    dateFrom?: string;
    dateTo?: string;
    hideUnknownRole?: boolean;
    hasNotes?: boolean;
    manualOnly?: boolean;
  }): Promise<ApplicationSummary[]> => {
    const response = await api.get<ApplicationSummary[]>("/api/applications", { params: filters });
    return response.data;
  },
  fetchApplicationDetail: async (id: string): Promise<ApplicationDetail> => {
    const response = await api.get<ApplicationDetail>(`/api/applications/${id}`);
    return response.data;
  },
  patchApplication: async (
    id: string,
    payload: {
      status?: string;
      notes?: string;
      roleTitle?: string;
      companyName?: string;
      companyDomain?: string;
      manualStatusLocked?: boolean;
    },
  ): Promise<ApplicationSummary> => {
    const response = await api.patch<ApplicationSummary>(`/api/applications/${id}`, payload);
    return response.data;
  },
  checkDuplicate: async (companyDomain: string, roleTitle: string): Promise<DuplicateCheckResponse> => {
    const response = await api.get<DuplicateCheckResponse>("/api/duplicates/check", {
      params: { companyDomain, roleTitle },
    });
    return response.data;
  },
  fetchFollowups: async (): Promise<FollowupItem[]> => {
    const response = await api.get<FollowupItem[]>("/api/followups", { params: { state: "open" } });
    return response.data;
  },
  fetchCompanyOverview: async (companyDomain: string): Promise<CompanyOverviewDto> => {
    const response = await api.get<CompanyOverviewDto>(`/api/companies/${encodeURIComponent(companyDomain)}`);
    return response.data;
  },
  completeFollowup: async (id: string): Promise<void> => {
    await api.post(`/api/followups/${id}/done`);
  },
  getSettings: async (): Promise<SettingsDto> => {
    const response = await api.get<SettingsDto>("/api/settings");
    return response.data;
  },
  updateSettings: async (payload: {
    pollCron?: string;
    digestCron?: string;
    followupAfterDays?: number;
    syncFromDate?: string | null;
    modelEmail?: string;
    modelCv?: string;
    modelMatcher?: string;
    modelExplorer?: string;
    modelClassification?: string;
  }): Promise<SettingsDto> => {
    const response = await api.patch<SettingsDto>("/api/settings", payload);
    return response.data;
  },
  getOllamaModels: async (): Promise<string[]> => {
    const response = await api.get<string[]>("/api/ollama/models");
    return response.data;
  },
  getAuthStatus: async (): Promise<{ connected: boolean; email: string | null; connectedEmails: string[] }> => {
    try {
      const response = await api.get<{ connected: boolean; email: string | null; connectedEmails: string[] }>("/api/auth/google/status");
      return response.data;
    } catch (err) {
      return { connected: false, email: null, connectedEmails: [] };
    }
  },
  getGoogleAuthUrl: async (mode: "login" | "connect" = "login"): Promise<string> => {
    const response = await api.get<{ url: string }>("/api/auth/google/start", { params: { mode } });
    return response.data.url;
  },
  logout: async (): Promise<void> => {
    await api.post("/api/auth/logout").catch(() => { });
    setSessionToken(null);
    setActiveUserEmail(null);
    window.location.href = "/login";
  },
  disconnectGoogle: async (email: string): Promise<void> => {
    await api.post("/api/auth/google/disconnect", { email });
  },
  runSync: async (): Promise<SyncResponse> => {
    const response = await api.post<SyncResponse>("/api/sync/run", undefined, { timeout: 600000 });
    return response.data;
  },
  sendDigest: async (): Promise<{ sent: boolean; reason?: string }> => {
    const response = await api.post<{ sent: boolean; reason?: string }>("/api/digest/send");
    return response.data;
  },
  resetAndSync: async (): Promise<ResetAndSyncResponse> => {
    const response = await api.post<ResetAndSyncResponse>("/api/data/reset-and-sync", undefined, {
      timeout: 900000,
    });
    return response.data;
  },
  fetchCvs: async (): Promise<CvDto[]> => {
    const response = await api.get<CvDto[]>("/api/cvs");
    return response.data;
  },
  uploadCv: async (file: File): Promise<CvDto> => {
    const formData = new FormData();
    formData.append("cv", file);
    const response = await api.post<CvDto>("/api/cvs", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 300000, // 5 mins
    });
    return response.data;
  },
  deleteCv: async (id: string): Promise<void> => {
    await api.delete(`/api/cvs/${id}`);
  },
  setDefaultCv: async (id: string): Promise<void> => {
    await api.patch(`/api/cvs/${id}/default`);
  },
  analyzeJobUrl: async (url: string): Promise<JobAnalysisResult> => {
    const response = await api.post<JobAnalysisResult>("/api/analyze/url", { url }, { timeout: 300000 });
    return response.data;
  },
  exploreJobsOnPage: async (url: string): Promise<{ title: string; url: string; reasoning: string }[]> => {
    const response = await api.post<{ title: string; url: string; reasoning: string }[]>("/api/analyze/explore", { url }, { timeout: 600000 });
    return response.data;
  },
  startBatchAnalysis: async (items: { url: string; company?: string }[]): Promise<{ batchId: string }> => {
    const response = await api.post<{ batchId: string }>("/api/analyze/batch", { items });
    return response.data;
  },
  importTargetCompanies: async (items: { url: string; company?: string }[]): Promise<{ count: number }> => {
    const response = await api.post<{ count: number }>("/api/analyze/import", { items });
    return response.data;
  },
  getBatchStatus: async (batchId: string): Promise<BatchJob> => {
    const response = await api.get<BatchJob>(`/api/analyze/batch/${batchId}`);
    return response.data;
  },
  fetchTargetCompanies: async (page: number = 1, limit: number = 10, search?: string): Promise<TargetCompanyListResponse> => {
    const response = await api.get<TargetCompanyListResponse>("/api/analyze/target-companies", {
      params: { page, limit, search },
    });
    return response.data;
  },
};

export interface TargetCompanyDto {
  id: string;
  name: string;
  url: string;
  industry?: string;
  createdAt: string;
}

export interface TargetCompanyListResponse {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  items: TargetCompanyDto[];
}
