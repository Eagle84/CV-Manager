import { z } from "zod";
import { config } from "../config.js";

const statusSchema = z.enum([
  "submitted",
  "received",
  "rejected",
  "interview",
  "assessment",
  "offer",
  "withdrawn",
  "unclassified",
]);

const ollamaExtractionSchema = z.object({
  include: z.boolean(),
  companyName: z.string().nullable(),
  companyDomain: z.string().nullable(),
  roleTitle: z.string().nullable(),
  status: statusSchema.nullable(),
  normalizedSubjectKey: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type OllamaExtraction = z.infer<typeof ollamaExtractionSchema>;

export interface OllamaExtractionInput {
  subject: string;
  body: string;
  fromEmail: string;
  fromDisplayName: string;
  senderDomain: string;
}

interface OllamaGenerateResponse {
  response?: string;
}

export interface OllamaExtractionResult {
  ok: boolean;
  value: OllamaExtraction | null;
  error?: string;
  rawResponse?: string;
}

const CONTROL_PREFIXES = [/^re:\s*/i, /^fw:\s*/i, /^fwd:\s*/i];

export const normalizeSubjectForGroup = (subject: string): string => {
  let normalized = subject.trim().toLowerCase();
  for (const prefix of CONTROL_PREFIXES) {
    normalized = normalized.replace(prefix, "");
  }

  normalized = normalized
    .replace(/^we got it[:,]?\s*/i, "")
    .replace(/thanks for applying(?:\s+(?:to|for))?/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "thanks-for-applying";
  }

  return normalized.split(" ").slice(0, 12).join("-");
};

const extractJsonCandidate = (text: string): string | null => {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return trimmed.slice(start, end + 1);
};

const buildPrompt = (input: OllamaExtractionInput): string => {
  return [
    "You are an email extraction engine.",
    "Extract information from hiring acknowledgement email context and return ONLY valid JSON.",
    "Schema:",
    "{",
    '  "include": boolean,',
    '  "companyName": string | null,',
    '  "companyDomain": string | null,',
    '  "roleTitle": string | null,',
    '  "status": "submitted" | "received" | "rejected" | "interview" | "assessment" | "offer" | "withdrawn" | "unclassified" | null,',
    '  "normalizedSubjectKey": string | null,',
    '  "confidence": number',
    "}",
    "Rules:",
    "1) include=true only for job application process emails.",
    "2) If subject says 'Thanks for applying', status is usually 'received' unless conflicting evidence.",
    "3) normalizedSubjectKey should be stable for small variations and lowercase with words separated by dashes.",
    "4) If unknown, return null for field values.",
    "",
    `subject: ${input.subject}`,
    `from_email: ${input.fromEmail}`,
    `from_display_name: ${input.fromDisplayName}`,
    `sender_domain: ${input.senderDomain}`,
    `body: ${input.body.slice(0, 6000)}`,
  ].join("\n");
};

const callOllama = async (input: OllamaExtractionInput): Promise<OllamaGenerateResponse> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.OLLAMA_MODEL,
        prompt: buildPrompt(input),
        stream: false,
        format: "json",
        options: {
          temperature: 0.1,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}`);
    }

    return (await response.json()) as OllamaGenerateResponse;
  } finally {
    clearTimeout(timeout);
  }
};

export const extractWithOllama = async (
  input: OllamaExtractionInput,
): Promise<OllamaExtractionResult> => {
  if (!config.OLLAMA_ENABLED) {
    return {
      ok: false,
      value: null,
      error: "Ollama disabled",
    };
  }

  let lastError = "Unknown Ollama error";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callOllama(input);
      const raw = String(response.response ?? "").trim();
      const candidate = extractJsonCandidate(raw);
      if (!candidate) {
        lastError = "Ollama did not return JSON payload";
        continue;
      }

      const parsed = JSON.parse(candidate) as unknown;
      const validated = ollamaExtractionSchema.safeParse(parsed);
      if (!validated.success) {
        lastError = validated.error.issues.map((issue) => issue.message).join("; ");
        continue;
      }

      return {
        ok: true,
        value: validated.data,
        rawResponse: raw,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown Ollama exception";
      break;
    }
  }

  return {
    ok: false,
    value: null,
    error: lastError,
  };
};
