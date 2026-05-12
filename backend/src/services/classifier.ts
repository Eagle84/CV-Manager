import type { ApplicationStatus } from "@prisma/client";

export interface ClassificationResult {
  matchedRule: string;
  confidence: number;
  predictedStatus: ApplicationStatus | "unclassified";
  isConfirmation: boolean;
  needsReview: boolean;
  matchedPhrases: string[];
}

interface RuleDefinition {
  status: ApplicationStatus;
  label: string;
  keywords: string[];
}

const RULES: RuleDefinition[] = [
  {
    status: "rejected",
    label: "rejected",
    keywords: [
      // Multi-word phrases first (most specific)
      "we regret to inform you",
      "we are unable to move forward",
      "after careful consideration",
      "we will not be moving forward",
      "not been selected for",
      "decided to move forward with other candidates",
      "you have not been selected",
      "we have decided not to proceed",
      "position has been filled",
      "no longer considering your application",
      "we have chosen to proceed with other candidates",
      "decided to pursue other candidates",
      "we are moving forward with another candidate",
      "your application was not successful",
      "not successful on this occasion",
      "we've decided to go in a different direction",
      "gone in a different direction",
      "we will not be proceeding",
      "regret to inform",
      "not moving forward",
      "unfortunately we",
      "unfortunately, we",
      "we regret",
      "not selected",
      // Single words last
      "unsuccessful",
      "declined",
      "rejected",
      "unfortunately",
      "not a match",
      "no longer under consideration",
    ],
  },
  {
    status: "interview",
    label: "interview",
    keywords: [
      // Sub-type phrases first
      "phone screen",
      "phone interview",
      "video interview",
      "technical interview",
      "onsite interview",
      "on-site interview",
      "hiring manager interview",
      "panel interview",
      "final round interview",
      "in-person interview",
      "zoom interview",
      "invite you to interview",
      "schedule an interview",
      "schedule a call",
      "schedule time",
      "would like to speak with you",
      "would like to connect",
      "set up a time to talk",
      "meet with our team",
      "move you to the next stage",
      "availability for",
      "next round",
      "first round",
      "second round",
      "introductory call",
      "discovery call",
      "recruiter call",
      "screening call",
      // Single words last
      "interview",
      "schedule",
      "availability",
      "meet with",
    ],
  },
  {
    status: "assessment",
    label: "assessment",
    keywords: [
      "take-home assignment",
      "take home assignment",
      "technical assessment",
      "coding challenge",
      "technical challenge",
      "technical exercise",
      "technical screen",
      "skills assessment",
      "online assessment",
      "timed assessment",
      "pre-employment test",
      "task to complete",
      "complete the following",
      "hackerrank",
      "codility",
      "codesignal",
      "aptitude test",
      "background check",
      "reference check",
      // Single words last
      "assignment",
      "assessment",
      "exercise",
    ],
  },
  {
    status: "offer",
    label: "offer",
    keywords: [
      "pleased to offer you",
      "we would like to offer",
      "formal offer",
      "offer letter",
      "offer of employment",
      "compensation package",
      "salary offer",
      "welcome to the team",
      "welcome aboard",
      "we are delighted to inform",
      "pleased to inform you",
      "pleased to let you know",
      "we are excited to move forward",
      "moving forward with your application",
      "you have been selected",
      "selected for the position",
      "selected for this role",
      "joining date",
      "start date",
      "onboarding",
      // Single words last
      "congratulations",
      "approved",
      "offer",
      "compensation",
      "joining",
    ],
  },
  {
    status: "received",
    label: "received",
    keywords: [
      "thank you for applying to",
      "thank you for your application to",
      "thanks for applying to",
      "thank you for submitting your application",
      "we have received your application",
      "your application has been received",
      "we got your application",
      "successfully submitted",
      "application is under review",
      "will be in touch",
      "we will review your application",
      // Shorter phrases last
      "application received",
      "application submitted",
      "we received",
      "thank you for applying",
      "thanks for applying",
      "we got it",
    ],
  },
];

const containsKeyword = (text: string, keyword: string): boolean => {
  const isMultiWord = keyword.includes(" ") || keyword.includes("-");
  if (isMultiWord) {
    return text.includes(keyword);
  }
  // Use word-boundary matching for single words to avoid false positives
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`);
  return pattern.test(text);
};

export const classifyEmailContent = (subject: string, bodyText: string): ClassificationResult => {
  const combined = `${subject}\n${bodyText}`.toLowerCase();

  for (const rule of RULES) {
    const firstMatch = rule.keywords.find((keyword) => containsKeyword(combined, keyword));
    if (firstMatch) {
      // Collect all matched phrases from this rule for diagnostic purposes
      const matchedPhrases = rule.keywords.filter((keyword) => containsKeyword(combined, keyword));
      const isMultiWord = firstMatch.includes(" ") || firstMatch.includes("-");
      const confidence = isMultiWord ? 0.95 : 0.80;
      return {
        matchedRule: `${rule.label}:${firstMatch}`,
        confidence,
        predictedStatus: rule.status,
        isConfirmation: rule.status === "received",
        needsReview: confidence < 0.75,
        matchedPhrases,
      };
    }
  }

  return {
    matchedRule: "none",
    confidence: 0,
    predictedStatus: "unclassified",
    isConfirmation: false,
    needsReview: true,
    matchedPhrases: [],
  };
};
