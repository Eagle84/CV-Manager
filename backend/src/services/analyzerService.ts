import * as cheerio from "cheerio";
import { matchJobWithCv, extractJsonCandidate } from "./ollamaService.js";
import { getDefaultCv } from "./cvService.js";
import { getSettings } from "./settingsService.js";
import { config } from "../config.js";

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
    $("a").each((_, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        if (href && (href.includes("/jobs/") || href.includes("/job/") || href.includes("/careers/") || href.includes("view-job"))) {
            try {
                links.push({ title: text, url: new URL(href, pageUrl).toString() });
            } catch { }
        }
    });

    if (links.length === 0) return [];

    // Use LLM to pick the top 3 matches
    const prompt = `Based on my CV summary: ${cv.summary}\n\nPick the top 3 most relevant job links from this list for someone with these skills: ${cv.skills}.\n\nLinks:\n${links.slice(0, 30).map(l => `- ${l.title}: ${l.url}`).join("\n")}\n\nReturn ONLY JSON as an array of {title, url, reasoning}.`;

    const settings = await getSettings();
    const aiResp = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: settings.modelExplorer,
            prompt,
            stream: false,
            format: "json",
        }),
    });

    if (!aiResp.ok) return [];
    const body = await aiResp.json() as any;
    try {
        const raw = String(body.response ?? "").trim();
        const candidate = extractJsonCandidate(raw);
        if (!candidate) return [];
        return JSON.parse(candidate) as { title: string; url: string; reasoning: string }[];
    } catch {
        return [];
    }
};
