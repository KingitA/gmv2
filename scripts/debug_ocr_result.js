
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Manually read .env.local
const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
        envVars[key.trim()] = value.trim();
    }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLatestReception() {
    const { data: recepciones } = await supabase
        .from('recepciones')
        .select('*, orden_compra:ordenes_compra(numero_orden)')
        .order('created_at', { ascending: false })
        .limit(1);

    if (!recepciones || recepciones.length === 0) return;
    const reception = recepciones[0];
    console.log(`Latest Reception ID: ${reception.id}`);

    const { data: docs } = await supabase
        .from('recepciones_documentos')
        .select('*')
        .eq('recepcion_id', reception.id);

    console.log('\n--- Documents Full JSON ---');
    docs?.forEach(d => {
        console.log(`ID: ${d.id}`);
        console.log(`JSON: ${JSON.stringify(d.datos_ocr, null, 2)}`);
    });
}

checkLatestReception();
