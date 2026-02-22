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

const cvExtractionSchema = z.object({
  skills: z.array(z.string()),
  summary: z.string().nullable(),
  rolePrimary: z.string().nullable(),
});

const jobMatchingSchema = z.object({
  matchScore: z.number().min(0).max(100),
  matchingSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  strengths: z.array(z.string()),
  overqualifiedSkills: z.array(z.string()),
  advice: z.string(),
});

export type OllamaExtraction = z.infer<typeof ollamaExtractionSchema>;
export type CvExtraction = z.infer<typeof cvExtractionSchema>;
export type JobMatching = z.infer<typeof jobMatchingSchema>;

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

export const extractJsonCandidate = (text: string): string | null => {
  // Strip DeepSeek/Reasoning <think>...</think> blocks if present
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    return cleaned;
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return cleaned.slice(start, end + 1);
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

const callOllama = async (
  model: string,
  prompt: string,
): Promise<OllamaGenerateResponse> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
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
  overrides?: { model?: string },
): Promise<OllamaExtractionResult> => {
  if (!config.OLLAMA_ENABLED) {
    return {
      ok: false,
      value: null,
      error: "Ollama disabled",
    };
  }

  const model = overrides?.model || config.OLLAMA_MODEL;
  const prompt = buildPrompt(input);

  let lastError = "Unknown Ollama error";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callOllama(model, prompt);
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

export const extractCvWithOllama = async (text: string, overrides?: { model?: string }): Promise<CvExtraction | null> => {
  if (!config.OLLAMA_ENABLED) return null;

  const model = overrides?.model || config.OLLAMA_MODEL;
  const controller = new AbortController();
  console.log(`[Ollama] Timeout set to: ${config.OLLAMA_TIMEOUT_MS}ms. Using model: ${model}`);
  const timeout = setTimeout(() => controller.abort(), config.OLLAMA_TIMEOUT_MS);

  try {
    console.log(`[Ollama] Extracting CV...`);
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: `Analyze this CV text and provide the analysis in the following JSON format ONLY:
{
  "skills": ["skill1", "skill2", ...],
  "summary": "Full summary text here",
  "rolePrimary": "Job Title"
}

Text: ${text.slice(0, 10000)}`,
        stream: false,
        // format: "json", // Disabled for better DeepSeek-R1 compatibility
        options: { temperature: 0.1 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[Ollama] Request failed with status: ${response.status}`);
      return null;
    }
    const body = await response.json() as any;
    const raw = String(body.response ?? "").trim();
    console.log(`[Ollama] Received response (${raw.length} chars)`);

    const candidate = extractJsonCandidate(raw);
    if (!candidate) {
      console.error("[Ollama] Could not find JSON block in response. Raw response snippet:", raw.slice(0, 500));
      return null;
    }

    try {
      const parsed = JSON.parse(candidate);
      const validated = cvExtractionSchema.safeParse(parsed);
      if (!validated.success) {
        console.error("[Ollama] Validation failed for JSON:", candidate);
        console.error("[Ollama] Errors:", validated.error.format());
        return null;
      }
      return validated.data;
    } catch (err: any) {
      console.error(`[Ollama] JSON Parse Error: ${err.message}. Block was:`, candidate);
      return null;
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error(`[Ollama] Request aborted due to timeout (${config.OLLAMA_TIMEOUT_MS}ms)`);
    } else {
      console.error(`[Ollama] Unexpected error: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const matchJobWithCv = async (targetJob: string, cvText: string, overrides?: { model?: string }): Promise<JobMatching | null> => {
  if (!config.OLLAMA_ENABLED) return null;

  const model = overrides?.model || config.OLLAMA_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: `Compare this job description with my CV. Return a JSON object with:
- matchScore (0-100)
- matchingSkills (list of strings)
- missingSkills (gaps/no knowledge - list of strings)
- strengths (what is strong/perfect match on my CV - list of strings)
- overqualifiedSkills (what I have MORE than expected for this role - list of strings)
- advice (specific actionable advice on how to proceed)

Job Description: ${targetJob.slice(0, 8000)}
My CV: ${cvText.slice(0, 8000)}
Return ONLY valid JSON.`,
        stream: false,
        format: "json",
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json() as any;
    const raw = String(body.response ?? "").trim();
    const candidate = extractJsonCandidate(raw);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    const validated = jobMatchingSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch (err: any) {
    console.error(`[Ollama] Job Match failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
