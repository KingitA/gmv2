
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables manually since we are not using 'dotenv' via cli
const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkData() {
    console.log('Checking for Mario Silva...');
    const { data: viajeros, error: userError } = await supabase
        .from('usuarios_crm')
        .select('*')
        .ilike('nombre', '%Mario Silva%');

    if (userError) console.error('Error checking users:', userError);
    else console.log('Mario Silva found:', viajeros.length > 0 ? viajeros[0].nombre : 'No found');

    console.log('\nChecking for Cardozo Jorge...');
    const { data: clientes, error: clientError } = await supabase
        .from('clientes')
        .select('*')
        .ilike('razon_social', '%Cardozo Jorge%');

    if (clientError) console.error('Error checking clients:', clientError);
    else console.log('Cardozo Jorge found:', clientes.length > 0 ? clientes[0].razon_social : 'No found');

    if (viajeros && viajeros.length > 0 && clientes && clientes.length > 0) {
        const viajante = viajeros[0];
        const cliente = clientes[0];
        // Check if they are linked. Assuming 'vendedor_id' on client is the link?
        // Need to check what ID is used. 'usuarios_crm' usually has 'vendedor_id' (reference to 'vendedores' table?)
        // or maybe 'clientes.vendedor_id' refers to 'usuarios_crm.id' or 'vendedores.id'.

        console.log(`\nClient Vendedor ID: ${cliente.vendedor_id}`);

        // If Mario has a linked 'vendedor_id' in a separate table, check that
        if (viajante.vendedor_id) {
            console.log(`Mario Silva Vendedor ID (in profile): ${viajante.vendedor_id}`);
            if (String(cliente.vendedor_id) === String(viajante.vendedor_id)) {
                console.log('SUCCESS: Client is assigned to Mario Silva.');
            } else {
                console.log('WARNING: IDs do not match directly.');
            }
        } else {
            // Maybe linked by ID directly
            console.log(`Mario Silva User ID: ${viajante.id}`);
            if (String(cliente.vendedor_id) === String(viajante.id)) {
                console.log('SUCCESS: Client is assigned to Mario Silva (by User ID).');
            }
        }
    }
}

checkData();
