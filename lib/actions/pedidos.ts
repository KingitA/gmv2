"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { getNextOrderNumber } from "@/lib/utils/next-order-number"
import { nowArgentina } from "@/lib/utils"

export async function createPedido(data: {
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

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error("No autenticado")

  // Simple check: user must be logged in. No strict role gates as per user request.
  // We'll use the client's assigned salesperson.

  // Permissions handled above. Anyone authenticated can create.

  // Generate order number (numeric-only)
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
  const { data: clienteInfo } = await supabase.from("clientes").select("*").eq("id", data.cliente_id).single()

  if (!clienteInfo) throw new Error("Cliente no encontrado")

  // Calculate IVA (21% for most cases)
  const iva = clienteInfo.condicion_iva === "responsable_inscripto" ? 0 : subtotal * 0.21

  // Calculate percepciones (3% if applicable)
  const percepciones = clienteInfo.aplica_percepciones ? subtotal * 0.03 : 0

  // Flete (can be calculated based on zone, for now 0)
  const flete = 0

  const total = subtotal + iva + percepciones + flete

  // Create pedido
  console.log("Inserting into 'pedidos'...", {
    numero_pedido: numeroPedido,
    cliente_id: data.cliente_id,
    vendedor_id: clienteInfo.vendedor_id,
  })

  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .insert({
      numero_pedido: numeroPedido,
      cliente_id: data.cliente_id,
      vendedor_id: clienteInfo.vendedor_id, // Assigned vendor from client
      fecha: nowArgentina(),
      estado: "pendiente",
      subtotal,
      descuento_general: 0,
      total_flete: flete,
      total_impuestos: iva + percepciones,
      total: total,
      observaciones: data.observaciones,
    })
    .select()
    .single()

  if (pedidoError) {
    console.error("Error inserting into 'pedidos' (possible FK mismatch):", pedidoError)
    throw pedidoError
  }
  console.log("Pedido created successfully:", pedido.id)

  // Create pedido items
  for (const item of itemsWithSubtotal) {
    const precioFinal = item.precio_unitario * (1 - item.descuento / 100)

    // Fetch prices from articulos to avoid 23502 (NOT NULL constraints)
    const { data: articulo } = await supabase
      .from("articulos")
      .select("precio_compra, ultimo_costo")
      .eq("id", item.producto_id)
      .single()

    console.log(`Inserting item into 'pedidos_detalle' for product ${item.producto_id}...`)

    const { error: itemError } = await supabase.from("pedidos_detalle").insert({
      pedido_id: pedido.id,
      articulo_id: item.producto_id,
      cantidad: item.cantidad,
      precio_base: articulo?.precio_compra || item.precio_unitario || 0, // Mandatory
      precio_final: precioFinal,
      subtotal: item.subtotal,
      precio_costo: articulo?.ultimo_costo || articulo?.precio_compra || 0 // Mandatory
    })

    if (itemError) {
      console.error("Error inserting into 'pedidos_detalle':", itemError)
      throw itemError
    }
  }
  console.log("All items inserted successfully")

  // Create account movement and update balance
  console.log("Updating account movements...")
  try {
    // 1. Get current balance
    const { data: ctaActual } = await supabase
      .from("cuenta_corriente")
      .select("saldo")
      .eq("cliente_id", data.cliente_id)
      .maybeSingle()

    const nuevoSaldo = (ctaActual?.saldo || 0) + total

    // 2. Insert into movimientos_cuenta (Ledger)
    await supabase.from("movimientos_cuenta").insert({
      cliente_id: data.cliente_id,
      tipo: "debe",
      concepto: `Pedido #${numeroPedido}`,
      importe: total,
      saldo_resultante: nuevoSaldo,
      fecha: nowArgentina(),
      referencia: `PEDIDO-${pedido.id}`
    })

    // 3. Update summary balance
    if (ctaActual) {
      await supabase.from("cuenta_corriente").update({ saldo: nuevoSaldo }).eq("cliente_id", data.cliente_id)
    } else {
      await supabase.from("cuenta_corriente").insert({ cliente_id: data.cliente_id, saldo: nuevoSaldo })
    }
    console.log("Account balance updated successfully")
  } catch (ctaError) {
    console.error("Non-critical error updating account balance:", ctaError)
  }

  // Commission
  console.log("Calculating commission...")
  try {
    const { data: article } = await supabase.from("articulos").select("proveedor_id").eq("id", itemsWithSubtotal[0].producto_id).single()

    if (article && article.proveedor_id && clienteInfo.vendedor_id) {
      const { data: proveedor } = await supabase
        .from("proveedores")
        .select("comision_viajante")
        .eq("id", article.proveedor_id)
        .single()

      if (proveedor) {
        console.log("Inserting into 'comisiones'...")
        const { error: commError } = await supabase.from("comisiones").insert({
          viajante_id: clienteInfo.vendedor_id,
          pedido_id: pedido.id,
          monto: total * (proveedor.comision_viajante / 100),
          porcentaje: proveedor.comision_viajante,
          pagado: false,
        })
        if (commError) console.error("Error inserting into 'comisiones':", commError)
      }
    }
  } catch (commErr) {
    console.warn("Commission creation failed, but order is safe:", commErr)
  }

  revalidatePath("/clientes-pedidos")
  return pedido
}

export async function getPedidoById(pedidoId: string) {
  const supabase = createAdminClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: userRolesData } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRolesData?.map((ur: any) => ur.roles?.nombre) || []

  const { data, error } = await supabase
    .from("pedidos")
    .select(`
      *,
      clientes:cliente_id (
        razon_social,
        direccion,
        zona,
        telefono,
        vendedor_id
      ),
      pedidos_detalle (
        *,
        articulos:articulo_id (
          descripcion,
          sku,
          proveedores:proveedor_id (
            nombre
          )
        )
      )
    `)
    .eq("id", pedidoId)
    .single()

  if (error) throw error
  if (!data) throw new Error("Pedido no encontrado")

  // Verify authorization
  const cliente = data.clientes as any

  if (roles.includes("admin")) {
    // Admin can see everything
  } else if (roles.includes("vendedor")) {
    if (cliente.vendedor_id !== user.id) {
      throw new Error("No autorizado para ver este pedido")
    }
  } else if (roles.includes("cliente")) {
    if (data.cliente_id !== user.id) {
      throw new Error("No autorizado para ver este pedido")
    }
  } else {
    throw new Error("No autorizado")
  }

  return data
}

export async function updatePedidoStatus(pedidoId: string, status: string) {
  const supabase = createAdminClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: userRolesData } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRolesData?.map((ur: any) => ur.roles?.nombre) || []

  if (!roles.includes("vendedor") && !roles.includes("admin")) {
    throw new Error("No autorizado")
  }

  const { data, error } = await supabase.from("pedidos").select("cliente_id").eq("id", pedidoId).single()

  if (error) throw error
  if (!data) throw new Error("Pedido no encontrado")

  const { data: cliente } = await supabase.from("clientes").select("vendedor_id").eq("id", data.cliente_id).single()

  if (!cliente) throw new Error("Cliente no encontrado")

  if (roles.includes("vendedor") && !roles.includes("admin")) {
    if (cliente.vendedor_id !== user.id) {
      throw new Error("No autorizado para actualizar este pedido")
    }
  }

  const { error: updateError } = await supabase.from("pedidos").update({ status }).eq("id", pedidoId)

  if (updateError) throw updateError

  revalidatePath("/viajante/pedidos")
  return { success: true }
}

export async function softDeletePedido(pedidoId: string) {
  const supabase = await createClient()

  // Verify the order exists and is in 'pendiente' state
  const { data: pedido, error: fetchError } = await supabase
    .from("pedidos")
    .select("id, estado, numero_pedido")
    .eq("id", pedidoId)
    .single()

  if (fetchError || !pedido) {
    throw new Error("Pedido no encontrado")
  }

  if (pedido.estado !== "pendiente") {
    throw new Error("Solo se pueden eliminar pedidos en estado 'pendiente'")
  }

  // Soft-delete: change state and record timestamp
  const { error: updateError } = await supabase
    .from("pedidos")
    .update({
      estado: "eliminado",
      eliminado_at: new Date().toISOString(),
    })
    .eq("id", pedidoId)

  if (updateError) {
    console.error("Error soft-deleting pedido:", updateError)
    throw new Error("Error al eliminar el pedido")
  }

  revalidatePath("/clientes-pedidos")
  return { success: true, numero_pedido: pedido.numero_pedido }
}

// ─── Edición de pedidos pendientes ─────────────────────────────────────────

async function assertPedidoEditable(supabase: any, pedidoId: string) {
  const { data, error } = await supabase
    .from("pedidos")
    .select("id, estado")
    .eq("id", pedidoId)
    .single()
  if (error || !data) throw new Error("Pedido no encontrado")
  if (data.estado === "eliminado") throw new Error("El pedido está eliminado y no puede modificarse")
  if (data.estado !== "pendiente") throw new Error("Solo se pueden editar pedidos en estado 'pendiente'")
  return data
}

export async function agregarItemPedido(
  pedidoId: string,
  productoId: string,
  cantidad: number
) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { data: articulo, error: artError } = await supabase
    .from("articulos")
    .select("precio_compra, ultimo_costo, precio_venta")
    .eq("id", productoId)
    .single()

  if (artError || !articulo) throw new Error("Artículo no encontrado")

  const precioBase = articulo.precio_compra || 0
  const precioFinal = articulo.precio_venta || precioBase

  const { error } = await supabase.from("pedidos_detalle").insert({
    pedido_id: pedidoId,
    articulo_id: productoId,
    cantidad,
    precio_base: precioBase,
    precio_final: precioFinal,
    subtotal: precioFinal * cantidad,
    precio_costo: articulo.ultimo_costo || precioBase,
  })

  if (error) throw error

  revalidatePath("/clientes-pedidos")
  return { success: true }
}

export async function actualizarCantidadItem(
  itemId: string,
  pedidoId: string,
  cantidad: number
) {
  if (cantidad <= 0) throw new Error("La cantidad debe ser mayor a 0")
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { data: item, error: fetchError } = await supabase
    .from("pedidos_detalle")
    .select("precio_final")
    .eq("id", itemId)
    .single()

  if (fetchError || !item) throw new Error("Ítem no encontrado")

  const { error } = await supabase
    .from("pedidos_detalle")
    .update({ cantidad, subtotal: item.precio_final * cantidad })
    .eq("id", itemId)

  if (error) throw error

  revalidatePath("/clientes-pedidos")
  return { success: true }
}

export async function eliminarItemPedido(itemId: string, pedidoId: string) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { error } = await supabase.from("pedidos_detalle").delete().eq("id", itemId)
  if (error) throw error

  revalidatePath("/clientes-pedidos")
  return { success: true }
}
