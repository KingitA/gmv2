"use server"

import { createClient } from "@/lib/supabase/server"
import { nowArgentina } from "@/lib/utils"

export async function getClienteInfo() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: usuario } = await supabase.from("usuarios").select("*").eq("id", user.id).single()

  if (!usuario || usuario.rol !== "cliente") {
    throw new Error("Usuario no es cliente")
  }

  const { data: cliente } = await supabase.from("clientes").select("*").eq("usuario_id", user.id).single()

  return { usuario, cliente }
}

export async function getClienteStats() {
  const supabase = await createClient()
  const { cliente } = await getClienteInfo()

  // Get order count
  const { count: pedidosCount } = await supabase
    .from("pedidos")
    .select("*", { count: "exact", head: true })
    .eq("cliente_id", cliente.id)

  // Get pending orders
  const { count: pendientesCount } = await supabase
    .from("pedidos")
    .select("*", { count: "exact", head: true })
    .eq("cliente_id", cliente.id)
    .eq("estado", "pendiente")

  // Get account balance
  const { data: cuentaCorriente } = await supabase
    .from("cuenta_corriente")
    .select("saldo")
    .eq("cliente_id", cliente.id)
    .single()

  return {
    totalPedidos: pedidosCount || 0,
    pedidosPendientes: pendientesCount || 0,
    saldo: cuentaCorriente?.saldo || 0,
    creditoDisponible: (cliente.limite_credito || 0) - (cuentaCorriente?.saldo || 0),
  }
}

export async function getClientePedidos() {
  const supabase = await createClient()
  const { cliente } = await getClienteInfo()

  const { data: pedidos, error } = await supabase
    .from("pedidos")
    .select(`
      *,
      viajante:viajante_id(nombre_completo)
    `)
    .eq("cliente_id", cliente.id)
    .order("created_at", { ascending: false })

  if (error) throw error
  return pedidos
}

export async function getClienteCuentaCorriente() {
  const supabase = await createClient()
  const { cliente } = await getClienteInfo()

  const { data: movimientos, error } = await supabase
    .from("movimientos_cuenta")
    .select("*")
    .eq("cliente_id", cliente.id)
    .order("fecha", { ascending: false })

  if (error) throw error
  return movimientos
}

export async function createPedidoCliente(data: {
  cliente_id: string
  items: Array<{
    producto_id: string
    cantidad: number
    precio_unitario: number
    descuento: number
  }>
  observaciones?: string
  zona_entrega?: string
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  // Verify user is a client
  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single()

  if (!usuario || usuario.rol !== "cliente") {
    throw new Error("No autorizado")
  }

  // Generate order number (numeric-only)
  const { getNextOrderNumber } = await import("@/lib/utils/next-order-number")
  const numeroPedido = await getNextOrderNumber(supabase)

  // Calculate totals
  let subtotal = 0
  const itemsWithSubtotal = data.items.map((item) => {
    const itemSubtotal = item.cantidad * item.precio_unitario * (1 - item.descuento / 100)
    subtotal += itemSubtotal
    return {
      ...item,
      subtotal: itemSubtotal,
    }
  })

  // Get client info for IVA calculation
  const { data: cliente } = await supabase.from("clientes").select("*").eq("id", data.cliente_id).single()

  if (!cliente) throw new Error("Cliente no encontrado")

  // Calculate IVA (21% for most cases)
  const iva = cliente.condicion_iva === "responsable_inscripto" ? 0 : subtotal * 0.21

  // Calculate percepciones (3% if applicable)
  const percepciones = cliente.aplica_percepciones ? subtotal * 0.03 : 0

  // Flete (can be calculated based on zone, for now 0)
  const flete = 0

  const total = subtotal + iva + percepciones + flete

  // Create pedido
  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .insert({
      numero_pedido: numeroPedido,
      cliente_id: data.cliente_id,
      viajante_id: cliente.viajante_id,
      estado: "pendiente",
      subtotal,
      descuento: 0,
      flete,
      iva,
      percepciones,
      total,
      zona_entrega: data.zona_entrega || cliente.zona,
      observaciones: data.observaciones,
    })
    .select()
    .single()

  if (pedidoError) throw pedidoError

  // Create pedido items and reserve stock
  for (const item of itemsWithSubtotal) {
    // Insert item
    const { error: itemError } = await supabase.from("pedido_items").insert({
      pedido_id: pedido.id,
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      descuento: item.descuento,
      subtotal: item.subtotal,
    })

    if (itemError) throw itemError

    // Reserve stock
    const { data: producto } = await supabase
      .from("productos")
      .select("stock_actual, stock_reservado")
      .eq("id", item.producto_id)
      .single()

    if (producto) {
      await supabase
        .from("productos")
        .update({
          stock_reservado: producto.stock_reservado + item.cantidad,
        })
        .eq("id", item.producto_id)
    }
  }

  // Create cuenta corriente entry
  const { data: cuentaActual } = await supabase
    .from("cuenta_corriente")
    .select("saldo")
    .eq("cliente_id", data.cliente_id)
    .single()

  const nuevoSaldo = (cuentaActual?.saldo || 0) + total

  await supabase.from("movimientos_cuenta").insert({
    cliente_id: data.cliente_id,
    pedido_id: pedido.id,
    tipo: "debe",
    concepto: `Pedido #${numeroPedido}`,
    importe: total,
    saldo_resultante: nuevoSaldo,
    fecha: nowArgentina(),
  })

  // Update cuenta corriente
  await supabase.from("cuenta_corriente").update({ saldo: nuevoSaldo }).eq("cliente_id", data.cliente_id)

  return pedido
}
