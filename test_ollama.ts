import { extractCvWithOllama } from "./backend/src/services/ollamaService.js";
import { config } from "./backend/src/config.js";

async function test() {
    console.log("Config:", {
        enabled: config.OLLAMA_ENABLED,
        url: config.OLLAMA_BASE_URL,
        model: config.OLLAMA_MODEL
    });

    const sampleText = "Igal Boguslavsky. QA Director. Experience in automation, lead teams, Python, JS.";
    console.log("Testing with sample text...");
    const result = await extractCvWithOllama(sampleText);
    console.log("Result:", result);
}

test();
