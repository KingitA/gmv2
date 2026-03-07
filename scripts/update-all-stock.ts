import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Manual .env parser
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.join('=').trim().replace(/^["']|["']$/g, '');
        }
    });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
    console.error("Missing credentials. Aborting.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function updateStock() {
    console.log("Setting stock of ALL active articles to 100...");

    // We update in batches or just try a massive update if not too many
    // However, Supabase update without filter updates all rows? Yes.
    // But let's be safe and apply to 'active' ones first or all. The user said ALL.

    try {
        const { error, count } = await supabase
            .from('articulos')
            .update({ stock_actual: 100 })
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy filter to allow update without WHERE if needed, though usually not needed if RLS allows. But this is service role.

        if (error) {
            console.error("Error updating stock:", error);
        } else {
            console.log("Stock updated successfully!");
        }

    } catch (e) {
        console.error("Exception:", e);
    }
}

updateStock();
