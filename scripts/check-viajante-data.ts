
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkData() {
    console.log('Checking for Mario Silva...');
    // Check Authorization/User table (mocking checking 'usuarios_crm' or 'profiles')
    const { data: viajeros, error: userError } = await supabase
        .from('usuarios_crm')
        .select('*')
        .ilike('nombre', '%Mario Silva%');

    if (userError) console.error('Error checking users:', userError);
    else console.log('Mario Silva found:', viajeros);

    console.log('\nChecking for Cardozo Jorge...');
    const { data: clientes, error: clientError } = await supabase
        .from('clientes')
        .select('*')
        .ilike('razon_social', '%Cardozo Jorge%');

    if (clientError) console.error('Error checking clients:', clientError);
    else console.log('Cardozo Jorge found:', clientes);

    // Check relationship if both exist
    if (viajeros?.length && clientes?.length) {
        const viajante = viajeros[0];
        const cliente = clientes[0];
        console.log(`\nChecking relation: Client ${cliente.id} -> Viajante ${viajante.id}`);
        // Assuming relation is on client.vendedor_id or similar
        console.log('Client Vendedor ID:', cliente.vendedor_id);
        console.log('Viajante ID:', viajante.vendedor_id || viajante.id);
    }
}

checkData();
