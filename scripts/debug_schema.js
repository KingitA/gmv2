const { createClient } = require('@supabase/supabase-js');
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

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectSchema() {
    try {
        console.log("Inspecting 'ordenes_compra_items'...");
        const { data, error } = await supabase
            .from('ordenes_compra_detalle')
            .select('*')
            .limit(1);

        if (error) {
            console.error("Error fetching data:", error);
            return;
        }

        if (data && data.length > 0) {
            console.log("Columns found (from sample row):", Object.keys(data[0]));
        } else {
            console.log("Table exists but is empty. Cannot infer columns easily via JS client without metadata API.");
        }
    } catch (e) {
        console.error("Execution error:", e);
    }
}

inspectSchema();
