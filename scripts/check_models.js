
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

// Manually read .env.local
const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
        envVars[key.trim()] = value.trim();
    }
});

const genAI = new GoogleGenerativeAI(envVars.GEMINI_API_KEY);

async function listModels() {
    try {
        const models = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).countTokens("test");
        // Wait, listModels is on the genAI instance directly not accessible easily in this SDK version?
        // Actually typically it's specific to the API. 
        // Let's just try to infer from docs or error messages. 
        // BUT older SDKs had listModels. Newer ones? 
        // Let's try to just instantiate some models and see if they work with a simple prompt.

        // The previous error message explicitly said "Call ListModels to see...".
        // So there IS a way.

        // In node SDK it might be separate?
        // Actually let's just use axios to call the API directly if SDK is confusing.

        console.log("Checking gemini-1.5-flash...");
        const model1 = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        await model1.generateContent("Test");
        console.log("gemini-1.5-flash WORKS");
    } catch (e1) {
        console.log("gemini-1.5-flash FAILED:", e1.message.substring(0, 100));

        try {
            console.log("Checking gemini-pro...");
            const model2 = genAI.getGenerativeModel({ model: "gemini-pro" });
            await model2.generateContent("Test");
            console.log("gemini-pro WORKS");
        } catch (e2) {
            console.log("gemini-pro FAILED:", e2.message.substring(0, 100));

            try {
                console.log("Checking gemini-1.5-pro...");
                const model3 = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
                await model3.generateContent("Test");
                console.log("gemini-1.5-pro WORKS");
            } catch (e3) {
                console.log("gemini-1.5-pro FAILED:", e3.message.substring(0, 100));
            }
        }
    }
}

listModels();
