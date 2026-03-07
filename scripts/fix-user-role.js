
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY);

async function checkAndFixUser() {
    console.log('Searching for Mario Silva...');
    // Check both name fields
    const { data: users, error } = await supabase
        .from('usuarios_crm')
        .select('*')
        .or('nombre.ilike.%Mario Silva%,nombre_completo.ilike.%Mario Silva%');

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (!users || users.length === 0) {
        console.log('User not found!');
    } else {
        users.forEach(async (u) => {
            console.log(`User Found: ${u.nombre || u.nombre_completo} | Role: ${u.rol} | ID: ${u.id}`);

            if (u.rol !== 'viajante') {
                console.log(`Updating role from '${u.rol}' to 'viajante'...`);
                const { error: updateError } = await supabase
                    .from('usuarios_crm')
                    .update({ rol: 'viajante' })
                    .eq('id', u.id);

                if (updateError) console.error('Update failed:', updateError);
                else console.log('Role updated successfully.');
            } else {
                console.log('Role is already correct.');
            }
        });
    }
}

checkAndFixUser();
