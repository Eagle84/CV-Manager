import type { ApplicationStatus } from "@prisma/client";

export interface ClassificationResult {
  matchedRule: string;
  confidence: number;
  predictedStatus: ApplicationStatus | "unclassified";
  isConfirmation: boolean;
  needsReview: boolean;
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
      "unfortunately",
      "not moving forward",
      "other candidates",
      "regret to inform",
      "we regret",
      "not selected",
      "declined",
      "rejected",
      "position has been filled",
    ],
  },
  {
    status: "interview",
    label: "interview",
    keywords: ["interview", "schedule", "availability", "meet with"],
  },
  {
    status: "assessment",
    label: "assessment",
    keywords: ["assignment", "test", "coding challenge", "assessment"],
  },
  {
    status: "offer",
    label: "offer",
    keywords: [
      "offer",
      "compensation",
      "welcome aboard",
      "joining",
      "approved",
      "accepted",
      "selected",
      "moving forward with your application",
      "pleased to inform",
    ],
  },
  {
    status: "received",
    label: "received",
    keywords: [
      "application received",
      "thank you for applying",
      "thanks for applying",
      "application submitted",
      "we received",
    ],
  },
];

const containsKeyword = (text: string, keyword: string): boolean => {
  return text.includes(keyword);
};

export const classifyEmailContent = (subject: string, bodyText: string): ClassificationResult => {
  const combined = `${subject}\n${bodyText}`.toLowerCase();

  for (const rule of RULES) {
    const match = rule.keywords.find((keyword) => containsKeyword(combined, keyword));
    if (match) {
      const isExactPhrase = combined.includes(match);
      const confidence = isExactPhrase ? 0.9 : 0.7;
      return {
        matchedRule: `${rule.label}:${match}`,
        confidence,
        predictedStatus: rule.status,
        isConfirmation: rule.status === "received",
        needsReview: confidence < 0.75,
      };
    }
  }

  return {
    matchedRule: "none",
    confidence: 0,
    predictedStatus: "unclassified",
    isConfirmation: false,
    needsReview: true,
  };
};
