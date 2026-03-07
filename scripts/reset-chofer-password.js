/**
 * Script para resetear la contraseña del usuario chofer
 * Ejecutar con: node scripts/reset-chofer-password.js
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

async function resetPassword() {
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
    const newPassword = '123456'

    console.log('🔄 Buscando usuario...')
    console.log(`📧 Email: ${email}`)

    try {
        // Obtener el usuario por email
        const { data: users } = await supabase.auth.admin.listUsers()
        const user = users?.users.find(u => u.email?.toLowerCase() === email.toLowerCase())

        if (!user) {
            console.error('❌ Usuario no encontrado')
            process.exit(1)
        }

        console.log(`✅ Usuario encontrado: ${user.id}`)
        console.log('🔐 Actualizando contraseña...')

        // Actualizar la contraseña
        const { error } = await supabase.auth.admin.updateUserById(
            user.id,
            { password: newPassword }
        )

        if (error) {
            throw error
        }

        console.log('✅ Contraseña actualizada exitosamente')
        console.log('\n📝 Credenciales actualizadas:')
        console.log(`   Email: ${email}`)
        console.log(`   Contraseña: ${newPassword}`)
        console.log('\n✨ Ahora puedes iniciar sesión en /choferes/login')

    } catch (error) {
        console.error('❌ Error:', error.message)
        process.exit(1)
    }
}

resetPassword()
