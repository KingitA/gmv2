
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function debug() {
    console.log("Fetching last 5 imports...");
    const { data: imports, error } = await supabase
        .from('imports')
        .select('*, import_items(*)')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error("Error fetching imports:", error);
        return;
    }

    imports.forEach((imp, i) => {
        console.log(`--- Import ${i + 1} ---`);
        console.log("ID:", imp.id);
        console.log("Created At:", imp.created_at);
        console.log("Metadata:", JSON.stringify(imp.meta, null, 2));
        console.log("Items Count:", imp.import_items.length);
    });
}

debug();
