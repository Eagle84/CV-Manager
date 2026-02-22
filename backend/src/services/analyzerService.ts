import * as cheerio from "cheerio";
import { matchJobWithCv, extractJsonCandidate } from "./ollamaService.js";
import { getDefaultCv } from "./cvService.js";
import { getSettings } from "./settingsService.js";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";

export const scrapeJobDescription = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            },
        });
        if (!response.ok) throw new Error(`Could not access the website (Status ${response.status}). Many company sites block automated tools; you can try copying the text manually instead.`);
        const html = await response.text();
        const $ = cheerio.load(html);

        // Remove scripts, styles, and nav items to get cleaner text
        $("script, style, nav, footer, header, noscript").remove();

        // Try to find the main content area
        const bodyText = $("body").text();

        // Clean up whitespace
        const cleaned = bodyText.replace(/\s+/g, " ").trim();
        if (!cleaned) throw new Error("The website was reached, but no readable text was found. It might be protected or a single-page app (SPA).");

        return cleaned;
    } catch (err: any) {
        if (err.code === 'ENOTFOUND' || err.cause?.code === 'ENOTFOUND' || err.message?.includes('fetch failed')) {
            const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
            throw new Error(`Reachability error: Could not resolve or connect to '${hostname}'. Please verify the URL or your internet connection.`);
        }
        console.error("Scraping error:", err);
        throw err;
    }
};

export const analyzeJobUrl = async (url: string) => {
    const jdText = await scrapeJobDescription(url);
    const cv = await getDefaultCv();

    if (!cv || !cv.extractedText) {
        throw new Error("No primary CV found. Please upload a CV first in the My CVs page.");
    }

    const settings = await getSettings();
    const analysis = await matchJobWithCv(jdText, cv.extractedText, { model: settings.modelMatcher });

    if (!analysis) {
        throw new Error("Could not generate AI analysis for this job. The AI model might be busy or the content was unreadable.");
    }

    return {
        url,
        jdSnippet: jdText.slice(0, 500) + "...",
        analysis,
    };
};

export const findCareersPage = async (companyName: string, companyUrl?: string) => {
    // Logic to find a careers page. 
    // For now, we'll try common patterns if domain is provided, 
    // or a placeholder for a search API.
    const domain = companyUrl ? companyUrl.replace(/^https?:\/\//, "").split("/")[0] : companyName.toLowerCase().replace(/\s+/g, "") + ".com";

    const commonPaths = ["/careers", "/jobs", "/career", "/join-us", "/about/careers"];
    for (const path of commonPaths) {
        const candidate = `https://${domain}${path}`;
        try {
            const resp = await fetch(candidate, { method: "HEAD" });
            if (resp.ok) return candidate;
        } catch { }
    }


    return null;
};

export const findMatchingJobsOnPage = async (pageUrl: string) => {
    const cv = await getDefaultCv();
    if (!cv || !cv.extractedText) throw new Error("No CV found.");

    const response = await fetch(pageUrl);
    const html = await response.text();
    const $ = cheerio.load(html);

    const links: { title: string; url: string }[] = [];
    const jobKeywords = ["/jobs/", "/job/", "/careers/", "/career/", "view-job", "application", "position", "opening", "listing"];
    const roleKeywords = ["engineer", "developer", "manager", "specialist", "analyst", "lead", "designer", "architect", "consultant"];

    $("a").each((_, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        const lowerHref = (href || "").toLowerCase();
        const lowerText = text.toLowerCase();

        if (href && (
            jobKeywords.some(k => lowerHref.includes(k)) ||
            roleKeywords.some(k => lowerText.includes(k))
        )) {
            try {
                links.push({ title: text || "Untitled Position", url: new URL(href, pageUrl).toString() });
            } catch { }
        }
    });

    if (links.length === 0) return [];

    // Use LLM to pick the top 3 matches
    const prompt = `Based on my CV summary: ${cv.summary}\n\nPick the top 3 most relevant job links from this list for someone with these skills: ${cv.skills}.\n\nLinks:\n${links.slice(0, 30).map(l => `- ${l.title}: ${l.url}`).join("\n")}\n\nReturn ONLY JSON as an array of {title, url, reasoning}.`;

    const settings = await getSettings();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.OLLAMA_TIMEOUT_MS);

    try {
        const aiResp = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: settings.modelExplorer,
                prompt,
                stream: false,
                format: "json",
            }),
            signal: controller.signal,
        });

        if (!aiResp.ok) {
            console.error(`[Ollama] Explorer search failed with status: ${aiResp.status}`);
            return [];
        }

        const body = await aiResp.json() as any;
        const raw = String(body.response ?? "").trim();
        const candidate = extractJsonCandidate(raw);
        if (!candidate) {
            console.error("[Ollama] Explorer returned no JSON candidate. Raw:", raw.slice(0, 300));
            return [];
        }
        return JSON.parse(candidate) as { title: string; url: string; reasoning: string }[];
    } catch (err: any) {
        if (err.name === 'AbortError') {
            console.error(`[Ollama] Explorer timed out after ${config.OLLAMA_TIMEOUT_MS}ms`);
        } else {
            console.error(`[Ollama] Explorer error:`, err.message);
        }
        return [];
    } finally {
        clearTimeout(timeout);
    }
};

export const classifyCompany = async (companyName: string, url: string): Promise<string> => {
    try {
        const settings = await getSettings(); //
        const prompt = `Classify the industry of this company based on its name and URL. 
Return ONLY a short category (e.g., "Cyber", "Fintech", "Healthcare", "E-commerce", "SaaS", "Automotive", "Retail", "Aviation").
Company Name: ${companyName}
URL: ${url}
Category:`; //

        const response = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
            method: "POST", //
            headers: { "Content-Type": "application/json" }, //
            body: JSON.stringify({
                model: settings.modelClassification, //
                prompt, //
                stream: false, //
                options: { temperature: 0.1 }, //
            }),
        });

        if (!response.ok) return "Unknown"; //
        
        const body = await response.json() as any; //
        return (body.response ?? "Unknown").trim().replace(/[^a-zA-Z-\s]/g, ""); //
    } catch (err: any) {
        // Detailed logging for the ECONNREFUSED error you encountered
        if (err.code === 'ECONNREFUSED') {
            console.error(`[Ollama] Connection refused at ${config.OLLAMA_BASE_URL}. Is the service running?`); //
        } else {
            console.error("Classification error:", err); //
        }
        return "Unknown"; //
    }
};

export const saveTargetCompanies = async (items: { name: string; url: string }[]) => {
    const CHUNK_SIZE = 100;
    const results: any[] = [];

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        await prisma.$transaction(async (tx: any) => {
            for (const item of chunk) {
                if (!item.url) continue;
                try {
                    const saved = await tx.targetCompany.upsert({
                        where: { url: item.url },
                        update: { name: item.name || "Unknown Company" },
                        create: { name: item.name || "Unknown Company", url: item.url },
                    });
                    results.push(saved);

                    // Trigger classification in background if industry is missing
                    if (!saved.industry) {
                        // Use a slight delay to avoid SQLite locking during the active transaction
                        setTimeout(async () => {
                            try {
                                const industry = await classifyCompany(saved.name, saved.url);
                                if (industry && industry !== "Unknown") {
                                    await prisma.targetCompany.update({
                                        where: { id: saved.id },
                                        data: { industry },
                                    });
                                }
                            } catch (err) {
                                console.error(`[Background] Failed to classify ${saved.name}:`, err);
                            }
                        }, 500 + i);
                    }
                } catch (err) {
                    console.error(`Failed to save company ${item.name}:`, err);
                }
            }
        }, {
            maxWait: 20000, // 20s
            timeout: 60000,  // 60s
        });
    }
    return results;
};

export const listTargetCompanies = async (page: number = 1, limit: number = 10, search?: string) => {
    const skip = (page - 1) * limit;
    const where = search ? {
        OR: [
            { name: { contains: search } },
            { url: { contains: search } },
            { industry: { contains: search } },
        ]
    } : {};

    const [total, items] = await Promise.all([
        (prisma as any).targetCompany.count({ where }),
        (prisma as any).targetCompany.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
        }),
    ]);

    return {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        items,
    };
};
