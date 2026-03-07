"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerCatalogo, crearPedido, type CrearPedidoRequest } from "@/lib/api/erp-client"
import { redirect } from "next/navigation"

export async function getCatalogoForCliente(clienteId: string) {
  try {
    const catalogo = await obtenerCatalogo(clienteId)
    return { success: true, data: catalogo }
  } catch (error) {
    console.error("[v0] Error fetching catalogo:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

export async function getCatalogoForCurrentCliente() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/auth/login")
  }

  // Get usuario_crm record
  const { data: usuarioCrm } = await supabase.from("usuarios_crm").select("cliente_id").eq("email", user.email).single()

  if (!usuarioCrm?.cliente_id) {
    throw new Error("No se encontró el cliente asociado")
  }

  return getCatalogoForCliente(usuarioCrm.cliente_id)
}

export async function createPedido(data: CrearPedidoRequest) {
  try {
    const result = await crearPedido(data)
    return { success: true, data: result }
  } catch (error) {
    console.error("[v0] Error creating pedido:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error al crear pedido",
    }
  }
}

export async function getVendedorClientes() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/auth/login")
  }

  const { data: usuarioCrm, error: crmError } = await supabase
    .from("usuarios_crm")
    .select("vendedor_id")
    .eq("email", user.email)
    .maybeSingle()

  if (crmError) {
    console.error("[v0] Error fetching usuario_crm:", crmError)
    return { success: false, error: crmError.message, data: [] }
  }

  if (!usuarioCrm?.vendedor_id) {
    return { success: false, error: "No se encontró el vendedor asociado", data: [] }
  }

  // Get clientes assigned to this vendedor
  const { data: clientes, error } = await supabase
    .from("clientes")
    .select("*")
    .eq("vendedor_id", usuarioCrm.vendedor_id)
    .eq("activo", true)
    .order("razon_social")

  if (error) {
    console.error("[v0] Error fetching clientes:", error)
    return { success: false, error: error.message, data: [] }
  }

  return { success: true, data: clientes || [] }
}
