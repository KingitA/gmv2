
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

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
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            envConfig[key] = value;
        }
    });
}

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing credentials.');
    process.exit(1);
}

// Client for Auth (Simulating Frontend/Server Action)
const supabase = createClient(supabaseUrl, supabaseAnonKey);
// Admin Client for inspection
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function debugLogin() {
    const nombre = "Mario Silva";
    const password = "123456";

    console.log(`--- DEBUGGING LOGIN FOR: ${nombre} ---`);

    // 1. Find User
    const { data: usuario, error: userError } = await supabaseAdmin
        .from("usuarios_crm")
        .select("id, email, rol, nombre")
        .ilike("nombre", nombre)
        .single();

    if (userError || !usuario) {
        console.error("❌ User lookup failed:", userError);
        return;
    }

    console.log(`✅ User Identity Found: ${usuario.email} | Role: ${usuario.rol}`);

    // 2. Check Auth Status (Admin)
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = users.find(u => u.email === usuario.email);

    if (!authUser) {
        console.error("❌ Auth User NOT found in Supabase Auth!");
        return;
    } else {
        console.log(`✅ Auth User Exists. Confirmed: ${authUser.email_confirmed_at ? 'YES' : 'NO'}`);
        console.log(`   Auth ID: ${authUser.id}`);

        // FORCE RESET PASSWORD HERE
        console.log("🔄 FORCE RESETTING PASSWORD TO '123456'...");
        const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(
            authUser.id,
            { password: '123456' }
        );
        if (resetError) console.error("   ❌ Reset Error:", resetError);
        else console.log("   ✅ Password Reset Success.");

        if (!authUser.email_confirmed_at) {
            console.log("⚠️ WARNING: Email not confirmed. This might block login.");
            console.log("   -> Auto-confirming now...");
            await supabaseAdmin.auth.admin.updateUserById(authUser.id, { email_confirm: true });
            console.log("   -> Confirmed.");
        }
    }

    // 3. Attempt Login
    console.log(`Testing Login with password '${password}'...`);
    const { data, error } = await supabase.auth.signInWithPassword({
        email: usuario.email,
        password: password
    });

    if (error) {
        console.error("❌ LOGIN FAILED:", error.message);
        console.error("   Full Error:", JSON.stringify(error, null, 2));
    } else {
        console.log("✅ LOGIN SUCCESSFUL!");
        console.log("   Session User:", data.user.email);
    }
}

debugLogin();
