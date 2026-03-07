const https = require('https');
const fs = require('fs');
const path = require('path');

// Manually parse .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
let apiKey = "";

try {
    const envContent = fs.readFileSync(envPath, "utf-8");
    const lines = envContent.split("\n");
    for (const line of lines) {
        if (line.startsWith("GEMINI_API_KEY=")) {
            apiKey = line.split("=")[1].trim();
            break;
        }
    }
} catch (e) {
    apiKey = process.env.GEMINI_API_KEY || "";
}

if (!apiKey) {
    console.error("No API Key found");
    process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.models) {
                const lines = json.models
                    .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
                    .map(m => m.name)
                    .join("\n");

                fs.writeFileSync("models_list.txt", lines);
                console.log("Wrote models to models_list.txt");
            } else {
                console.log("ERROR RESPONSE:", json);
            }
        } catch (e) {
            console.log("RAW HTML/TEXT:", data);
        }
    });
}).on('error', (e) => {
    console.error("Got error: " + e.message);
});
