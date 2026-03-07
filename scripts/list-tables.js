
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function listTables() {
    console.log("Listing tables in public schema...");
    const { data, error } = await supabase.rpc('get_tables_info'); // If exists, or just query pg_catalog

    // Fallback: Try to query a common table and see what's around
    // Or just try common names
    const tables = [
        'cuenta_corriente',
        'cuenta_corriente_clientes',
        'cuentas_corrientes',
        'movimientos_clientes',
        'cc_clientes',
        'clientes_seguimiento'
    ];

    for (const table of tables) {
        const { error } = await supabase.from(table).select('id').limit(1);
        console.log(`Table '${table}':`, error ? `ERROR: ${error.message}` : "EXISTS");
    }

    // Try a more direct way to list tables if possible (might fail due to permissions)
    const { data: allTables, error: listError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public');

    if (listError) {
        console.log("Error listing information_schema.tables:", listError.message);
    } else {
        console.log("Tables in public schema:", allTables.map(t => t.table_name));
    }
}

listTables();
