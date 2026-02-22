import type { ApplicationStatus, GmailAccount } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import {
  fetchInboxMessageIdsByQuery,
  fetchMessagesByIds,
  getConnectedAccount,
  updateAccountCheckpoint,
} from "./gmailService.js";
import { parseGmailMessagePayload } from "./emailParser.js";
import { classifyEmailContent } from "./classifier.js";
import { createOrUpdateApplicationFromEmail } from "./applicationService.js";
import { refreshFollowupForApplication } from "./followupService.js";
import { getSettings } from "./settingsService.js";
import { extractWithOllama, normalizeSubjectForGroup } from "./ollamaService.js";
import { extractDomainFromEmail, inferCompanyNameFromDomain, normalizeRole } from "../utils/normalize.js";

export interface SyncStats {
  scanned: number;
  importedEmails: number;
  applicationsCreatedOrUpdated: number;
  statusesUpdated: number;
  needsReview: number;
  aiProcessed: number;
  aiFallbackUsed: number;
  aiSkipped: number;
}

export interface SyncResult {
  ok: boolean;
  reason?: string;
  stats: SyncStats;
}

const createBaseStats = (): SyncStats => ({
  scanned: 0,
  importedEmails: 0,
  applicationsCreatedOrUpdated: 0,
  statusesUpdated: 0,
  needsReview: 0,
  aiProcessed: 0,
  aiFallbackUsed: 0,
  aiSkipped: 0,
});

const FOCUS_FALLBACK = "thanks for applying";
const FOCUS_ALTERNATE = "thank you for applying";
const FOCUS_INTEREST = "thank you for your interest";
const FOCUS_GENERIC = "thank you for";
// Well-known Applicant Tracking System (ATS) sender domains.
// When the sender domain is an ATS, the email "From" display name
// (e.g. "CyberArk") is the actual employer and must be trusted as the
// company name even if it contains no typical company-name hint words.
const ATS_DOMAINS = new Set([
  "smartrecruiters.com",
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "icims.com",
  "taleo.net",
  "jobvite.com",
  "successfactors.com",
  "bamboohr.com",
  "recruitee.com",
  "workable.com",
  "applytojob.com",
  "myworkday.com",
  "ultipro.com",
  "paylocity.com",
  "silkroad.com",
  "cornerstone.com",
  "kenexa.com",
  "brassring.com",
]);
const MAX_BODY_FOR_FALLBACK = 5000;
const GENERIC_DISPLAY_NAMES = new Set([
  "noreply",
  "no reply",
  "no-reply",
  "notifications",
  "notification",
  "jobs",
  "recruiting",
  "careers",
  "support",
  "hr",
  "talent acquisition",
  "talent",
  "hiring team",
  "do not reply",
  "donotreply",
]);
// Sender domains that are NEVER job-application emails.
// These produce false positives when focus terms appear in their content
// (e.g. Microsoft auth codes, Airbnb T&C, newsletter platforms, etc.).
const NOISE_DOMAINS = new Set([
  // Microsoft
  "accountprotection.microsoft.com",
  "microsoft.com",
  "account.microsoft.com",
  "live.com",
  "hotmail.com",
  "outlook.com",
  // Google / Gmail
  "gmail.com",
  "accounts.google.com",
  "google.com",
  // Travel / Consumer
  "airbnb.com",
  "booking.com",
  "expedia.com",
  "uber.com",
  // Event / Newsletter platforms
  "email.meetup.com",
  "meetup.com",
  "eventbrite.com",
  "mailchimp.com",
  "constantcontact.com",
  "sendgrid.net",
  "klaviyo.com",
  // Social
  "facebookmail.com",
  "twitter.com",
  "instagram.com",
  "tiktok.com",
  // E-commerce
  "amazon.com",
  "ebay.com",
  "etsy.com",
  "aliexpress.com",
  // Payment
  "paypal.com",
  "stripe.com",
]);
const ROLE_HINTS = [
  "engineer",
  "developer",
  "manager",
  "director",
  "architect",
  "analyst",
  "scientist",
  "specialist",
  "intern",
  "lead",
  "head",
  "principal",
  "consultant",
  "designer",
  "administrator",
  "qa",
  "quality assurance",
  "sre",
  "devops",
  "product",
  "data",
  "research",
  "position",
  "role",
];
const COMPANY_HINTS = [
  "inc",
  "corp",
  "llc",
  "ltd",
  "group",
  "labs",
  "lab",
  "tech",
  "technologies",
  "systems",
  "solutions",
  "analytics",
  "software",
  "ai",
  "security",
  "media",
  "health",
];
const INVALID_TEXT_FRAGMENTS = [
  "has been received",
  "we will review",
  "if we see a match",
  "thank you for applying",
  "thanks for applying",
  "application received",
  "received your application",
  "keep you updated",
];

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

const cleanValue = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .replace(/^[\s"'`.,:;|()[\]{}<>-]+|[\s"'`.,:;|()[\]{}<>-]+$/g, "")
    .trim();

const normalizeDomain = (domain: string): string =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9.:-]+$/g, "");

const sanitizeCompanyName = (value: string): string => {
  const cleaned = cleanValue(value)
    .replace(/\s+(?:careers?|jobs?|hiring|recruiting|team)$/i, "")
    .replace(/\s+(?:inc|corp|llc|ltd|co)\.?$/i, (match) => match.trim());

  return cleaned || "";
};

const sanitizeRoleTitle = (value: string): string => cleanValue(value);

// Returns true when the sender domain belongs to a known ATS (Applicant
// Tracking System). In those cases the email display name is the real company.
const isAtsDomain = (domain: string): boolean => ATS_DOMAINS.has(domain.toLowerCase().trim());

const hasInvalidFragment = (value: string): boolean => {
  const lowered = value.toLowerCase();
  return INVALID_TEXT_FRAGMENTS.some((fragment) => lowered.includes(fragment));
};

const looksLikeRoleTitle = (value: string): boolean => {
  const candidate = sanitizeRoleTitle(value).toLowerCase();
  if (!candidate || candidate === "unknown-role") {
    return false;
  }
  if (candidate.length > 90 || candidate.split(" ").length > 12) {
    return false;
  }
  if (/^at\s+/.test(candidate) || /[.!?]/.test(candidate) || hasInvalidFragment(candidate)) {
    return false;
  }

  return ROLE_HINTS.some((hint) => candidate.includes(hint));
};

const looksLikeCompanyName = (value: string): boolean => {
  const candidate = sanitizeCompanyName(value);
  const lowered = candidate.toLowerCase();

  if (!candidate) {
    return false;
  }
  if (candidate.length > 90 || candidate.split(" ").length > 10) {
    return false;
  }
  if (/^at\s+/.test(lowered) || hasInvalidFragment(lowered)) {
    return false;
  }
  if (candidate.includes("@")) {
    return false;
  }
  if (candidate.includes(".")) {
    return true;
  }

  const hasRoleHint = ROLE_HINTS.some((hint) => lowered.includes(hint));
  const hasCompanyHint = COMPANY_HINTS.some((hint) => lowered.includes(hint));
  if (hasRoleHint && !hasCompanyHint) {
    return false;
  }

  return true;
};

const stripHtml = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

const subjectContainsFocus = (subject: string, focusTerms: string[]): boolean => {
  const normalized = cleanValue(subject).toLowerCase();
  return focusTerms.some((focus) => normalized.includes(cleanValue(focus).toLowerCase()));
};

// Full-text match: checks subject first, then falls back to body.
// This lets emails whose subject doesn't contain focus keywords but
// whose body does (e.g. SmartRecruiters/CyberArk acknowledgments) pass through.
const containsFocus = (subject: string, body: string, focusTerms: string[]): boolean => {
  if (subjectContainsFocus(subject, focusTerms)) {
    return true;
  }
  const normalizedBody = cleanValue(body).toLowerCase();
  return focusTerms.some((focus) => normalizedBody.includes(cleanValue(focus).toLowerCase()));
};

const parseFocusedSubjectCandidates = (
  subject: string,
): { roleCandidate: string; companyCandidate: string } => {
  let normalized = cleanValue(subject)
    .replace(/^re:\s*/i, "")
    .replace(/^fw:\s*/i, "")
    .replace(/^fwd:\s*/i, "")
    .trim();

  normalized = normalized
    .replace(/^thank(?:s| you) for applying/i, "")
    .replace(/^thank(?:s| you) for your interest(?:\s+in)?/i, "")
    .trim();
  normalized = normalized.replace(/^(?:to|for)\s+/i, "").trim();
  normalized = normalized.replace(/^the\s+/i, "").trim();
  normalized = normalized.replace(/[|,]\s*thank.*$/i, "").trim();

  const withAt = normalized.match(/^(.*)\s+at\s+([A-Za-z0-9&.,'()\- ]{2,80})$/i);
  if (withAt?.[1] && withAt[2]) {
    const roleCandidate = sanitizeRoleTitle(
      withAt[1].replace(/\b(?:position|role|job)\b$/i, "").trim(),
    );
    const companyCandidate = sanitizeCompanyName(withAt[2]);
    return { roleCandidate, companyCandidate };
  }

  const roleCandidate = sanitizeRoleTitle(normalized.replace(/\b(?:position|role|job)\b$/i, "").trim());
  if (looksLikeRoleTitle(roleCandidate)) {
    return {
      roleCandidate,
      companyCandidate: "",
    };
  }

  const companyCandidate = sanitizeCompanyName(normalized);
  return {
    roleCandidate: "",
    companyCandidate: looksLikeCompanyName(companyCandidate) ? companyCandidate : "",
  };
};

const extractCompanyFromSubject = (subject: string): string => {
  const focused = parseFocusedSubjectCandidates(subject);
  if (focused.companyCandidate && looksLikeCompanyName(focused.companyCandidate)) {
    return focused.companyCandidate;
  }

  const patterns = [
    /thank(?:s| you) for applying(?:\s+(?:to|for))\s+([A-Za-z0-9&.,'()\- ]{2,90})/i,
    /thank(?:s| you) for your interest(?:\s+in)?\s+([A-Za-z0-9&.,'()\- ]{2,90})/i,
    /your application(?:\s+(?:to|for))\s+([A-Za-z0-9&.,'()\- ]{2,90})/i,
    /application received(?:\s+(?:by|from))\s+([A-Za-z0-9&.,'()\- ]{2,90})/i,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const candidate = sanitizeCompanyName(
      match[1]
        .replace(/\s+for\s+the\s+position.*$/i, "")
        .replace(/\s+\|\s+.*$/, "")
        .replace(/\s+-\s+.*$/, "")
        .trim(),
    );
    if (candidate.length >= 2 && looksLikeCompanyName(candidate)) {
      return candidate;
    }
  }

  return "";
};

const normalizeCompare = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();

const isCompanyMentionedInSubject = (subject: string, companyName: string): boolean => {
  const subjectComparable = normalizeCompare(subject);
  const companyComparable = normalizeCompare(companyName);
  return companyComparable.length >= 3 && subjectComparable.includes(companyComparable);
};

const extractSenderCompany = (displayName: string, senderDomain?: string): string => {
  const normalized = sanitizeCompanyName(displayName);
  if (!normalized) {
    return "";
  }

  if (GENERIC_DISPLAY_NAMES.has(normalized.toLowerCase())) {
    return "";
  }

  // When the email comes from a known ATS (e.g. smartrecruiters.com, greenhouse.io)
  // the display name IS the actual employer — trust it unconditionally as long as
  // it's not a generic word and doesn't look like a role title.
  if (senderDomain && isAtsDomain(senderDomain)) {
    if (!GENERIC_DISPLAY_NAMES.has(normalized.toLowerCase()) && !looksLikeRoleTitle(normalized)) {
      return normalized;
    }
    return "";
  }

  if (!looksLikeCompanyName(normalized)) {
    return "";
  }

  return normalized;
};

const extractCompanyFromBody = (text: string): string => {
  if (!text) {
    return "";
  }

  const source = text.slice(0, MAX_BODY_FOR_FALLBACK);
  const patterns = [
    /thank(?:s| you)\s+for\s+applying(?:\s+to|\s+for)?\s+([A-Za-z0-9&.,'()\- ]{2,90})/i,
    /received\s+your\s+application(?:\s+for|\s+to)?\s+([A-Za-z0-9&.,'()\- ]{2,90})/i,
    /at\s+([A-Za-z0-9&.,'()\- ]{2,90})\s+(?:we|our team)/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const candidate = sanitizeCompanyName(match[1]);
    if (candidate.length >= 2 && looksLikeCompanyName(candidate)) {
      return candidate;
    }
  }

  return "";
};

const normalizeGroupSubjectKey = (value: string): string => {
  const normalized = cleanValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "thanks-for-applying";
};

const toApplicationStatus = (
  candidate: string | null | undefined,
  fallback: ApplicationStatus,
): ApplicationStatus => {
  const normalized = cleanValue(candidate ?? "").toLowerCase();
  if (
    normalized === "submitted" ||
    normalized === "received" ||
    normalized === "rejected" ||
    normalized === "interview" ||
    normalized === "assessment" ||
    normalized === "offer" ||
    normalized === "withdrawn"
  ) {
    return normalized;
  }

  return fallback;
};

const chunk = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const filterExistingMessageIds = async (messageIds: string[]): Promise<string[]> => {
  if (messageIds.length === 0) {
    return [];
  }

  const existing = new Set<string>();
  for (const batch of chunk(messageIds, 500)) {
    const rows = await prisma.emailMessage.findMany({
      where: {
        gmailMessageId: {
          in: batch,
        },
      },
      select: {
        gmailMessageId: true,
      },
    });
    for (const row of rows) {
      existing.add(row.gmailMessageId);
    }
  }

  return messageIds.filter((id) => !existing.has(id));
};

const clampLookbackDays = (days: number): number => {
  if (!Number.isFinite(days)) {
    return 120;
  }
  return Math.min(3650, Math.max(1, Math.floor(days)));
};

const buildFocusedQuery = (focusTerms: string[], lookbackDays: number): string => {
  // Use full-text search (no `subject:` prefix) so that emails whose focus
  // keywords appear in the body — not just the subject — are also fetched.
  // Example: SmartRecruiters/CyberArk sends "Thank you for considering" in
  // the body while using a subject like "Your application at CyberArk".
  const escapedTerms = focusTerms
    .map((focus) => cleanValue(focus))
    .filter(Boolean)
    .map((focus) => `"${focus.replace(/"/g, '\\"')}"`);

  const lookup = escapedTerms.length > 1 ? `(${escapedTerms.join(" OR ")})` : escapedTerms[0];
  return `${lookup} newer_than:${clampLookbackDays(lookbackDays)}d`;
};

const createCutoffDate = (lookbackDays: number): Date => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - clampLookbackDays(lookbackDays));
  return cutoff;
};

const pruneOldTrackedData = async (
  lookbackDays: number,
): Promise<{ emailsDeleted: number; applicationsDeleted: number }> => {
  const cutoff = createCutoffDate(lookbackDays);

  const [emailsResult, applicationsResult] = await prisma.$transaction([
    prisma.emailMessage.deleteMany({
      where: {
        OR: [
          { receivedAt: { lt: cutoff } },
          { sentAt: { lt: cutoff } },
          {
            AND: [{ receivedAt: null }, { sentAt: null }, { createdAt: { lt: cutoff } }],
          },
        ],
      },
    }),
    prisma.application.deleteMany({
      where: {
        lastActivityAt: {
          lt: cutoff,
        },
      },
    }),
  ]);

  return {
    emailsDeleted: emailsResult.count,
    applicationsDeleted: applicationsResult.count,
  };
};

const resolveCompanyIdentity = (input: {
  subject: string;
  subjectCompanyCandidate: string;
  body: string;
  senderDomain: string;
  fromDisplayName: string;
  aiCompanyName: string;
  aiCompanyDomain: string;
}): { companyName: string; companyDomain: string; source: "subject" | "sender" | "content" | "domain" } => {
  const normalizedSenderDomain = normalizeDomain(input.senderDomain);
  const normalizedAiCompanyDomain = normalizeDomain(input.aiCompanyDomain);

  const subjectCandidate = sanitizeCompanyName(input.subjectCompanyCandidate);
  if (subjectCandidate && looksLikeCompanyName(subjectCandidate)) {
    return {
      companyName: subjectCandidate,
      companyDomain: normalizedAiCompanyDomain || normalizedSenderDomain,
      source: "subject",
    };
  }

  const subjectDerivedRegex = extractCompanyFromSubject(input.subject);
  if (subjectDerivedRegex) {
    return {
      companyName: subjectDerivedRegex,
      companyDomain: normalizedAiCompanyDomain || normalizedSenderDomain,
      source: "subject",
    };
  }

  const aiCompanyName = sanitizeCompanyName(input.aiCompanyName);
  if (
    aiCompanyName &&
    looksLikeCompanyName(aiCompanyName) &&
    isCompanyMentionedInSubject(input.subject, aiCompanyName)
  ) {
    return {
      companyName: aiCompanyName,
      companyDomain: normalizedAiCompanyDomain || normalizedSenderDomain,
      source: "subject",
    };
  }

  // Pass senderDomain so ATS domains (smartrecruiters.com, greenhouse.io, …)
  // are handled: the display name (e.g. "CyberArk") is used as company name
  // and the domain is resolved from AI or inferred from the display name —
  // NOT from the ATS domain itself.
  const senderDerived = extractSenderCompany(input.fromDisplayName, normalizedSenderDomain);
  if (senderDerived) {
    // For ATS senders the sender domain is the ATS's domain, not the company's.
    // Prefer the AI-extracted domain; fall back to inferring from the company name.
    const resolvedDomain = isAtsDomain(normalizedSenderDomain)
      ? normalizedAiCompanyDomain || normalizeDomain(inferCompanyNameFromDomain(normalizedSenderDomain))
      : normalizedSenderDomain || normalizedAiCompanyDomain;
    return {
      companyName: senderDerived,
      companyDomain: resolvedDomain || normalizedSenderDomain,
      source: "sender",
    };
  }

  const contentDerivedRegex = extractCompanyFromBody(input.body);
  if (contentDerivedRegex) {
    return {
      companyName: contentDerivedRegex,
      companyDomain: normalizedAiCompanyDomain || normalizedSenderDomain,
      source: "content",
    };
  }

  if (aiCompanyName) {
    return {
      companyName: aiCompanyName,
      companyDomain: normalizedAiCompanyDomain || normalizedSenderDomain,
      source: "content",
    };
  }

  if (normalizedSenderDomain) {
    return {
      companyName: inferCompanyNameFromDomain(normalizedSenderDomain),
      companyDomain: normalizedSenderDomain,
      source: "domain",
    };
  }

  return {
    companyName: "Unknown Company",
    companyDomain: "",
    source: "domain",
  };
};

const chooseEventType = (input: {
  hadExisting: boolean;
  existingStatus: ApplicationStatus | null;
  nextStatus: ApplicationStatus;
  manualStatusLocked: boolean;
}): "application_received" | "status_changed" | "email_received" => {
  if (!input.hadExisting) {
    return "application_received";
  }

  if (!input.manualStatusLocked && input.existingStatus && input.existingStatus !== input.nextStatus) {
    return "status_changed";
  }

  return "email_received";
};

const getMessageDate = (internalDate: Date): Date =>
  Number.isNaN(internalDate.getTime()) ? new Date() : internalDate;

const getRoleTitle = (aiRole: string, subjectRole: string, parsedRole: string): string => {
  const aiCandidate = sanitizeRoleTitle(aiRole);
  if (aiCandidate && looksLikeRoleTitle(aiCandidate)) {
    return aiCandidate;
  }

  const subjectCandidate = sanitizeRoleTitle(subjectRole);
  if (subjectCandidate && looksLikeRoleTitle(subjectCandidate)) {
    return subjectCandidate;
  }

  const parsedCandidate = sanitizeRoleTitle(parsedRole);
  if (parsedCandidate && looksLikeRoleTitle(parsedCandidate)) {
    return parsedCandidate;
  }

  return "unknown-role";
};

const getFocusTerms = (): string[] => {
  const configured = cleanValue(config.SYNC_SUBJECT_FOCUS || "")
    .split(/[|,;]+/)
    .map((entry) => cleanValue(entry).toLowerCase())
    .filter(Boolean);

  const terms = configured.length > 0 ? configured : [FOCUS_FALLBACK];
  const uniqueTerms = new Set<string>(terms);
  if (
    uniqueTerms.has(FOCUS_FALLBACK) ||
    uniqueTerms.has(FOCUS_ALTERNATE) ||
    uniqueTerms.has(FOCUS_INTEREST)
  ) {
    uniqueTerms.add(FOCUS_FALLBACK);
    uniqueTerms.add(FOCUS_ALTERNATE);
    uniqueTerms.add(FOCUS_INTEREST);
    uniqueTerms.add(FOCUS_GENERIC);
  }

  return Array.from(uniqueTerms);
};

const shouldUseAi = (confidence: number): boolean => confidence >= config.OLLAMA_MIN_CONFIDENCE;

const getBodyForInference = (bodyText: string, bodyHtml: string): string => {
  const plain = cleanValue(bodyText);
  if (plain) {
    return plain;
  }
  return stripHtml(bodyHtml);
};

const sortByInternalDateAscending = <T extends { internalDate?: string | null }>(messages: T[]): T[] =>
  [...messages].sort((a, b) => {
    const left = Number(a.internalDate ?? 0);
    const right = Number(b.internalDate ?? 0);
    return left - right;
  });

const resolveFocusedMessageIds = async (
  account: GmailAccount,
  lookbackDays: number,
): Promise<{
  messageIds: string[];
  newestHistoryId: string | null;
  source: "history" | "full_scan" | "query";
}> => {
  const focusTerms = getFocusTerms();
  const query = buildFocusedQuery(focusTerms, lookbackDays);
  return fetchInboxMessageIdsByQuery(account, query);
};

export const runSync = async (): Promise<SyncResult> => {
  const stats = createBaseStats();
  const account = await getConnectedAccount();

  if (!account) {
    return {
      ok: false,
      reason: "No connected Gmail account",
      stats,
    };
  }

  const settings = await getSettings();
  const lookbackDays = clampLookbackDays(settings.syncLookbackDays);
  const pruned = await pruneOldTrackedData(lookbackDays);
  if (pruned.applicationsDeleted > 0 || pruned.emailsDeleted > 0) {
    logger.info("Pruned tracked data outside sync lookback window", {
      lookbackDays,
      applicationsDeleted: pruned.applicationsDeleted,
      emailsDeleted: pruned.emailsDeleted,
    });
  }

  const focusTerms = getFocusTerms();
  const focusLabel = focusTerms.join(" | ");
  const focused = await resolveFocusedMessageIds(account, lookbackDays);
  stats.scanned = focused.messageIds.length;

  const unseenMessageIds = await filterExistingMessageIds(focused.messageIds);

  if (unseenMessageIds.length === 0) {
    await updateAccountCheckpoint(account.id, focused.newestHistoryId);
    return {
      ok: true,
      reason:
        `No new focused emails found for subjects "${focusLabel}" in last ${lookbackDays} days` +
        (pruned.applicationsDeleted > 0 || pruned.emailsDeleted > 0
          ? ` | pruned ${pruned.applicationsDeleted} applications and ${pruned.emailsDeleted} emails`
          : ""),
      stats,
    };
  }

  const fetched = await fetchMessagesByIds(account, unseenMessageIds);
  const messages = sortByInternalDateAscending(fetched.messages);
  let skipAiForRun = false;
  let ollamaAbortCount = 0;

  for (const message of messages) {
    const gmailMessageId = asText(message.id);
    if (!gmailMessageId) {
      continue;
    }

    try {
      const parsed = parseGmailMessagePayload(
        {
          headers: message.payload?.headers,
          mimeType: message.payload?.mimeType,
          body: message.payload?.body,
          parts: message.payload?.parts,
        },
        message.internalDate ?? null,
      );

      // Extract body first so it can be used in the focus check.
      // Emails like CyberArk/SmartRecruiters put "thank you for considering"
      // in the body, not the subject — we need to check both.
      const bodyForInference = getBodyForInference(parsed.bodyText, parsed.bodyHtml);

      if (!containsFocus(parsed.subject, bodyForInference, focusTerms)) {
        continue;
      }

      const senderDomain = normalizeDomain(parsed.parsedCompanyDomain || extractDomainFromEmail(parsed.fromEmail));
      if (!senderDomain) {
        logger.warn("Skipping email due to missing sender domain", { gmailMessageId, subject: parsed.subject });
        continue;
      }

      // Reject emails from domains that never send job-application emails:
      // Microsoft auth codes, Airbnb T&C, Meetup events, own digest (gmail.com), etc.
      if (NOISE_DOMAINS.has(senderDomain)) {
        logger.info("Skipping email from noise domain", { gmailMessageId, senderDomain, subject: parsed.subject });
        continue;
      }

      const subjectCandidates = parseFocusedSubjectCandidates(parsed.subject);
      const classifier = classifyEmailContent(parsed.subject, bodyForInference);
      const fallbackStatus =
        classifier.predictedStatus === "unclassified" ? "received" : classifier.predictedStatus;

      let aiLatencyMs = 0;
      const aiResult = skipAiForRun
        ? { ok: false, value: null, error: "Ollama skipped for this sync run after repeated timeouts" }
        : await (async () => {
          const aiStartedAt = Date.now();
          const result = await extractWithOllama({
            subject: parsed.subject,
            body: bodyForInference,
            fromEmail: parsed.fromEmail,
            fromDisplayName: parsed.fromDisplayName,
            senderDomain,
          });
          aiLatencyMs = Date.now() - aiStartedAt;
          return result;
        })();

      const aiValue = aiResult.ok ? aiResult.value : null;
      const aiConfidence = aiValue?.confidence ?? 0;
      const aiConfident = Boolean(aiValue && shouldUseAi(aiConfidence));

      if (aiResult.ok) {
        ollamaAbortCount = 0;
        logger.info("Ollama extraction completed", {
          gmailMessageId,
          latencyMs: aiLatencyMs,
          confidence: aiConfidence,
          model: config.OLLAMA_MODEL,
        });
        if (!aiConfident) {
          logger.warn("Ollama confidence below threshold, using fallback", {
            gmailMessageId,
            confidence: aiConfidence,
            minConfidence: config.OLLAMA_MIN_CONFIDENCE,
          });
        }
      } else {
        if (String(aiResult.error ?? "").toLowerCase().includes("aborted")) {
          ollamaAbortCount += 1;
          if (ollamaAbortCount >= 2) {
            skipAiForRun = true;
            logger.warn("Ollama disabled for remainder of sync run after repeated timeout aborts");
          }
        }
        logger.warn("Ollama extraction failed, using fallback", {
          gmailMessageId,
          latencyMs: aiLatencyMs,
          reason: aiResult.error ?? "unknown",
        });
      }

      if (aiConfident) {
        stats.aiProcessed += 1;
      } else {
        stats.aiFallbackUsed += 1;
      }

      if (aiConfident && aiValue?.include === false) {
        stats.aiSkipped += 1;
        continue;
      }

      const aiCompanyName = aiConfident ? cleanValue(aiValue?.companyName ?? "") : "";
      const aiCompanyDomain = aiConfident ? cleanValue(aiValue?.companyDomain ?? "") : "";
      const company = resolveCompanyIdentity({
        subject: parsed.subject,
        subjectCompanyCandidate: subjectCandidates.companyCandidate,
        body: bodyForInference,
        senderDomain,
        fromDisplayName: parsed.fromDisplayName,
        aiCompanyName,
        aiCompanyDomain,
      });

      const companyDomain = normalizeDomain(company.companyDomain || senderDomain);
      if (!companyDomain) {
        logger.warn("Skipping email because company domain could not be resolved", {
          gmailMessageId,
          subject: parsed.subject,
        });
        continue;
      }

      const groupSenderDomain = senderDomain;
      const groupSubjectKey = normalizeGroupSubjectKey(
        aiConfident && aiValue?.normalizedSubjectKey
          ? aiValue.normalizedSubjectKey
          : normalizeSubjectForGroup(parsed.subject),
      );

      let roleTitle = getRoleTitle(
        aiConfident ? aiValue?.roleTitle ?? "" : "",
        subjectCandidates.roleCandidate,
        parsed.parsedRole,
      );
      let companyName = company.companyName;
      if (looksLikeRoleTitle(companyName) && !looksLikeRoleTitle(roleTitle)) {
        roleTitle = companyName;
        companyName = inferCompanyNameFromDomain(companyDomain);
        logger.warn("Detected swapped role/company fallback; corrected using sender domain", {
          gmailMessageId,
          correctedCompanyName: companyName,
          correctedRoleTitle: roleTitle,
        });
      }
      if (!looksLikeCompanyName(companyName)) {
        companyName = inferCompanyNameFromDomain(companyDomain);
      }
      const status = toApplicationStatus(aiConfident ? aiValue?.status : null, fallbackStatus);
      const classification = aiConfident && aiValue?.status ? aiValue.status : classifier.predictedStatus;
      const eventAt = getMessageDate(parsed.internalDate);

      const existingGroup = await prisma.application.findUnique({
        where: {
          groupSenderDomain_groupSubjectKey: {
            groupSenderDomain,
            groupSubjectKey,
          },
        },
        select: {
          id: true,
          status: true,
          manualStatusLocked: true,
        },
      });

      if (existingGroup) {
        logger.info("Grouped upsert collision resolved", {
          applicationId: existingGroup.id,
          groupSenderDomain,
          groupSubjectKey,
          gmailMessageId,
        });
      }

      const email = await prisma.emailMessage.upsert({
        where: {
          gmailMessageId,
        },
        create: {
          gmailMessageId,
          threadId: asText(message.threadId),
          direction: "inbound",
          fromEmail: parsed.fromEmail,
          toEmail: parsed.toEmail,
          subject: parsed.subject,
          bodyText: parsed.bodyText,
          bodyHtml: parsed.bodyHtml,
          receivedAt: eventAt,
          rawHeadersJson: JSON.stringify(parsed.rawHeaders ?? {}),
          parsedCompanyDomain: senderDomain,
          parsedRole: parsed.parsedRole,
          normalizedRole: normalizeRole(roleTitle),
          classification: cleanValue(classification) || "unclassified",
          groupSenderDomain,
          groupSubjectKey,
          aiExtractionJson: JSON.stringify(aiValue ?? {}),
          aiConfidence,
        },
        update: {
          threadId: asText(message.threadId),
          fromEmail: parsed.fromEmail,
          toEmail: parsed.toEmail,
          subject: parsed.subject,
          bodyText: parsed.bodyText,
          bodyHtml: parsed.bodyHtml,
          receivedAt: eventAt,
          rawHeadersJson: JSON.stringify(parsed.rawHeaders ?? {}),
          parsedCompanyDomain: senderDomain,
          parsedRole: parsed.parsedRole,
          normalizedRole: normalizeRole(roleTitle),
          classification: cleanValue(classification) || "unclassified",
          groupSenderDomain,
          groupSubjectKey,
          aiExtractionJson: JSON.stringify(aiValue ?? {}),
          aiConfidence,
        },
      });

      const eventType = chooseEventType({
        hadExisting: Boolean(existingGroup),
        existingStatus: existingGroup?.status ?? null,
        nextStatus: status,
        manualStatusLocked: existingGroup?.manualStatusLocked ?? false,
      });

      const application = await createOrUpdateApplicationFromEmail({
        companyDomain,
        roleTitle,
        groupSenderDomain,
        groupSubjectKey,
        sourceEmailMessageId: email.id,
        status,
        eventType,
        eventAt,
        companyName,
        eventDetails: {
          focusSubjects: focusTerms,
          lookbackDays,
          source: focused.source,
          companyResolutionSource: company.source,
          classifier,
          ai: {
            enabled: config.OLLAMA_ENABLED,
            confident: aiConfident,
            confidence: aiConfidence,
            error: aiResult.error ?? null,
          },
          grouping: {
            groupSenderDomain,
            groupSubjectKey,
          },
          subjectCandidates,
        },
      });

      await prisma.emailMessage.update({
        where: { id: email.id },
        data: {
          applicationId: application.id,
        },
      });

      await prisma.classificationRuleLog.create({
        data: {
          emailMessageId: email.id,
          matchedRule: aiConfident
            ? `ollama:${cleanValue(aiValue?.status ?? "unclassified") || "unclassified"}`
            : classifier.matchedRule,
          predictedStatus: cleanValue(classification) || "unclassified",
          confidence: aiConfident ? aiConfidence : classifier.confidence,
        },
      });

      await refreshFollowupForApplication(application, settings.followupAfterDays);

      stats.importedEmails += 1;
      stats.applicationsCreatedOrUpdated += 1;
      if (eventType === "status_changed") {
        stats.statusesUpdated += 1;
      }
      if (!aiConfident || classifier.needsReview) {
        stats.needsReview += 1;
      }
    } catch (error) {
      logger.warn("Failed to process Gmail message during sync", {
        gmailMessageId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await updateAccountCheckpoint(account.id, focused.newestHistoryId);

  return {
    ok: true,
    reason: fetched.quotaLimited
      ? "Partial sync: Gmail API quota exceeded during message fetch"
      : `Focused sync completed for subjects "${focusLabel}" in last ${lookbackDays} days`,
    stats,
  };
};
