"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { getNextOrderNumber } from "@/lib/utils/next-order-number"
import { nowArgentina } from "@/lib/utils"
import { calcularPrecioPedido } from "@/lib/pricing/calcular-precio-pedido"
import type { DatosLista, MetodoFacturacion, DescuentoTipado } from "@/lib/pricing/calculator"

// ─── Helper: fetch lista + metodo and calculate price for one articulo ────────
async function fetchListaYMetodo(
  supabase: any,
  clienteInfo: any,
  metodo_facturacion_pedido?: string,
  lista_precio_pedido_id?: string,
): Promise<{ listaDatos: DatosLista; metodo: MetodoFacturacion; descuentoCliente: number }> {
  const listaId = lista_precio_pedido_id || clienteInfo.lista_precio_id
  let listaDatos: DatosLista = { recargo_limpieza_bazar: 0, recargo_perfumeria_negro: 0, recargo_perfumeria_blanco: 0 }
  if (listaId) {
    const { data: lista } = await supabase.from("listas_precio").select("recargo_limpieza_bazar,recargo_perfumeria_negro,recargo_perfumeria_blanco").eq("id", listaId).single()
    if (lista) listaDatos = { recargo_limpieza_bazar: lista.recargo_limpieza_bazar || 0, recargo_perfumeria_negro: lista.recargo_perfumeria_negro || 0, recargo_perfumeria_blanco: lista.recargo_perfumeria_blanco || 0 }
  }
  const metodoRaw = metodo_facturacion_pedido || clienteInfo.metodo_facturacion || "Final"
  const metodo: MetodoFacturacion = metodoRaw === "Factura (21% IVA)" ? "Factura" : metodoRaw === "Presupuesto" ? "Presupuesto" : "Final"
  const descuentoCliente = clienteInfo.descuento_especial || 0
  return { listaDatos, metodo, descuentoCliente }
}

async function fetchArticuloConDescuentos(supabase: any, productoId: string) {
  const [{ data: articulo }, { data: descuentosDB }] = await Promise.all([
    supabase.from("articulos").select("id,precio_compra,precio_base,precio_base_contado,porcentaje_ganancia,bonif_recargo,categoria,iva_compras,iva_ventas,proveedor:proveedores(tipo_descuento)").eq("id", productoId).single(),
    supabase.from("articulos_descuentos").select("tipo,porcentaje,orden").eq("articulo_id", productoId).order("orden"),
  ])
  if (!articulo) throw new Error("Artículo no encontrado")
  const descuentos: DescuentoTipado[] = (descuentosDB || []).map((d: any) => ({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden }))
  return { ...articulo, descuentos }
}

export async function createPedido(data: {
  cliente_id: string
  items: Array<{
    producto_id: string
    cantidad: number
    precio_unitario: number  // ignored — price is always calculated from lista/metodo
    descuento: number
  }>
  observaciones?: string
  zona_entrega?: string
  metodo_facturacion_pedido?: string
  lista_precio_pedido_id?: string
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const numeroPedido = await getNextOrderNumber(supabase)

  const { data: clienteInfo } = await supabase
    .from("clientes")
    .select("id,vendedor_id,metodo_facturacion,lista_precio_id,descuento_especial,aplica_percepciones")
    .eq("id", data.cliente_id)
    .single()
  if (!clienteInfo) throw new Error("Cliente no encontrado")

  const { listaDatos, metodo, descuentoCliente } = await fetchListaYMetodo(
    supabase, clienteInfo, data.metodo_facturacion_pedido, data.lista_precio_pedido_id
  )

  // ── Calculate real price for each item ──────────────────────────────────
  type ItemCalc = {
    producto_id: string; cantidad: number
    precioAlCliente: number; precioNeto: number; precio_costo: number
  }
  const itemsCalc: ItemCalc[] = []
  for (const item of data.items) {
    const articulo = await fetchArticuloConDescuentos(supabase, item.producto_id)
    const precio = calcularPrecioPedido(articulo, listaDatos, metodo, descuentoCliente)
    itemsCalc.push({
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precioAlCliente: precio.precioAlCliente,
      precioNeto: precio.precioNeto,
      precio_costo: articulo.precio_compra || 0,
    })
  }

  const total = Math.round(itemsCalc.reduce((s, i) => s + i.precioAlCliente * i.cantidad, 0) * 100) / 100
  const percepciones = clienteInfo.aplica_percepciones ? Math.round(total * 0.03 * 100) / 100 : 0

  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .insert({
      numero_pedido: numeroPedido,
      cliente_id: data.cliente_id,
      vendedor_id: clienteInfo.vendedor_id,
      fecha: nowArgentina(),
      estado: "pendiente",
      subtotal: total,
      descuento_general: 0,
      ...(data.metodo_facturacion_pedido ? { metodo_facturacion_pedido: data.metodo_facturacion_pedido } : {}),
      ...(data.lista_precio_pedido_id ? { lista_precio_pedido_id: data.lista_precio_pedido_id } : {}),
      total_flete: 0,
      total_impuestos: percepciones,
      total: Math.round((total + percepciones) * 100) / 100,
      observaciones: data.observaciones,
    })
    .select()
    .single()

  if (pedidoError) throw pedidoError

  for (const item of itemsCalc) {
    const { error: itemError } = await supabase.from("pedidos_detalle").insert({
      pedido_id: pedido.id,
      articulo_id: item.producto_id,
      cantidad: item.cantidad,
      precio_base: item.precioNeto,
      precio_final: item.precioAlCliente,
      subtotal: Math.round(item.precioAlCliente * item.cantidad * 100) / 100,
      precio_costo: item.precio_costo,
    })
    if (itemError) throw itemError
  }

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
    const { data: article } = await supabase.from("articulos").select("proveedor_id").eq("id", itemsCalc[0].producto_id).single()

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

  // Fetch pedido to get lista + metodo + cliente
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("cliente_id,metodo_facturacion_pedido,lista_precio_pedido_id,clientes:cliente_id(metodo_facturacion,lista_precio_id,descuento_especial,aplica_percepciones)")
    .eq("id", pedidoId)
    .single()
  if (!pedido) throw new Error("Pedido no encontrado")

  const clienteInfo = { ...(pedido.clientes as any), id: pedido.cliente_id }
  const { listaDatos, metodo, descuentoCliente } = await fetchListaYMetodo(
    supabase, clienteInfo, pedido.metodo_facturacion_pedido, pedido.lista_precio_pedido_id
  )

  const articuloConDescuentos = await fetchArticuloConDescuentos(supabase, productoId)
  const precio = calcularPrecioPedido(articuloConDescuentos, listaDatos, metodo, descuentoCliente)

  const { error } = await supabase.from("pedidos_detalle").insert({
    pedido_id: pedidoId,
    articulo_id: productoId,
    cantidad,
    precio_base: precio.precioNeto,
    precio_final: precio.precioAlCliente,
    subtotal: Math.round(precio.precioAlCliente * cantidad * 100) / 100,
    precio_costo: articuloConDescuentos.precio_compra || 0,
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
