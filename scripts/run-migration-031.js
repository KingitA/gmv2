const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Error: Missing environment variables.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, '031-stock-reservado-y-compras.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration 031-stock-reservado-y-compras.sql...');
        console.log('Note: This script should be run directly in Supabase SQL Editor or via psql.');
        console.log('\nSQL Content:');
        console.log('='.repeat(80));
        console.log(sql);
        console.log('='.repeat(80));
        console.log('\nPlease execute this SQL in your Supabase dashboard SQL Editor.');
        console.log('Path: Supabase Dashboard > SQL Editor > New Query > Paste and Run');

    } catch (error) {
        console.error('Error reading migration file:', error);
        process.exit(1);
    }
}

runMigration();
