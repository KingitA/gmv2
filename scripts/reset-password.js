
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Manually parse .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = {};

if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            envConfig[key] = value;
        }
    });
}

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing credentials. Ensure .env.local exists.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function resetPassword() {
    console.log("Searching for Mario Silva...");

    const { data: users, error } = await supabase
        .from('usuarios_crm')
        .select('*')
        .ilike('nombre', '%Mario Silva%');

    if (error) {
        console.error("Error searching user:", error);
        return;
    }

    if (!users || users.length === 0) {
        console.log("User 'Mario Silva' not found.");
        return;
    }

    const userCrm = users[0];
    console.log(`Found: ${userCrm.nombre || userCrm.nombre_completo} (${userCrm.email})`);

    console.log(`Resetting password to '1234'...`);

    let authUser = null;

    // 1. Try to fetch auth user by email
    const { data: { users: authUsers }, error: searchError } = await supabase.auth.admin.listUsers();
    const existingAuthUser = authUsers.find(u => u.email === userCrm.email);

    let newUserId = null;

    if (existingAuthUser) {
        console.log(`Auth user found by email! ID: ${existingAuthUser.id}`);
        newUserId = existingAuthUser.id;
        // Reset password
        await supabase.auth.admin.updateUserById(newUserId, { password: '1234' });
        console.log("Password updated.");
    } else {
        console.log("Auth user not found. Creating new user...");
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email: userCrm.email,
            password: '1234',
            email_confirm: true,
            user_metadata: { nombre: userCrm.nombre }
        });

        if (createError) {
            console.error("Error creating user:", createError);
            return;
        }
        newUserId = newUser.user.id;
        console.log(`User created! New ID: ${newUserId}`);
    }

    // 2. Update CRM User ID if different
    if (newUserId && newUserId !== userCrm.id) {
        console.log(`Updating usuarios_crm ID from ${userCrm.id} to ${newUserId}...`);
        const { error: linkError } = await supabase
            .from('usuarios_crm')
            .update({ id: newUserId })
            .eq('email', userCrm.email); // Match by email to update the row

        if (linkError) {
            console.error("Error linking user:", linkError);
        } else {
            console.log("Linkage repaired successfully!");
        }
    } else {
        console.log("IDs match. No linkage update needed.");
    }
}

resetPassword();
