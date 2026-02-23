import fs from "fs/promises";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
import mammoth from "mammoth";
import { prisma } from "../lib/prisma.js";
import { extractCvWithOllama } from "./ollamaService.js";
import { getSettings } from "./settingsService.js";

export interface CvSummary {
    id: string;
    filename: string;
    isDefault: boolean;
    skills: string;
    summary: string;
    rolePrimary: string;
    experienceYears: string;
    createdAt: string;
}

export const listCvs = async (userEmail: string): Promise<CvSummary[]> => {
    const cvs = await (prisma as any).cV.findMany({
        where: { userEmail },
        orderBy: { createdAt: "desc" },
    });
    return cvs.map((cv: any) => ({
        id: cv.id,
        filename: cv.filename,
        isDefault: cv.isDefault,
        skills: cv.skills || "",
        summary: cv.summary || "",
        rolePrimary: cv.rolePrimary || "",
        experienceYears: cv.experienceYears || "",
        createdAt: cv.createdAt.toISOString(),
    }));
};

export const deleteCv = async (userEmail: string, id: string) => {
    const cv = await (prisma as any).cV.findFirst({ where: { id, userEmail } });
    if (!cv) return;

    try {
        await fs.unlink(cv.filePath);
    } catch (err) {
        console.error("Failed to delete CV file:", err);
    }

    await (prisma as any).cV.delete({ where: { id } });
};

export const setDefaultCv = async (userEmail: string, id: string) => {
    await (prisma as any).$transaction([
        (prisma as any).cV.updateMany({ where: { userEmail }, data: { isDefault: false } }),
        (prisma as any).cV.updateMany({ where: { id, userEmail }, data: { isDefault: true } }),
    ]);
};

export const processCvUpload = async (userEmail: string, filePath: string, filename: string, fileType: string) => {
    let text = "";
    try {
        if (fileType === "application/pdf") {
            const buffer = await fs.readFile(filePath);
            const data = await pdf(buffer);
            text = data.text;
        } else if (
            fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
            filename.endsWith(".docx")
        ) {
            const result = await mammoth.extractRawText({ path: filePath });
            text = result.value;
        } else {
            // Fallback for text files or unknown
            text = await fs.readFile(filePath, "utf-8");
        }
    } catch (err) {
        console.error("Failed to extract text from CV:", err);
        text = "Error extracting text";
    }

    const settings = await getSettings(userEmail);
    const analysis = await extractCvWithOllama(text, { model: settings.modelCv });

    const existingCount = await (prisma as any).cV.count({ where: { userEmail } });

    return (prisma as any).cV.create({
        data: {
            userEmail,
            filename,
            filePath,
            fileType,
            extractedText: text,
            skills: analysis?.skills.join(", ") || "",
            summary: analysis?.summary || "",
            rolePrimary: analysis?.rolePrimary || "",
            experienceYears: analysis?.experienceYears || "",
            isDefault: existingCount === 0,
        },
    });
};

export const getDefaultCv = async (userEmail: string) => {
    return (prisma as any).cV.findFirst({
        where: { userEmail, isDefault: true },
    });
};
