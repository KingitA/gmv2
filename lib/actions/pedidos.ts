"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { getNextOrderNumber } from "@/lib/utils/next-order-number"
import { nowArgentina } from "@/lib/utils"
import { calcularPrecioPedido } from "@/lib/pricing/calcular-precio-pedido"
import type { DatosLista, MetodoFacturacion, DescuentoTipado } from "@/lib/pricing/calculator"
import { insertarKardex } from "@/lib/kardex/insertar-kardex"

// ─── Tipos de segmento de proveedor ──────────────────────────────────────────
type Segmento = "limpieza" | "perf0" | "perf_plus"

function detectarSegmento(articulo: { categoria?: string | null; iva_compras?: string | null }): Segmento {
  const cat = (articulo.categoria || "").toUpperCase()
  if (cat.includes("PERFUMERIA") || cat.includes("PERFUMERÍA")) {
    return articulo.iva_compras === "adquisicion_stock" ? "perf0" : "perf_plus"
  }
  return "limpieza"
}

function toMetodoFacturacion(raw: string | null | undefined): MetodoFacturacion {
  if (!raw) return "Final"
  if (raw === "Factura (21% IVA)" || raw === "Factura") return "Factura"
  if (raw === "Presupuesto") return "Presupuesto"
  return "Final"
}

// Resuelve qué listaId + metodoRaw usar para un segmento dado
// Jerarquía: override pedido → default cliente → fallback general
function resolverListaSegmento(
  segmento: Segmento,
  overrides: {
    lista_limpieza_pedido_id?: string; metodo_limpieza_pedido?: string
    lista_perf0_pedido_id?: string;    metodo_perf0_pedido?: string
    lista_perf_plus_pedido_id?: string; metodo_perf_plus_pedido?: string
    lista_precio_pedido_id?: string;   metodo_facturacion_pedido?: string
  },
  cliente: {
    lista_limpieza_id?: string; metodo_limpieza?: string
    lista_perf0_id?: string;    metodo_perf0?: string
    lista_perf_plus_id?: string; metodo_perf_plus?: string
    lista_precio_id?: string;   metodo_facturacion?: string
  },
): { listaId: string | null; metodoRaw: string } {
  const general = {
    listaId: overrides.lista_precio_pedido_id || cliente.lista_precio_id || null,
    metodoRaw: overrides.metodo_facturacion_pedido || cliente.metodo_facturacion || "Final",
  }

  if (segmento === "limpieza") {
    return {
      listaId: overrides.lista_limpieza_pedido_id || cliente.lista_limpieza_id || general.listaId,
      metodoRaw: overrides.metodo_limpieza_pedido || cliente.metodo_limpieza || general.metodoRaw,
    }
  }
  if (segmento === "perf0") {
    return {
      listaId: overrides.lista_perf0_pedido_id || cliente.lista_perf0_id || general.listaId,
      metodoRaw: overrides.metodo_perf0_pedido || cliente.metodo_perf0 || general.metodoRaw,
    }
  }
  // perf_plus
  return {
    listaId: overrides.lista_perf_plus_pedido_id || cliente.lista_perf_plus_id || general.listaId,
    metodoRaw: overrides.metodo_perf_plus_pedido || cliente.metodo_perf_plus || general.metodoRaw,
  }
}

// ─── Helper: fetch lista datos por id (con caché en-memoria por llamada) ──────
async function fetchListaDatos(
  supabase: any,
  listaId: string | null,
  cache: Record<string, DatosLista>,
): Promise<DatosLista> {
  const empty: DatosLista = { recargo_limpieza_bazar: 0, recargo_perfumeria_negro: 0, recargo_perfumeria_blanco: 0 }
  if (!listaId) return empty
  if (cache[listaId]) return cache[listaId]
  const { data } = await supabase
    .from("listas_precio")
    .select("recargo_limpieza_bazar,recargo_perfumeria_negro,recargo_perfumeria_blanco")
    .eq("id", listaId)
    .single()
  const result: DatosLista = data
    ? { recargo_limpieza_bazar: data.recargo_limpieza_bazar || 0, recargo_perfumeria_negro: data.recargo_perfumeria_negro || 0, recargo_perfumeria_blanco: data.recargo_perfumeria_blanco || 0 }
    : empty
  cache[listaId] = result
  return result
}

// ─── Helper legacy: fetch lista + metodo (usado en agregarItemPedido) ─────────
async function fetchListaYMetodo(
  supabase: any,
  clienteInfo: any,
  metodo_facturacion_pedido?: string,
  lista_precio_pedido_id?: string,
): Promise<{ listaDatos: DatosLista; metodo: MetodoFacturacion; descuentoCliente: number }> {
  const listaId = lista_precio_pedido_id || clienteInfo.lista_precio_id
  const listaDatos = await fetchListaDatos(supabase, listaId || null, {})
  const metodoRaw = metodo_facturacion_pedido || clienteInfo.metodo_facturacion || "Final"
  const metodo = toMetodoFacturacion(metodoRaw)
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
  // Condiciones generales (todo el pedido)
  metodo_facturacion_pedido?: string
  lista_precio_pedido_id?: string
  // Condiciones por segmento de proveedor
  lista_limpieza_pedido_id?: string
  metodo_limpieza_pedido?: string
  lista_perf0_pedido_id?: string
  metodo_perf0_pedido?: string
  lista_perf_plus_pedido_id?: string
  metodo_perf_plus_pedido?: string
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const numeroPedido = await getNextOrderNumber(supabase)

  const { data: clienteInfo, error: clienteError } = await supabase
    .from("clientes")
    .select(`
      id, vendedor_id, metodo_facturacion, lista_precio_id, descuento_especial,
      lista_limpieza_id, metodo_limpieza,
      lista_perf0_id, metodo_perf0,
      lista_perf_plus_id, metodo_perf_plus
    `)
    .eq("id", data.cliente_id)
    .single()
  if (clienteError || !clienteInfo) throw new Error(`Cliente no encontrado: ${clienteError?.message || data.cliente_id}`)

  // Cache de listas para evitar múltiples queries a la misma lista
  const listasCache: Record<string, DatosLista> = {}
  const descuentoCliente = clienteInfo.descuento_especial || 0

  // Overrides de segmento del pedido (vienen del formulario)
  const segmentoOverrides = {
    lista_precio_pedido_id:    data.lista_precio_pedido_id,
    metodo_facturacion_pedido: data.metodo_facturacion_pedido,
    lista_limpieza_pedido_id:  data.lista_limpieza_pedido_id,
    metodo_limpieza_pedido:    data.metodo_limpieza_pedido,
    lista_perf0_pedido_id:     data.lista_perf0_pedido_id,
    metodo_perf0_pedido:       data.metodo_perf0_pedido,
    lista_perf_plus_pedido_id: data.lista_perf_plus_pedido_id,
    metodo_perf_plus_pedido:   data.metodo_perf_plus_pedido,
  }

  // ── Calculate real price for each item ──────────────────────────────────
  type ItemCalc = {
    producto_id: string; cantidad: number
    precioAlCliente: number; precioNeto: number; precio_costo: number
    listaUsadaId: string | null; metodoUsado: string
  }
  const itemsCalc: ItemCalc[] = []
  for (const item of data.items) {
    const articulo = await fetchArticuloConDescuentos(supabase, item.producto_id)
    const segmento = detectarSegmento(articulo)
    const { listaId, metodoRaw } = resolverListaSegmento(segmento, segmentoOverrides, clienteInfo)
    const listaDatos = await fetchListaDatos(supabase, listaId, listasCache)
    const metodo = toMetodoFacturacion(metodoRaw)
    const precio = calcularPrecioPedido(articulo, listaDatos, metodo, descuentoCliente)
    itemsCalc.push({
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precioAlCliente: precio.precioAlCliente,
      precioNeto: precio.precioNeto,
      precio_costo: articulo.precio_compra || 0,
      listaUsadaId: listaId,
      metodoUsado: metodoRaw,
    })
  }

  const total = Math.round(itemsCalc.reduce((s, i) => s + i.precioAlCliente * i.cantidad, 0) * 100) / 100
  const percepciones = 0 // aplica_percepciones no implementado aún en DB

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
      ...(data.metodo_facturacion_pedido    ? { metodo_facturacion_pedido:    data.metodo_facturacion_pedido }    : {}),
      ...(data.lista_precio_pedido_id       ? { lista_precio_pedido_id:       data.lista_precio_pedido_id }       : {}),
      ...(data.lista_limpieza_pedido_id     ? { lista_limpieza_pedido_id:     data.lista_limpieza_pedido_id }     : {}),
      ...(data.metodo_limpieza_pedido       ? { metodo_limpieza_pedido:       data.metodo_limpieza_pedido }       : {}),
      ...(data.lista_perf0_pedido_id        ? { lista_perf0_pedido_id:        data.lista_perf0_pedido_id }        : {}),
      ...(data.metodo_perf0_pedido          ? { metodo_perf0_pedido:          data.metodo_perf0_pedido }          : {}),
      ...(data.lista_perf_plus_pedido_id    ? { lista_perf_plus_pedido_id:    data.lista_perf_plus_pedido_id }    : {}),
      ...(data.metodo_perf_plus_pedido      ? { metodo_perf_plus_pedido:      data.metodo_perf_plus_pedido }      : {}),
      total_flete: 0,
      total_impuestos: percepciones,
      total: Math.round((total + percepciones) * 100) / 100,
      observaciones: data.observaciones,
      creado_por: user.id,
    })
    .select()
    .single()

  if (pedidoError) throw pedidoError

  // Obtener stock actual de todos los artículos en una sola query
  const productIds = itemsCalc.map(i => i.producto_id)
  const { data: articulosInfo } = await supabase
    .from("articulos")
    .select("id, sku, descripcion, categoria, proveedor_id, iva_compras, iva_ventas, stock_actual")
    .in("id", productIds)
  const articulosMap = Object.fromEntries((articulosInfo || []).map((a: any) => [a.id, a]))

  for (const item of itemsCalc) {
    const { error: itemError } = await supabase.from("pedidos_detalle").insert({
      pedido_id: pedido.id,
      articulo_id: item.producto_id,
      cantidad: item.cantidad,
      precio_base: item.precioNeto,
      precio_final: item.precioAlCliente,
      subtotal: Math.round(item.precioAlCliente * item.cantidad * 100) / 100,
      precio_costo: item.precio_costo,
      lista_precio_id: item.listaUsadaId,
      metodo_facturacion_item: item.metodoUsado,
    })
    if (itemError) throw itemError

    // ── Insertar en kardex ────────────────────────────────────────────────
    const art = articulosMap[item.producto_id]
    const ivaIncluido = item.precioAlCliente === item.precioNeto   // presupuesto
    const ivaMonto = ivaIncluido ? 0 : Math.round((item.precioAlCliente - item.precioNeto) * 100) / 100
    const ivaPct = ivaMonto > 0 && item.precioNeto > 0
      ? Math.round((ivaMonto / item.precioNeto) * 10000) / 100
      : 0
    const stockActual = art?.stock_actual ?? null
    // Usar el metodo efectivo de este ítem (puede ser diferente al general)
    const metodoColor = item.metodoUsado
    const colorDinero = metodoColor === "Factura (21% IVA)" || metodoColor === "Factura" ? "BLANCO" : "NEGRO"

    await insertarKardex(
      supabase,
      {
        tipo_movimiento: "venta",
        fecha: nowArgentina(),
        articulo_id: item.producto_id,
        cantidad: item.cantidad,
        precio_costo: item.precio_costo,
        precio_unitario_neto: item.precioNeto,
        precio_unitario_final: item.precioAlCliente,
        iva_porcentaje: ivaPct,
        iva_monto_unitario: ivaMonto,
        iva_incluido: ivaIncluido,
        subtotal_neto: Math.round(item.precioNeto * item.cantidad * 100) / 100,
        subtotal_iva: Math.round(ivaMonto * item.cantidad * 100) / 100,
        subtotal_total: Math.round(item.precioAlCliente * item.cantidad * 100) / 100,
        cliente_id: data.cliente_id,
        vendedor_id: clienteInfo.vendedor_id ?? null,
        pedido_id: pedido.id,
        lista_precio_id: item.listaUsadaId,
        metodo_facturacion: metodoColor,
        color_dinero: colorDinero,
        stock_antes: stockActual,
        stock_despues: stockActual !== null ? stockActual - item.cantidad : null,
        operador_id: user.id,
      },
      {
        sku: art?.sku,
        descripcion: art?.descripcion,
        categoria: art?.categoria,
        proveedor_id: art?.proveedor_id,
        iva_compras: art?.iva_compras,
        iva_ventas: art?.iva_ventas,
      },
    )
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

  const { data: { user } } = await supabase.auth.getUser()

  // Fetch pedido to get lista + metodo + cliente
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("cliente_id,metodo_facturacion_pedido,lista_precio_pedido_id,clientes:cliente_id(metodo_facturacion,lista_precio_id)")
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

  // ── Insertar en kardex ──────────────────────────────────────────────────
  const { data: artInfo } = await supabase
    .from("articulos")
    .select("sku, descripcion, categoria, proveedor_id, iva_compras, iva_ventas, stock_actual")
    .eq("id", productoId)
    .single()

  const ivaIncluido = precio.precioAlCliente === precio.precioNeto
  const ivaMonto = ivaIncluido ? 0 : Math.round((precio.precioAlCliente - precio.precioNeto) * 100) / 100
  const ivaPct = ivaMonto > 0 && precio.precioNeto > 0
    ? Math.round((ivaMonto / precio.precioNeto) * 10000) / 100 : 0
  const metodoRaw = pedido.metodo_facturacion_pedido || (pedido.clientes as any)?.metodo_facturacion || "Final"
  const colorDinero = metodoRaw === "Factura (21% IVA)" || metodoRaw === "Factura" ? "BLANCO" : "NEGRO"

  await insertarKardex(
    supabase,
    {
      tipo_movimiento: "venta",
      fecha: nowArgentina(),
      articulo_id: productoId,
      cantidad,
      precio_costo: articuloConDescuentos.precio_compra || 0,
      precio_unitario_neto: precio.precioNeto,
      precio_unitario_final: precio.precioAlCliente,
      iva_porcentaje: ivaPct,
      iva_monto_unitario: ivaMonto,
      iva_incluido: ivaIncluido,
      subtotal_neto: Math.round(precio.precioNeto * cantidad * 100) / 100,
      subtotal_iva: Math.round(ivaMonto * cantidad * 100) / 100,
      subtotal_total: Math.round(precio.precioAlCliente * cantidad * 100) / 100,
      cliente_id: pedido.cliente_id,
      pedido_id: pedidoId,
      lista_precio_id: pedido.lista_precio_pedido_id || (pedido.clientes as any)?.lista_precio_id || null,
      metodo_facturacion: metodoRaw,
      color_dinero: colorDinero,
      stock_antes: artInfo?.stock_actual ?? null,
      stock_despues: artInfo?.stock_actual != null ? artInfo.stock_actual - cantidad : null,
      operador_id: user?.id ?? null,
    },
    {
      sku: artInfo?.sku,
      descripcion: artInfo?.descripcion,
      categoria: artInfo?.categoria,
      proveedor_id: artInfo?.proveedor_id,
      iva_compras: artInfo?.iva_compras,
      iva_ventas: artInfo?.iva_ventas,
    },
  )

  // Marcar actualizado_por en el pedido
  if (user?.id) {
    await supabase.from("pedidos").update({ actualizado_por: user.id }).eq("id", pedidoId)
  }

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
