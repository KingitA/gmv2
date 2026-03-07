"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { nowArgentina } from "@/lib/utils"

export async function getAdminStats() {
  const supabase = await createClient()

  const [
    { count: totalOrders },
    { count: pendingOrders },
    { count: totalClients },
    { count: totalViajantes },
    { data: recentOrders },
  ] = await Promise.all([
    supabase.from("pedidos").select("*", { count: "exact", head: true }),
    supabase.from("pedidos").select("*", { count: "exact", head: true }).eq("status", "pendiente"),
    supabase.from("clientes").select("*", { count: "exact", head: true }),
    supabase.from("viajantes").select("*", { count: "exact", head: true }),
    supabase
      .from("pedidos")
      .select(`
        *,
        clientes(razon_social),
        viajantes(id, profiles!viajantes_id_fkey(full_name))
      `)
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  return {
    totalOrders: totalOrders || 0,
    pendingOrders: pendingOrders || 0,
    totalClients: totalClients || 0,
    totalViajantes: totalViajantes || 0,
    recentOrders: recentOrders || [],
  }
}

export async function getAllOrders(filters?: {
  status?: string
  clienteId?: string
  viajanteId?: string
}) {
  const supabase = await createClient()

  let query = supabase
    .from("pedidos")
    .select(`
      *,
      clientes(razon_social, zona),
      viajantes(id, profiles!viajantes_id_fkey(full_name))
    `)
    .order("created_at", { ascending: false })

  if (filters?.status) {
    query = query.eq("status", filters.status)
  }
  if (filters?.clienteId) {
    query = query.eq("cliente_id", filters.clienteId)
  }
  if (filters?.viajanteId) {
    query = query.eq("viajante_id", filters.viajanteId)
  }

  const { data, error } = await query

  if (error) throw error
  return data
}

export async function updateOrderStatus(pedidoId: string, status: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("pedidos")
    .update({ status, updated_at: nowArgentina() })
    .eq("id", pedidoId)

  if (error) throw error

  revalidatePath("/admin/pedidos")
  return { success: true }
}

export async function getAllViajes() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("viajes")
    .select(`
      *,
      viajantes(id, profiles!viajantes_id_fkey(full_name))
    `)
    .order("fecha_salida", { ascending: false })

  if (error) throw error
  return data
}

export async function createViaje(data: {
  viajante_id: string
  zona: string
  fecha_salida: string
  fecha_retorno: string
  descripcion?: string
}) {
  const supabase = await createClient()

  const { data: viaje, error } = await supabase
    .from("viajes")
    .insert({
      viajante_id: data.viajante_id,
      zona: data.zona,
      fecha_salida: data.fecha_salida,
      fecha_retorno: data.fecha_retorno,
      observaciones: data.descripcion,
    })
    .select()
    .single()

  if (error) throw error

  revalidatePath("/admin/viajes")
  return viaje
}

export async function updateViaje(
  viajeId: string,
  data: {
    zona?: string
    fecha_salida?: string
    fecha_retorno?: string
    observaciones?: string
    completado?: boolean
  },
) {
  const supabase = await createClient()

  const { error } = await supabase.from("viajes").update(data).eq("id", viajeId)

  if (error) throw error

  revalidatePath("/admin/viajes")
  return { success: true }
}

export async function getAllUsers() {
  const supabase = await createClient()

  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false })

  if (error) throw error
  return data
}

export async function updateUserRole(userId: string, role: string) {
  const supabase = await createClient()

  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId)

  if (error) throw error

  revalidatePath("/admin/usuarios")
  return { success: true }
}

export async function getPendingChanges() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("cambios_pendientes")
    .select(`
      *,
      viajantes(id, profiles!viajantes_id_fkey(full_name)),
      clientes(razon_social)
    `)
    .is("aprobado", null)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data
}

export async function approveChange(cambioId: string) {
  const supabase = await createClient()

  // Get the change request
  const { data: cambio, error: fetchError } = await supabase
    .from("cambios_pendientes")
    .select("*")
    .eq("id", cambioId)
    .single()

  if (fetchError) throw fetchError

  // Apply the changes to the client
  const { error: updateError } = await supabase
    .from("clientes")
    .update(cambio.datos_nuevos as any)
    .eq("id", cambio.cliente_id)

  if (updateError) throw updateError

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Mark as approved
  const { error: approveError } = await supabase
    .from("cambios_pendientes")
    .update({
      aprobado: true,
      revisado_por: user?.id,
      fecha_revision: nowArgentina(),
    })
    .eq("id", cambioId)

  if (approveError) throw approveError

  revalidatePath("/admin/cambios")
  return { success: true }
}

export async function rejectChange(cambioId: string) {
  const supabase = await createClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase
    .from("cambios_pendientes")
    .update({
      aprobado: false,
      revisado_por: user?.id,
      fecha_revision: nowArgentina(),
    })
    .eq("id", cambioId)

  if (error) throw error

  revalidatePath("/admin/cambios")
  return { success: true }
}
