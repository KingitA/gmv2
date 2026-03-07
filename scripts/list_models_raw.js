const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

// Manually parse .env.local
try {
    const envPath = path.resolve(__dirname, '..', '.env.local');
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
} catch (e) {
    console.error("Error reading .env.local:", e);
}

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // For v1beta we might need to use the method provided by the SDK or just try a basic generation to see error
    // The SDK exposes listModels via the API but let's try to infer from error or just try standard ones
    // Actually the SDK doesn't always expose listModels directly on the main class in older versions?
    // Let's try to use the modelManager if available or just hit the REST API manually for certainty.

    try {
        // const fetch = require('node-fetch'); // unlikely to be available so use native fetch if node 18+
        const key = process.env.GEMINI_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

        console.log("Fetching models from:", url);
        const response = await fetch(url);
        const data = await response.json();

        if (data.models) {
            console.log("Available Models:");
            data.models.forEach(m => {
                console.log(`- ${m.name}`);
                // if (m.name.includes("flash")) {
                //    console.log(`- ${m.name}`);
                // }
            });
        } else {
            console.log("No models found or error:", data);
        }
    } catch (e) {
        console.error("Error fetching models:", e);
    }
}

listModels();
