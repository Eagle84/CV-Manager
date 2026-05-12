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
  // Extended fields — optional so older/smaller models that omit them still parse
  interviewType: z.enum(["phone", "video", "onsite"]).nullable().optional(),
  interviewDate: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  keyPhrasesFound: z.array(z.string()).optional(),
});

const cvExtractionSchema = z.object({
  skills: z.array(z.string()),
  summary: z.string().nullable(),
  rolePrimary: z.string().nullable(),
  experienceYears: z.string().nullable(),
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

const truncateBody = (body: string): string => {
  if (body.length <= 4000) return body;
  return `${body.slice(0, 3000)}\n...[truncated]...\n${body.slice(-1000)}`;
};

const buildPrompt = (input: OllamaExtractionInput): string => {
  return `You are an email classification engine for a job application tracker.
Analyze the email below and return ONLY a single valid JSON object — no explanation, no markdown, no code fences.

OUTPUT SCHEMA:
{
  "include": boolean,
  "companyName": string | null,
  "companyDomain": string | null,
  "roleTitle": string | null,
  "status": "received" | "rejected" | "interview" | "assessment" | "offer" | "withdrawn" | "submitted" | "unclassified" | null,
  "normalizedSubjectKey": string | null,
  "confidence": number (0.0-1.0),
  "interviewType": "phone" | "video" | "onsite" | null,
  "interviewDate": "YYYY-MM-DD" | null,
  "contactName": string | null,
  "keyPhrasesFound": string[]
}

FIELD RULES:
- include: true ONLY for job application process emails (confirmation, rejection, interview invite, assessment, offer). Set false for newsletters, promotions, LinkedIn notifications, bank alerts, account security emails, shipping confirmations, social media, unrelated calendar invites.
- status: "received" for initial acknowledgements. "interview" when scheduling/confirming a meeting. "assessment" for tests/coding challenges. "offer" for job offer or compensation discussion. "rejected" for any decline. "withdrawn" only if candidate withdrew. "unclassified" if unclear.
- normalizedSubjectKey: Lowercase, words separated by dashes, strip "Re:", "Fwd:", "Thanks for applying", special chars. Max 12 words. Example: "software-engineer-application-acme-corp".
- interviewType: "phone" for phone screen/call, "video" for Zoom/Teams/video call, "onsite" for in-person. Null if not an interview email.
- interviewDate: ISO date (YYYY-MM-DD) of the interview if explicitly mentioned. Null if not mentioned.
- contactName: Name of the recruiter or hiring manager if mentioned in signature or body. Null if not found.
- keyPhrasesFound: Up to 5 short verbatim phrases from the email that most clearly indicate the classification. Empty array if none.
- confidence: 0.95 for clear unambiguous signals, 0.75 for moderate, 0.5 for weak or mixed signals.

--- EXAMPLE 1: received ---
subject: Thanks for applying to Acme Corp
from_email: careers@acme.com
from_display_name: Acme Corp Recruiting
sender_domain: acme.com
body: Hi Alex, we have received your application for the Software Engineer position. We will be in touch if your profile matches our needs.
OUTPUT: {"include":true,"companyName":"Acme Corp","companyDomain":"acme.com","roleTitle":"Software Engineer","status":"received","normalizedSubjectKey":"acme-corp-software-engineer","confidence":0.95,"interviewType":null,"interviewDate":null,"contactName":null,"keyPhrasesFound":["we have received your application","will be in touch"]}

--- EXAMPLE 2: rejected ---
subject: Your application to DataFlow Inc
from_email: noreply@dataflow.io
from_display_name: DataFlow Recruiting
sender_domain: dataflow.io
body: Dear Alex, thank you for taking the time to apply. After careful consideration, we have decided not to move forward with your application at this time.
OUTPUT: {"include":true,"companyName":"DataFlow Inc","companyDomain":"dataflow.io","roleTitle":null,"status":"rejected","normalizedSubjectKey":"dataflow-inc-application","confidence":0.95,"interviewType":null,"interviewDate":null,"contactName":null,"keyPhrasesFound":["after careful consideration","decided not to move forward"]}

--- EXAMPLE 3: interview (phone) ---
subject: Interview Invitation - Backend Engineer at TechBase
from_email: recruiting@techbase.com
from_display_name: Sarah - TechBase
sender_domain: techbase.com
body: Hi Alex, I'm Sarah from TechBase recruiting. We'd love to schedule a 30-minute phone screen with you for the Backend Engineer role. Are you available this Thursday or Friday between 2-5pm?
OUTPUT: {"include":true,"companyName":"TechBase","companyDomain":"techbase.com","roleTitle":"Backend Engineer","status":"interview","normalizedSubjectKey":"interview-invitation-backend-engineer-techbase","confidence":0.95,"interviewType":"phone","interviewDate":null,"contactName":"Sarah","keyPhrasesFound":["schedule a 30-minute phone screen","are you available"]}

--- EXAMPLE 4: assessment ---
subject: Technical Assessment - Software Engineer - CloudNine
from_email: noreply@cloudnine.io
from_display_name: CloudNine Hiring
sender_domain: cloudnine.io
body: Congratulations on moving to the next stage! Please complete the attached coding challenge within 72 hours. The test covers data structures and algorithms.
OUTPUT: {"include":true,"companyName":"CloudNine","companyDomain":"cloudnine.io","roleTitle":"Software Engineer","status":"assessment","normalizedSubjectKey":"technical-assessment-software-engineer-cloudnine","confidence":0.95,"interviewType":null,"interviewDate":null,"contactName":null,"keyPhrasesFound":["complete the attached coding challenge","within 72 hours"]}

--- EXAMPLE 5: offer ---
subject: Offer Letter - Senior Engineer - Nexus Systems
from_email: hr@nexussystems.com
from_display_name: Nexus Systems HR
sender_domain: nexussystems.com
body: Dear Alex, we are delighted to extend a formal offer for the Senior Engineer role. Your compensation package includes a base salary of $130,000. Please sign and return the attached offer letter by Friday.
OUTPUT: {"include":true,"companyName":"Nexus Systems","companyDomain":"nexussystems.com","roleTitle":"Senior Engineer","status":"offer","normalizedSubjectKey":"offer-letter-senior-engineer-nexus-systems","confidence":0.95,"interviewType":null,"interviewDate":null,"contactName":null,"keyPhrasesFound":["formal offer","compensation package","offer letter"]}

--- EXAMPLE 6: include=false (LinkedIn notification) ---
subject: Alex, 3 people viewed your profile
from_email: jobs-noreply@linkedin.com
from_display_name: LinkedIn
sender_domain: linkedin.com
body: You had 3 profile views this week. Check out who's looking at your profile. Upgrade to Premium to see all viewers.
OUTPUT: {"include":false,"companyName":null,"companyDomain":null,"roleTitle":null,"status":null,"normalizedSubjectKey":null,"confidence":0.99,"interviewType":null,"interviewDate":null,"contactName":null,"keyPhrasesFound":[]}

--- EXAMPLE 7: include=false (promo/newsletter) ---
subject: 50% off your next order - Shop now!
from_email: noreply@shopbrand.com
from_display_name: ShopBrand Deals
sender_domain: shopbrand.com
body: Exclusive deal just for you. Use code SAVE50 at checkout. Limited time only.
OUTPUT: {"include":false,"companyName":null,"companyDomain":null,"roleTitle":null,"status":null,"normalizedSubjectKey":null,"confidence":0.99,"interviewType":null,"interviewDate":null,"contactName":null,"keyPhrasesFound":[]}

--- EXAMPLE 8: unclassified (cold recruiter outreach) ---
subject: Exciting opportunity at InnovateTech
from_email: recruiter@innovatetech.com
from_display_name: Mark - InnovateTech
sender_domain: innovatetech.com
body: Hi! I came across your profile and think you'd be a great fit for a Senior Developer role we have open. Would you be interested in learning more?
OUTPUT: {"include":true,"companyName":"InnovateTech","companyDomain":"innovatetech.com","roleTitle":"Senior Developer","status":"unclassified","normalizedSubjectKey":"opportunity-innovatetech-senior-developer","confidence":0.6,"interviewType":null,"interviewDate":null,"contactName":"Mark","keyPhrasesFound":["would you be interested"]}

NOW CLASSIFY THIS EMAIL:
subject: ${input.subject}
from_email: ${input.fromEmail}
from_display_name: ${input.fromDisplayName}
sender_domain: ${input.senderDomain}
body: ${truncateBody(input.body)}`;
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
  "skills": ["Category: Tool1, Tool2", "Domain Expertise", ...],
  "summary": "Professional 3rd-person summary emphasizing high-level achievements and impact.",
  "rolePrimary": "Most recent or significant job title",
  "experienceYears": "Total estimated years (e.g. '15+ years')"
}

Rules for Extraction:
1. summary: Write a concise, powerful 3-4 sentence professional profile. Focus on 'What' and 'How' (Impact).
2. skills: Group tools logically (e.g. 'Automation: Playwright, Cypress'). Include core methodologies.
3. experienceYears: Infer from dates provided if not explicitly stated.

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
