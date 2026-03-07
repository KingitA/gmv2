/**
 * Script para crear usuario de chofer en Supabase
 * Ejecutar con: node scripts/create-chofer-user.js
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

async function createChoferUser() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('❌ Faltan las variables de entorno de Supabase')
        process.exit(1)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })

    const email = 'Juancruzrossi072@gmail.com'
    const password = '123456'

    console.log('🚀 Creando usuario de chofer...')
    console.log(`📧 Email: ${email}`)

    try {
        // Crear usuario en Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true, // Auto-confirmar el email
            user_metadata: {
                role: 'chofer',
                name: 'Juan Cruz Rossi'
            }
        })

        if (authError) {
            if (authError.message.includes('already registered')) {
                console.log('⚠️  El usuario ya existe en Supabase Auth')

                // Intentar obtener el usuario existente
                const { data: users } = await supabase.auth.admin.listUsers()
                const existingUser = users?.users.find(u => u.email === email)

                if (existingUser) {
                    console.log(`✅ Usuario encontrado: ${existingUser.id}`)
                    console.log('\n📝 Credenciales:')
                    console.log(`   Email: ${email}`)
                    console.log(`   Contraseña: ${password}`)
                    return
                }
            }
            throw authError
        }

        console.log('✅ Usuario creado exitosamente')
        console.log(`   ID: ${authData.user.id}`)
        console.log(`   Email: ${authData.user.email}`)
        console.log('\n📝 Credenciales:')
        console.log(`   Email: ${email}`)
        console.log(`   Contraseña: ${password}`)
        console.log('\n✨ Ahora puedes iniciar sesión en /choferes/login')

    } catch (error) {
        console.error('❌ Error:', error.message)
        process.exit(1)
    }
}

createChoferUser()
