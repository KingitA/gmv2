
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';

// Manual .env loading for standalone script
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const val = values.join('=').trim().replace(/^["'](.*)["']$/, '$1'); // Remove quotes
            if (!process.env[key.trim()]) {
                process.env[key.trim()] = val;
            }
        }
    });
}

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

if (!apiKey) {
    console.error("API Key not found in .env.local");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
    try {
        console.log("Checking model availability for API Key: " + apiKey.substring(0, 5) + "...");

        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

        const response = await fetch(url);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ API Request Failed: ${response.status} ${response.statusText}`);
            console.error(`Error details: ${errorText}`);
            return;
        }

        const data = await response.json();

        if (!data.models) {
            console.log("No models found in response.");
            console.log(JSON.stringify(data, null, 2));
            return;
        }

        console.log(`Found ${data.models.length} models:`);

        const embeddingModels = data.models.filter((m: any) => m.name.includes("embedding"));
        const otherModels = data.models.filter((m: any) => !m.name.includes("embedding"));

        console.log("\n--- Embedding Models ---");
        embeddingModels.forEach((m: any) => {
            console.log(`- ${m.name} (${m.version}) - Supported methods: ${m.supportedGenerationMethods?.join(", ")}`);
        });

        console.log("\n--- Other Models (Top 5) ---");
        otherModels.slice(0, 5).forEach((m: any) => {
            console.log(`- ${m.name} (${m.version})`);
        });

    } catch (error) {
        console.error("Error listing models:", error);
    }
}

// Clear previous output
fs.writeFileSync('model_check_output.txt', '');
const originalLog = console.log;
console.log = (...args) => {
    originalLog(...args);
    fs.appendFileSync('model_check_output.txt', args.join(' ') + '\n');
};

listModels();
