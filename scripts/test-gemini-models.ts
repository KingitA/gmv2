import { GoogleGenerativeAI } from "@google/generative-ai"
import fs from "fs"
import path from "path"

// Manually parse .env.local to avoid dotenv dependency issues
const envPath = path.resolve(process.cwd(), ".env.local")
let apiKey = ""

try {
    const envContent = fs.readFileSync(envPath, "utf-8")
    const lines = envContent.split("\n")
    for (const line of lines) {
        if (line.startsWith("GEMINI_API_KEY=")) {
            apiKey = line.split("=")[1].trim()
            break
        } else if (line.startsWith("GOOGLE_API_KEY=")) {
            apiKey = line.split("=")[1].trim()
            break
        }
    }
} catch (e) {
    console.log("Could not read .env.local")
    apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ""
}

if (!apiKey) {
    console.error("No API Key found. Please set GEMINI_API_KEY in .env.local")
    process.exit(1)
}

const genAI = new GoogleGenerativeAI(apiKey)

async function listModels() {
    console.log("Using API key:", apiKey.slice(0, 5) + "..." + apiKey.slice(-4))

    // 1. Try generic generation with a standard model to verify key
    const modelsToProbe = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash-001",
        "gemini-1.5-pro",
        "gemini-1.5-pro-latest",
        "gemini-1.0-pro",
        "gemini-pro",
        "gemini-pro-vision"
    ]

    console.log("\n--- Testing Generation capability ---")
    for (const modelName of modelsToProbe) {
        try {
            process.stdout.write(`Testing ${modelName}: `)
            const model = genAI.getGenerativeModel({ model: modelName })
            // Simple prompt
            const result = await model.generateContent("Say 'OK'")
            const response = await result.response
            console.log(`✅ Success! Response: ${response.text().trim()}`)
        } catch (e: any) {
            let msg = e.message || ""
            if (msg.includes("404")) msg = "404 Not Found"
            console.log(`❌ Failed (${msg})`)
        }
    }
}

listModels()
