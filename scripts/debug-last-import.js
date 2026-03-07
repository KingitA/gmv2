
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function debug() {
    console.log("Fetching last import...");
    const { data: imports, error } = await supabase
        .from('imports')
        .select('*, import_items(*)')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error("Error fetching imports:", error);
        return;
    }

    if (!imports || imports.length === 0) {
        console.log("No imports found.");
        return;
    }

    const imp = imports[0];
    console.log("Import ID:", imp.id);
    console.log("Source:", imp.meta.source);
    console.log("Sender:", imp.meta.sender);
    console.log("Metadata:", JSON.stringify(imp.meta, null, 2));
    console.log("Items Count:", imp.import_items.length);
    console.log("Items:", JSON.stringify(imp.import_items, null, 2));
}

debug();
