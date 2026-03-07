
import { createClient } from "@supabase/supabase-js"
import * as dotenv from 'dotenv'

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log("URL Defined:", !!supabaseUrl)
console.log("Service Key Defined:", !!serviceRoleKey)

if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing credentials. Please check .env.local")
    process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
})

async function test() {
    try {
        console.log("Testing connection...")
        const { data, error } = await supabase.from('productos').select('count', { count: 'exact', head: true })

        if (error) {
            console.error("Error connecting:", error)
        } else {
            console.log("Success! Count:", data)

            // Try search
            const { data: searchData, error: searchError } = await supabase
                .from('productos')
                .select('id, nombre')
                .limit(1)

            if (searchError) console.error("Search error:", searchError)
            else console.log("Sample data:", searchData)
        }
    } catch (e) {
        console.error("Exception:", e)
    }
}

test()
