
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log("Checking vendedores...");
    const { data: vends } = await supabase.from('vendedores').select('id, email, nombre').limit(5);
    console.log("Vendedores sample:", vends);

    console.log("Checking usuarios_crm...");
    const { data: crm } = await supabase.from('usuarios_crm').select('id, email, nombre_completo').limit(5);
    console.log("CRM sample:", crm);

    // Check if there is a mapping
    console.log("Checking if auth UUIDs are in vendedores...");
    const { data: matched } = await supabase.from('vendedores').select('id').in('id', crm.map(u => u.id));
    console.log("Matched IDs:", matched);
}

inspect();
