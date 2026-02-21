import { extractDomainFromEmail, extractEmailAddress, normalizeRole } from "../utils/normalize.js";

interface ParsedHeader {
  name?: string | null;
  value?: string | null;
}

export interface ParsedMessage {
  fromEmail: string;
  fromDisplayName: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  internalDate: Date;
  rawHeaders: Record<string, string>;
  parsedCompanyDomain: string;
  parsedRole: string;
  normalizedRole: string;
}

const pickHeader = (headers: ParsedHeader[] | undefined, key: string): string => {
  if (!headers) {
    return "";
  }
  return (
    headers.find((header) => header.name?.toLowerCase() === key.toLowerCase())?.value ?? ""
  );
};

const decodeBase64Url = (value: string): string => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  const normalized = padding === 0 ? base64 : base64.padEnd(base64.length + (4 - padding), "=");
  return Buffer.from(normalized, "base64").toString("utf8");
};

const extractDisplayName = (raw: string): string => {
  const cleaned = raw.trim();
  if (!cleaned) {
    return "";
  }

  const withAngle = cleaned.match(/^(.*?)</);
  const candidate = (withAngle?.[1] ?? cleaned)
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return candidate;
};

const collectBodyParts = (
  part: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: unknown[] | null } | undefined,
): { text: string[]; html: string[] } => {
  if (!part) {
    return { text: [], html: [] };
  }

  const text: string[] = [];
  const html: string[] = [];

  if (part.body?.data) {
    if (part.mimeType === "text/plain") {
      text.push(decodeBase64Url(part.body.data));
    }
    if (part.mimeType === "text/html") {
      html.push(decodeBase64Url(part.body.data));
    }
  }

  for (const child of part.parts ?? []) {
    const nested = collectBodyParts(child as typeof part);
    text.push(...nested.text);
    html.push(...nested.html);
  }

  return { text, html };
};

const normalizeRoleCandidate = (value: string): string => {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:|]+|[\s\-:|]+$/g, "")
    .replace(/\s+at\s+[A-Za-z0-9&.\- ]{2,}$/i, "")
    .trim()
    .slice(0, 80);
};

const extractRole = (subject: string, body: string): string => {
  const combined = `${subject} ${body}`.replace(/\s+/g, " ");
  const patterns = [
    /application(?:\s+for|\s+to)?\s+([A-Za-z0-9/&,+().\-\s]{3,80})/i,
    /interview\s+for\s+([A-Za-z0-9/&,+().\-\s]{3,80})/i,
    /assessment\s+for\s+([A-Za-z0-9/&,+().\-\s]{3,80})/i,
    /offer\s+for\s+([A-Za-z0-9/&,+().\-\s]{3,80})/i,
    /position(?:\s+of|\s*:|\s+is)?\s+([A-Za-z0-9/&,+().\-\s]{3,80})/i,
    /role(?:\s+of|\s*:|\s+is)?\s+([A-Za-z0-9/&,+().\-\s]{3,80})/i,
    /for\s+the\s+([A-Za-z0-9/&,+().\-\s]{3,80})\s+(?:position|role)/i,
  ];

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    const candidate = match?.[1] ? normalizeRoleCandidate(match[1]) : "";
    if (candidate.length >= 3) {
      return candidate;
    }
  }

  return "unknown-role";
};

export const parseGmailMessagePayload = (payload: {
  headers?: ParsedHeader[];
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: unknown[] | null;
}, internalDate?: string | null): ParsedMessage => {
  const headers = payload.headers ?? [];
  const fromRaw = pickHeader(headers, "from");
  const toRaw = pickHeader(headers, "to");
  const subject = pickHeader(headers, "subject");

  const collected = collectBodyParts(payload);
  const bodyText = collected.text.join("\n").trim();
  const bodyHtml = collected.html.join("\n").trim();

  const parsedRole = extractRole(subject, bodyText || bodyHtml);
  const fromEmail = extractEmailAddress(fromRaw);
  const parsedCompanyDomain = extractDomainFromEmail(fromEmail);
  const fromDisplayName = extractDisplayName(fromRaw);
  const headerObject = Object.fromEntries(
    headers
      .filter((header) => Boolean(header.name))
      .map((header) => [String(header.name).toLowerCase(), header.value ?? ""]),
  );

  return {
    fromEmail,
    fromDisplayName,
    toEmail: extractEmailAddress(toRaw),
    subject,
    bodyText,
    bodyHtml,
    internalDate: internalDate ? new Date(Number(internalDate)) : new Date(),
    rawHeaders: headerObject,
    parsedCompanyDomain,
    parsedRole,
    normalizedRole: normalizeRole(parsedRole),
  };
};
