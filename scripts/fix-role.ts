
import { createClient } from "@/lib/supabase/server" // This uses next headers which wont work in script
// Use client directly
import { createClient as createClientJs } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

const envPath = path.resolve(process.cwd(), '.env.local')
const envConfig = dotenv.parse(fs.readFileSync(envPath))

const supabase = createClientJs(envConfig.NEXT_PUBLIC_SUPABASE_URL!, envConfig.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
    console.log("Checking user Mario Silva...")
    const { data: users, error } = await supabase
        .from('usuarios_crm')
        .select('*')
        .or('nombre.ilike.%Mario Silva%,nombre_completo.ilike.%Mario Silva%')

    if (error) {
        console.error("Error fetching user:", error)
        return
    }

    if (!users?.length) {
        console.log("User not found.")
        return
    }

    const user = users[0]
    console.log(`User found: ${user.nombre || user.nombre_completo} (Role: ${user.rol})`)

    if (user.rol !== 'viajante') {
        console.log("Updating role to 'viajante'...")
        const { error: updateError } = await supabase
            .from('usuarios_crm')
            .update({ rol: 'viajante' })
            .eq('id', user.id)

        if (updateError) console.error("Update failed", updateError)
        else console.log("Role updated!")
    } else {
        console.log("Role is correct.")
    }
}

main()
