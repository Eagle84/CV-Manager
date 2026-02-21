import axios from "axios";
import type { ApplicationDetail, ApplicationSummary, DashboardSummary, DuplicateCheckResponse } from "shared";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8787",
  timeout: 30000,
});

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
  syncLookbackDays: number;
  connectedEmail: string | null;
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
    syncLookbackDays?: number;
  }): Promise<SettingsDto> => {
    const response = await api.patch<SettingsDto>("/api/settings", payload);
    return response.data;
  },
  getAuthStatus: async (): Promise<{ connected: boolean; email: string | null }> => {
    const response = await api.get<{ connected: boolean; email: string | null }>("/api/auth/google/status");
    return response.data;
  },
  getGoogleAuthUrl: async (): Promise<string> => {
    const response = await api.get<{ url: string }>("/api/auth/google/start");
    return response.data.url;
  },
  disconnectGoogle: async (): Promise<void> => {
    await api.post("/api/auth/google/disconnect");
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
};
