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

export const listCvs = async (): Promise<CvSummary[]> => {
    const cvs = await prisma.cV.findMany({
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

export const deleteCv = async (id: string) => {
    const cv = await prisma.cV.findUnique({ where: { id } });
    if (!cv) return;

    try {
        await fs.unlink(cv.filePath);
    } catch (err) {
        console.error("Failed to delete CV file:", err);
    }

    await prisma.cV.delete({ where: { id } });
};

export const setDefaultCv = async (id: string) => {
    await prisma.$transaction([
        prisma.cV.updateMany({ data: { isDefault: false } }),
        prisma.cV.update({ where: { id }, data: { isDefault: true } }),
    ]);
};

export const processCvUpload = async (filePath: string, filename: string, fileType: string) => {
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

    const settings = await getSettings();
    const analysis = await extractCvWithOllama(text, { model: settings.modelCv });

    const existingCount = await prisma.cV.count();

    return prisma.cV.create({
        data: {
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

export const getDefaultCv = async () => {
    return prisma.cV.findFirst({
        where: { isDefault: true },
    });
};
