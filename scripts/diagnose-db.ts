
import * as dotenv from 'dotenv'

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
    console.error("Missing credentials")
    process.exit(1)
}

async function diagnose() {
    console.log("Checking database schema via REST API...")
    console.log("URL:", supabaseUrl)

    // 1. Try to list root (shows definitions usually, or just check access)
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/`, {
            method: "GET",
            headers: {
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`
            }
        })
        console.log("Root status:", response.status)
        if (response.ok) {
            const json = await response.json()
            // This might be the OpenAPI spec
            console.log("Definitions found:", Object.keys(json.definitions || {}).join(", "))
        }
    } catch (e) {
        console.error("Error accessing root:", e)
    }

    // 2. Try simple select on 'productos'
    console.log("\nTesting 'productos' table...")
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/productos?select=count&limit=1`, {
            method: "GET",
            headers: {
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
                "Prefer": "count=exact"
            }
        })

        if (response.ok) {
            console.log("Success! 'productos' exists.")
            // Check Content-Range header for count
            console.log("Content-Range:", response.headers.get("Content-Range"))
        } else {
            console.log("Failed to access 'productos'. Status:", response.status, response.statusText)
            const text = await response.text()
            console.log("Error:", text)
        }
    } catch (e) {
        console.error("Error accessing productos:", e)
    }

    // 3. Try to list ALL tables (PostgREST doesn't have a direct 'list tables' endpoint without openapi, 
    // but we can guess common names or try to access 'proveedores' which was hinted)
    console.log("\nTesting 'proveedores' table (hinted by error)...")
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/proveedores?limit=1`, {
            method: "GET",
            headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
        })
        console.log("Proveedores status:", response.status)
    } catch (e) { }
}

diagnose()
