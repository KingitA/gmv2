'use server'

import { createClient } from '@/lib/supabase/server'

export async function getUserWithRoles(userId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('usuarios')
    .select(`
      *,
      usuarios_roles(
        roles(nombre)
      )
    `)
    .eq('id', userId)
    .single()
  
  if (error) throw error
  
  return {
    ...data,
    roles: data.usuarios_roles?.map((ur: any) => ur.roles.nombre) || []
  }
}

export async function getVendedorInfo(userId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('vendedores_info')
    .select('*')
    .eq('usuario_id', userId)
    .single()
  
  if (error) {
    console.error('[v0] Error getting vendedor info:', error)
    return null
  }
  
  return data
}

export async function getUserCRMWithVendedorInfo(email: string) {
  const supabase = await createClient()
  
  const { data: usuarioCRM, error: crmError } = await supabase
    .from('usuarios_crm')
    .select('*')
    .eq('email', email)
    .single()
  
  if (crmError || !usuarioCRM) {
    throw new Error('Usuario CRM no encontrado')
  }
  
  if (usuarioCRM.vendedor_id) {
    const vendedorInfo = await getVendedorInfo(usuarioCRM.vendedor_id)
    return {
      ...usuarioCRM,
      vendedor_info: vendedorInfo
    }
  }
  
  return usuarioCRM
}
