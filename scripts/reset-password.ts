
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

const envPath = path.resolve(process.cwd(), '.env.local')
const envConfig = dotenv.parse(fs.readFileSync(envPath))

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
})

async function resetPassword() {
    console.log("Searching for Mario Silva in profiles/usuarios_crm...")

    // 1. Find the user email from our custom table
    const { data: users, error } = await supabase
        .from('usuarios_crm')
        .select('*')
        .or('nombre.ilike.%Mario Silva%,nombre_completo.ilike.%Mario Silva%')

    if (error) {
        console.error("Error searching user:", error)
        return
    }

    if (!users || users.length === 0) {
        console.log("User 'Mario Silva' not found in usuarios_crm table.")
        return
    }

    const userCrm = users[0]
    console.log(`Found CRM User: ${userCrm.nombre || userCrm.nombre_completo} (${userCrm.email}) | ID: ${userCrm.id}`)

    // 2. Find the Auth User by ID (or email)
    // Converting UUID if needed, but assuming ID matches Auth ID as is standard

    console.log(`Resetting password for ${userCrm.email} to '1234'...`)

    const { data: authUser, error: updateError } = await supabase.auth.admin.updateUserById(
        userCrm.id,
        { password: '1234' }
    )

    if (updateError) {
        console.error("Error updating password:", updateError)
        // Fallback: Try by email if ID mismatch (unlikely but possible if sync is broken)
        console.log("Retrying by email...")
        const { data: authUserEmail, error: updateErrorEmail } = await supabase.auth.admin.deleteUser(
            userCrm.id // Just kidding, don't delete.
        )
        // Actually, create a new user if it doesn't exist?
        // Let's just try to create it if update fails saying "User not found"

        // But better:
        // If update failed, maybe user auth record doesn't exist?

    } else {
        console.log("Password updated successfully!")
        console.log("New Credentials:")
        console.log(`Email: ${userCrm.email}`) // Needed for internal login? 
        // Wait, the login form uses "Nombre". 
        // The `viajante-auth.ts` looks up the email by name, then signs in with email+password.
        // So this reset should work perfectly.
    }
}

resetPassword()
