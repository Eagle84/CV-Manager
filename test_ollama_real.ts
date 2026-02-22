import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve("backend", ".env") });
import { extractCvWithOllama } from "./backend/src/services/ollamaService.js";
import fs from "fs/promises";

async function test() {
    const text = await fs.readFile("cv_text.txt", "utf-8");
    console.log(`Testing with real CV text (${text.length} chars)...`);
    const result = await extractCvWithOllama(text);
    console.log("Result:", JSON.stringify(result, null, 2));
}

test();
