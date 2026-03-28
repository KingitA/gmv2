"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { searchClientesByVector } from "@/lib/actions/embeddings"

export async function getViajanteClientes() {
  const supabase = await createClient()

  // Get current user and roles
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // If not authenticated, return empty or implement specific logic
    // For now, let's require auth for this action as it implies "Viajante" context
    throw new Error("No autenticado")
  }

  const { data: userRoles } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRoles?.map((ur: any) => ur.roles?.nombre) || []

  if (!roles.includes("viajante") && !roles.includes("vendedor") && !roles.includes("admin")) {
    throw new Error("No autorizado")
  }

  const query = supabase.from("clientes").select("*").eq("activo", true).order("razon_social")

  if (roles.includes("viajante") || roles.includes("vendedor")) {
    // If user is admin, they see all. If via/vend, they see only theirs?
    // Usually admins see all. 
    // If user has both admin and vendor, let's assume admin privileges override restriction?
    // Or maybe "My Clients" page implies strictly "mine". 
    // Let's stick to: if NOT admin, apply filter.
    if (!roles.includes("admin")) {
      query.eq("vendedor_id", user.id)
    }
  }

  const { data, error } = await query

  if (error) throw error
  return data
}

export async function searchClientes(searchTerm: string) {
  const supabase = await createClient()

  // Get current user and roles
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: userRoles } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRoles?.map((ur: any) => ur.roles?.nombre) || []

  if (!roles.includes("viajante") && !roles.includes("vendedor") && !roles.includes("admin")) {
    throw new Error("No autorizado")
  }

  const isRestricted = (roles.includes("viajante") || roles.includes("vendedor")) && !roles.includes("admin")

  let textQuery = supabase.from("clientes").select("*").eq("activo", true)
  if (isRestricted) textQuery = textQuery.eq("vendedor_id", user.id)

  textQuery = textQuery.or(
    `nombre_razon_social.ilike.%${searchTerm}%,` +
    `nombre.ilike.%${searchTerm}%,` +
    `razon_social.ilike.%${searchTerm}%,` +
    `direccion.ilike.%${searchTerm}%,` +
    `localidad.ilike.%${searchTerm}%,` +
    `codigo_cliente.ilike.%${searchTerm}%,` +
    `cuit.ilike.%${searchTerm}%`
  )

  const [{ data: textResults, error }, vectorResultsRaw] = await Promise.all([
    textQuery.order("nombre_razon_social").limit(30),
    searchClientesByVector(searchTerm, 0.35, 30),
  ])

  if (error) throw error

  // For restricted users, post-filter vector results by vendedor_id
  const vectorResults = isRestricted
    ? vectorResultsRaw.filter((r: any) => r.vendedor_id === user.id)
    : vectorResultsRaw

  const textIds = new Set((textResults || []).map((r: any) => r.id))
  const merged = [
    ...(textResults || []),
    ...vectorResults.filter((r: any) => !textIds.has(r.id)),
  ].slice(0, 30)

  return merged
}

export async function createCliente(formData: {
  razon_social: string
  cuit?: string
  direccion: string
  zona: string
  telefono?: string
  email?: string
  dias_credito?: number
  limite_credito?: number
  descuento_especial?: number
  condicion_iva?: string
  aplica_percepciones?: boolean
  observaciones?: string
}) {
  const supabase = await createClient()

  // Get current user and roles
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: userRoles } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRoles?.map((ur: any) => ur.roles?.nombre) || []

  if (!roles.includes("viajante") && !roles.includes("vendedor") && !roles.includes("admin")) {
    throw new Error("No autorizado")
  }

  const { data, error } = await supabase
    .from("clientes")
    .insert({
      ...formData,
      nombre: formData.razon_social,
      nombre_razon_social: formData.razon_social,
      vendedor_id: (roles.includes("viajante") || roles.includes("vendedor")) ? user.id : null,
    })
    .select()
    .single()

  if (error) throw error

  // Auto-vectorizar en background (no bloqueante)
  void updateClienteEmbedding(data.id)

  revalidatePath("/viajante/clientes")
  return data
}

export async function updateCliente(
  clienteId: string,
  updates: Partial<{
    razon_social: string
    cuit: string
    direccion: string
    zona: string
    telefono: string
    email: string
    dias_credito: number
    limite_credito: number
    descuento_especial: number
    condicion_iva: string
    aplica_percepciones: boolean
    observaciones: string
  }>,
) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  // Create a pending change request instead of direct update
  const { data: cliente } = await supabase.from("clientes").select("*").eq("id", clienteId).single()

  if (!cliente) throw new Error("Cliente no encontrado")

  const { error } = await supabase.from("cambios_pendientes").insert({
    viajante_id: user.id,
    cliente_id: clienteId,
    tipo_cambio: "datos_cliente",
    datos_anteriores: cliente,
    datos_nuevos: { ...cliente, ...updates },
  })

  if (error) throw error

  revalidatePath("/viajante/clientes")
  return { success: true, message: "Cambio enviado para aprobación" }
}

export async function getClienteById(clienteId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: userRoles } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRoles?.map((ur: any) => ur.roles?.nombre) || []

  if (!roles.includes("viajante") && !roles.includes("vendedor") && !roles.includes("admin") && !roles.includes("cliente")) {
    throw new Error("No autorizado")
  }

  const { data, error } = await supabase.from("clientes").select("*").eq("id", clienteId).single()

  if (error) throw error
  if (!data) throw new Error("Cliente no encontrado")

  // Verify authorization
  // Note: 'viajante' and 'vendedor' seem to be used interchangeably in code but we should respect role names 
  if ((roles.includes("vendedor") || roles.includes("viajante")) && !roles.includes("admin")) {
    if (data.vendedor_id !== user.id) {
      // Check if shared? For now strict check
      throw new Error("No autorizado para ver este cliente")
    }
  } else if (roles.includes("cliente")) {
    // If user is client, they can only see themselves (or related data?)
    // The 'cliente' role implies the user IS the client account usually, or linked to it.
    // In unified schema, clients are users. So ID should match.
    if (data.id !== user.id) {
      throw new Error("No autorizado para ver este cliente")
    }
  }

  return data
}
