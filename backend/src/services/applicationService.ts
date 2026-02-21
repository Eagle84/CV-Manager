import { Prisma, type Application } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { buildDuplicateKey, extractDomainFromEmail, normalizeRole } from "../utils/normalize.js";

export interface ApplicationSummary {
  id: string;
  companyName: string;
  companyDomain: string;
  roleTitle: string;
  normalizedRoleTitle: string;
  groupSenderDomain: string;
  groupSubjectKey: string;
  status: Application["status"];
  firstSeenAt: string;
  lastActivityAt: string;
  notes: string;
}

export interface ApplicationEventDto {
  id: string;
  applicationId: string;
  eventType: string;
  eventAt: string;
  emailMessageId: string | null;
  detailsJson: string;
}

export interface EmailMessageDto {
  id: string;
  gmailMessageId: string;
  threadId: string;
  direction: "inbound" | "outbound";
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  sentAt: string | null;
  receivedAt: string | null;
  parsedCompanyDomain: string;
  parsedRole: string;
  classification: string;
  groupSenderDomain: string;
  groupSubjectKey: string;
  aiConfidence: number;
}

export interface FollowupTaskDto {
  id: string;
  applicationId: string;
  dueAt: string;
  reason: string;
  state: "open" | "done" | "snoozed";
}

export interface ApplicationDetail extends ApplicationSummary {
  events: ApplicationEventDto[];
  emails: EmailMessageDto[];
  followups: FollowupTaskDto[];
}

export interface DashboardSummary {
  totalApplications: number;
  statusCounts: Record<Application["status"], number>;
  followupsDue: number;
  recentApplications: ApplicationSummary[];
}

export interface DuplicateCheckResponse {
  exists: boolean;
  key: string;
  matchedApplication: ApplicationSummary | null;
}

export interface CompanyOverviewPosition {
  id: string;
  roleTitle: string;
  normalizedRoleTitle: string;
  groupSenderDomain: string;
  groupSubjectKey: string;
  status: Application["status"];
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

export interface CompanyOverview {
  companyName: string;
  companyDomain: string;
  totalApplications: number;
  activeApplications: number;
  closedApplications: number;
  followupsOpen: number;
  firstSeenAt: string;
  lastActivityAt: string;
  statusCounts: Record<Application["status"], number>;
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

interface CompanyWebProfile {
  websiteUrl: string | null;
  careersUrl: string | null;
  sourceDomain: string;
  pageTitle: string | null;
  pageDescription: string | null;
}

interface CompanyWebProfileCacheItem {
  expiresAt: number;
  value: CompanyWebProfile;
}

const COMPANY_PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const COMPANY_PROFILE_CACHE = new Map<string, CompanyWebProfileCacheItem>();
const COMPANY_FETCH_TIMEOUT_MS = 3500;
const CAREERS_PATHS = [
  "/careers",
  "/jobs",
  "/careers/jobs",
  "/join-us",
  "/work-with-us",
  "/about/careers",
];
const DOMAIN_PREFIXES_TO_STRIP = new Set([
  "careers",
  "jobs",
  "apply",
  "recruiting",
  "talent",
  "mail",
  "email",
  "notifications",
  "noreply",
]);
const ATS_SUFFIXES = [
  "comeet-notifications.com",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "icims.com",
  "smartrecruiters.com",
  "jobvite.com",
];
const SECOND_LEVEL_TLDS = new Set(["co", "com", "org", "net", "gov", "ac"]);

const normalizeDomainForLookup = (domain: string): string =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\.+|\.+$/g, "");

const isUnsafeHost = (host: string): boolean => {
  const lower = host.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".lan")
  ) {
    return true;
  }

  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((part) => Number(part));
    if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
      return true;
    }

    const [a, b] = octets;
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    ) {
      return true;
    }

    return false;
  }

  return !/^[a-z0-9.-]+$/.test(lower) || !lower.includes(".");
};

const toLikelyRootDomain = (domain: string): string => {
  const parts = normalizeDomainForLookup(domain).split(".").filter(Boolean);
  if (parts.length <= 2) {
    return parts.join(".");
  }

  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (last.length === 2 && SECOND_LEVEL_TLDS.has(secondLast) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
};

const inferWebsiteDomain = (companyDomain: string): string => {
  const normalized = normalizeDomainForLookup(companyDomain);
  if (!normalized) {
    return "";
  }

  const comeetMatch = normalized.match(/^([a-z0-9.-]+)\.comeet-notifications\.com$/i);
  if (comeetMatch?.[1]) {
    const candidate = normalizeDomainForLookup(comeetMatch[1]);
    if (candidate.includes(".")) {
      return candidate;
    }
  }

  for (const suffix of ATS_SUFFIXES) {
    if (!normalized.endsWith(suffix)) {
      continue;
    }
    return toLikelyRootDomain(normalized);
  }

  const segments = normalized.split(".");
  if (segments.length > 2 && DOMAIN_PREFIXES_TO_STRIP.has(segments[0])) {
    return segments.slice(1).join(".");
  }

  return normalized;
};

const parseHtmlMetadata = (html: string): { title: string | null; description: string | null } => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descriptionMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );

  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || null;
  const description = descriptionMatch?.[1]?.replace(/\s+/g, " ").trim() || null;
  return {
    title: title?.slice(0, 180) ?? null,
    description: description?.slice(0, 260) ?? null,
  };
};

const fetchHtml = async (url: string): Promise<{ ok: boolean; html: string; finalUrl: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMPANY_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "cv-manager-company-insights/1.0",
      },
    });
    if (!response.ok) {
      return { ok: false, html: "", finalUrl: response.url || url };
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      return { ok: false, html: "", finalUrl: response.url || url };
    }
    const html = (await response.text()).slice(0, 200_000);
    return { ok: true, html, finalUrl: response.url || url };
  } catch {
    return { ok: false, html: "", finalUrl: url };
  } finally {
    clearTimeout(timeout);
  }
};

const resolveCompanyWebProfile = async (companyDomain: string): Promise<CompanyWebProfile> => {
  const domain = inferWebsiteDomain(companyDomain);
  if (!domain || isUnsafeHost(domain)) {
    return {
      websiteUrl: null,
      careersUrl: null,
      sourceDomain: companyDomain,
      pageTitle: null,
      pageDescription: null,
    };
  }

  const cacheKey = domain;
  const now = Date.now();
  const cached = COMPANY_PROFILE_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const websiteCandidates = [`https://${domain}`, `https://www.${domain}`];
  let websiteUrl: string | null = null;
  let pageTitle: string | null = null;
  let pageDescription: string | null = null;

  for (const candidate of websiteCandidates) {
    const fetched = await fetchHtml(candidate);
    if (!fetched.ok) {
      continue;
    }

    const metadata = parseHtmlMetadata(fetched.html);
    websiteUrl = fetched.finalUrl || candidate;
    pageTitle = metadata.title;
    pageDescription = metadata.description;
    break;
  }

  let careersUrl: string | null = null;
  if (websiteUrl) {
    const origin = new URL(websiteUrl).origin;
    for (const path of CAREERS_PATHS) {
      const candidate = `${origin}${path}`;
      const fetched = await fetchHtml(candidate);
      if (!fetched.ok) {
        continue;
      }
      const lower = fetched.html.toLowerCase();
      if (
        lower.includes("job") ||
        lower.includes("career") ||
        lower.includes("open positions") ||
        lower.includes("join our team")
      ) {
        careersUrl = fetched.finalUrl || candidate;
        break;
      }
    }
  }

  const value: CompanyWebProfile = {
    websiteUrl,
    careersUrl,
    sourceDomain: domain,
    pageTitle,
    pageDescription,
  };
  COMPANY_PROFILE_CACHE.set(cacheKey, {
    value,
    expiresAt: now + COMPANY_PROFILE_CACHE_TTL_MS,
  });
  return value;
};

const roundPct = (value: number): number => Math.round(value * 100) / 100;

const mapSummary = (application: Application): ApplicationSummary => ({
  id: application.id,
  companyName: application.companyName,
  companyDomain: application.companyDomain,
  roleTitle: application.roleTitle,
  normalizedRoleTitle: application.normalizedRoleTitle,
  groupSenderDomain: application.groupSenderDomain,
  groupSubjectKey: application.groupSubjectKey,
  status: application.status,
  firstSeenAt: application.firstSeenAt.toISOString(),
  lastActivityAt: application.lastActivityAt.toISOString(),
  notes: application.notes,
});

export interface ListApplicationsFilters {
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
}

export const listApplications = async (filters: ListApplicationsFilters): Promise<ApplicationSummary[]> => {
  const where: Prisma.ApplicationWhereInput = {};

  if (filters.status) {
    where.status = filters.status as Application["status"];
  }

  if (!filters.status && filters.statusGroup === "active") {
    where.status = {
      in: ["submitted", "received", "interview", "assessment"],
    };
  }

  if (!filters.status && filters.statusGroup === "closed") {
    where.status = {
      in: ["offer", "rejected", "withdrawn"],
    };
  }

  if (filters.company) {
    where.OR = [
      {
        companyName: {
          contains: filters.company,
        },
      },
      {
        companyDomain: {
          contains: filters.company.toLowerCase(),
        },
      },
    ];
  }

  if (filters.domain) {
    where.companyDomain = {
      contains: filters.domain.toLowerCase(),
    };
  }

  if (filters.role) {
    where.roleTitle = {
      contains: filters.role,
    };
  }

  if (filters.dateFrom || filters.dateTo) {
    where.lastActivityAt = {};
    if (filters.dateFrom) {
      where.lastActivityAt.gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      const upperBound = new Date(filters.dateTo);
      upperBound.setHours(23, 59, 59, 999);
      where.lastActivityAt.lte = upperBound;
    }
  }

  if (filters.hideUnknownRole) {
    where.normalizedRoleTitle = {
      not: "unknown-role",
    };
  }

  if (filters.hasNotes) {
    where.notes = {
      not: "",
    };
  }

  if (filters.manualOnly) {
    where.manualStatusLocked = true;
  }

  const applications = await prisma.application.findMany({
    where,
    orderBy: { lastActivityAt: "desc" },
  });

  return applications.map(mapSummary);
};

export const getApplicationDetail = async (id: string): Promise<ApplicationDetail | null> => {
  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      events: {
        orderBy: { eventAt: "desc" },
      },
      emails: {
        orderBy: { createdAt: "desc" },
      },
      followups: {
        orderBy: { dueAt: "asc" },
      },
    },
  });

  if (!application) {
    return null;
  }

  return {
    ...mapSummary(application),
    events: application.events.map((event) => ({
      id: event.id,
      applicationId: event.applicationId,
      eventType: event.eventType,
      eventAt: event.eventAt.toISOString(),
      emailMessageId: event.emailMessageId,
      detailsJson: event.detailsJson,
    })),
    emails: application.emails.map((email) => ({
      id: email.id,
      gmailMessageId: email.gmailMessageId,
      threadId: email.threadId,
      direction: email.direction,
      fromEmail: email.fromEmail,
      toEmail: email.toEmail,
      subject: email.subject,
      bodyText: email.bodyText,
      bodyHtml: email.bodyHtml,
      sentAt: email.sentAt?.toISOString() ?? null,
      receivedAt: email.receivedAt?.toISOString() ?? null,
      parsedCompanyDomain: email.parsedCompanyDomain,
      parsedRole: email.parsedRole,
      classification: email.classification,
      groupSenderDomain: email.groupSenderDomain,
      groupSubjectKey: email.groupSubjectKey,
      aiConfidence: email.aiConfidence,
    })),
    followups: application.followups.map((task) => ({
      id: task.id,
      applicationId: task.applicationId,
      dueAt: task.dueAt.toISOString(),
      reason: task.reason,
      state: task.state,
    })),
  };
};

export interface PatchApplicationInput {
  companyName?: string;
  companyDomain?: string;
  roleTitle?: string;
  status?: Application["status"];
  notes?: string;
  manualStatusLocked?: boolean;
}

export const patchApplication = async (
  id: string,
  payload: PatchApplicationInput,
): Promise<ApplicationSummary | null> => {
  const current = await prisma.application.findUnique({ where: { id } });
  if (!current) {
    return null;
  }

  const roleTitle = payload.roleTitle ?? current.roleTitle;

  const updated = await prisma.application.update({
    where: { id },
    data: {
      companyName: payload.companyName,
      companyDomain: payload.companyDomain?.toLowerCase(),
      roleTitle,
      normalizedRoleTitle: normalizeRole(roleTitle),
      status: payload.status,
      notes: payload.notes,
      manualStatusLocked: payload.manualStatusLocked,
      lastActivityAt: new Date(),
    },
  });

  await prisma.applicationEvent.create({
    data: {
      applicationId: id,
      eventType: "manual_update",
      eventAt: new Date(),
      detailsJson: JSON.stringify(payload),
    },
  });

  return mapSummary(updated);
};

export const getDashboardSummary = async (): Promise<DashboardSummary> => {
  const [totalApplications, grouped, followupsDue, recent] = await Promise.all([
    prisma.application.count(),
    prisma.application.groupBy({
      by: ["status"],
      _count: {
        status: true,
      },
    }),
    prisma.followupTask.count({
      where: {
        state: "open",
        dueAt: {
          lte: new Date(),
        },
      },
    }),
    prisma.application.findMany({
      orderBy: { lastActivityAt: "desc" },
      take: 8,
    }),
  ]);

  const base: DashboardSummary["statusCounts"] = {
    submitted: 0,
    received: 0,
    rejected: 0,
    interview: 0,
    assessment: 0,
    offer: 0,
    withdrawn: 0,
  };

  for (const row of grouped) {
    base[row.status] = row._count.status;
  }

  return {
    totalApplications,
    statusCounts: base,
    followupsDue,
    recentApplications: recent.map(mapSummary),
  };
};

export const checkDuplicate = async (
  companyDomain: string,
  roleTitle: string,
): Promise<DuplicateCheckResponse> => {
  const normalizedDomain = companyDomain.trim().toLowerCase();
  const normalizedRole = normalizeRole(roleTitle);
  const key = buildDuplicateKey(normalizedDomain, normalizedRole);

  const matched = await prisma.application.findFirst({
    where: {
      companyDomain: normalizedDomain,
      normalizedRoleTitle: normalizedRole,
    },
  });

  return {
    exists: Boolean(matched),
    key,
    matchedApplication: matched ? mapSummary(matched) : null,
  };
};

export const getCompanyOverview = async (companyDomain: string): Promise<CompanyOverview | null> => {
  const normalizedDomain = companyDomain.trim().toLowerCase();
  if (!normalizedDomain) {
    return null;
  }

  const applications = await prisma.application.findMany({
    where: {
      companyDomain: normalizedDomain,
    },
    orderBy: [{ lastActivityAt: "desc" }, { firstSeenAt: "asc" }],
    include: {
      events: {
        orderBy: { eventAt: "desc" },
        take: 1,
      },
      followups: {
        where: { state: "open" },
        orderBy: { dueAt: "asc" },
        take: 1,
      },
      emails: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          subject: true,
          receivedAt: true,
          classification: true,
        },
      },
    },
  });

  if (applications.length === 0) {
    return null;
  }

  const [followupsOpen, emails, profile] = await Promise.all([
    prisma.followupTask.count({
      where: {
        state: "open",
        application: {
          companyDomain: normalizedDomain,
        },
      },
    }),
    prisma.emailMessage.findMany({
      where: {
        application: {
          companyDomain: normalizedDomain,
        },
      },
      select: {
        direction: true,
        fromEmail: true,
        receivedAt: true,
        sentAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    resolveCompanyWebProfile(normalizedDomain),
  ]);

  const statusCounts: CompanyOverview["statusCounts"] = {
    submitted: 0,
    received: 0,
    rejected: 0,
    interview: 0,
    assessment: 0,
    offer: 0,
    withdrawn: 0,
  };

  for (const application of applications) {
    statusCounts[application.status] += 1;
  }

  const activeApplications =
    statusCounts.submitted + statusCounts.received + statusCounts.interview + statusCounts.assessment;
  const closedApplications = statusCounts.offer + statusCounts.rejected + statusCounts.withdrawn;
  const uniqueRoles = new Set(
    applications
      .map((application) => application.normalizedRoleTitle)
      .filter((normalizedRoleTitle) => normalizedRoleTitle !== "unknown-role"),
  ).size;
  const responseRate =
    applications.length === 0 ? 0 : roundPct((activeApplications + closedApplications) / applications.length * 100);
  const decisionRate = applications.length === 0 ? 0 : roundPct(closedApplications / applications.length * 100);

  const inboundEmails = emails.filter((email) => email.direction === "inbound");
  const lastIncomingEmailAt = inboundEmails.reduce<Date | null>((latest, current) => {
    const candidate = current.receivedAt ?? current.sentAt ?? null;
    if (!candidate) {
      return latest;
    }
    if (!latest || candidate > latest) {
      return candidate;
    }
    return latest;
  }, null);

  const senderDomainCounts = new Map<string, number>();
  for (const email of inboundEmails) {
    const domain = extractDomainFromEmail(email.fromEmail);
    if (!domain) {
      continue;
    }
    senderDomainCounts.set(domain, (senderDomainCounts.get(domain) ?? 0) + 1);
  }
  const topSenderDomains = Array.from(senderDomainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain]) => domain);

  const companyName = applications[0].companyName;
  const firstSeenAt = applications.reduce(
    (earliest, current) => (current.firstSeenAt < earliest ? current.firstSeenAt : earliest),
    applications[0].firstSeenAt,
  );
  const lastActivityAt = applications.reduce(
    (latest, current) => (current.lastActivityAt > latest ? current.lastActivityAt : latest),
    applications[0].lastActivityAt,
  );

  return {
    companyName,
    companyDomain: normalizedDomain,
    totalApplications: applications.length,
    activeApplications,
    closedApplications,
    followupsOpen,
    firstSeenAt: firstSeenAt.toISOString(),
    lastActivityAt: lastActivityAt.toISOString(),
    statusCounts,
    profile,
    insights: {
      emailsTracked: emails.length,
      inboundEmails: inboundEmails.length,
      uniqueRoles,
      responseRate,
      decisionRate,
      topSenderDomains,
      lastIncomingEmailAt: lastIncomingEmailAt?.toISOString() ?? null,
    },
    positions: applications.map((application) => ({
      id: application.id,
      roleTitle: application.roleTitle,
      normalizedRoleTitle: application.normalizedRoleTitle,
      groupSenderDomain: application.groupSenderDomain,
      groupSubjectKey: application.groupSubjectKey,
      status: application.status,
      firstSeenAt: application.firstSeenAt.toISOString(),
      lastActivityAt: application.lastActivityAt.toISOString(),
      notes: application.notes,
      manualStatusLocked: application.manualStatusLocked,
      latestEvent: application.events[0]
        ? {
            eventType: application.events[0].eventType,
            eventAt: application.events[0].eventAt.toISOString(),
          }
        : null,
      nextFollowupAt: application.followups[0]?.dueAt.toISOString() ?? null,
      latestEmail: application.emails[0]
        ? {
            subject: application.emails[0].subject,
            receivedAt: application.emails[0].receivedAt?.toISOString() ?? null,
            classification: application.emails[0].classification,
          }
        : null,
    })),
  };
};

export const createOrUpdateApplicationFromEmail = async (payload: {
  companyDomain: string;
  roleTitle: string;
  groupSenderDomain: string;
  groupSubjectKey: string;
  sourceEmailMessageId: string;
  status: Application["status"];
  eventType: string;
  eventDetails: Record<string, unknown>;
  companyName: string;
  eventAt: Date;
}): Promise<Application> => {
  const normalizedRoleTitle = normalizeRole(payload.roleTitle);
  const companyDomain = payload.companyDomain.toLowerCase();
  const groupSenderDomain = payload.groupSenderDomain.toLowerCase();
  const groupSubjectKey = payload.groupSubjectKey.toLowerCase();

  const existing = await prisma.application.findUnique({
    where: {
      groupSenderDomain_groupSubjectKey: {
        groupSenderDomain,
        groupSubjectKey,
      },
    },
  });

  const next = existing
    ? await prisma.application.update({
        where: { id: existing.id },
        data: {
          roleTitle:
            payload.roleTitle !== "unknown-role" ? payload.roleTitle : existing.roleTitle,
          companyName:
            payload.companyName !== "Unknown Company" ? payload.companyName : existing.companyName,
          companyDomain: companyDomain || existing.companyDomain,
          normalizedRoleTitle:
            payload.roleTitle !== "unknown-role"
              ? normalizedRoleTitle
              : existing.normalizedRoleTitle,
          status: existing.manualStatusLocked ? existing.status : payload.status,
          sourceEmailMessageId: existing.sourceEmailMessageId ?? payload.sourceEmailMessageId,
          lastActivityAt: payload.eventAt,
        },
      })
    : await prisma.application.create({
        data: {
          companyName: payload.companyName,
          companyDomain,
          roleTitle: payload.roleTitle,
          normalizedRoleTitle,
          groupSenderDomain,
          groupSubjectKey,
          status: payload.status,
          sourceEmailMessageId: payload.sourceEmailMessageId,
          firstSeenAt: payload.eventAt,
          lastActivityAt: payload.eventAt,
        },
      });

  await prisma.applicationEvent.create({
    data: {
      applicationId: next.id,
      eventType: payload.eventType,
      eventAt: payload.eventAt,
      emailMessageId: payload.sourceEmailMessageId,
      detailsJson: JSON.stringify(payload.eventDetails),
    },
  });

  return next;
};
