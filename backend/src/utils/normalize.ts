const ROLE_SYNONYMS: Record<string, string> = {
  "software engineer": "software engineer",
  "software developer": "software engineer",
  "full stack developer": "full stack engineer",
  "fullstack developer": "full stack engineer",
  "frontend developer": "frontend engineer",
  "backend developer": "backend engineer",
};

export const normalizeRole = (input: string): string => {
  const sanitized = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) {
    return "unknown-role";
  }

  return ROLE_SYNONYMS[sanitized] ?? sanitized;
};

export const extractEmailAddress = (raw: string): string => {
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? raw.trim().toLowerCase();
};

export const extractDomainFromEmail = (email: string): string => {
  const normalized = extractEmailAddress(email);
  const parts = normalized.split("@");
  return parts[1] ?? "";
};

export const inferCompanyNameFromDomain = (domain: string): string => {
  if (!domain) {
    return "Unknown Company";
  }
  const firstLabel = domain.split(".")[0] ?? domain;
  return firstLabel
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export const buildDuplicateKey = (companyDomain: string, roleTitle: string): string => {
  return `${companyDomain.trim().toLowerCase()}::${normalizeRole(roleTitle)}`;
};
