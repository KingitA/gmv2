import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

// GET: Obtener un pedido específico
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id: pedido_id } = await params
    const { searchParams } = new URL(request.url)
    const includeComprobantes = searchParams.get("includeComprobantes") === "true"

    const { data: pedido, error } = await supabase
      .from("pedidos")
      .select(
        `
        *,
        clientes(nombre, razon_social, cuit, localidad_id, localidades(nombre)),
        pedidos_detalle(
          *,
          articulos(descripcion, sku, unidades_por_bulto)
        )
      `,
      )
      .eq("id", pedido_id)
      .single()

    if (error || !pedido) {
      console.error("[v0] Error fetching pedido:", error);
      return NextResponse.json({ error: "Pedido no encontrado", details: error }, { status: 404 })
    }

    let comprobantes = []
    let devolucionesPendientes = []

    if (includeComprobantes && pedido.cliente_id) {
      // 1. Comprobantes (Facturas y Notas de Crédito/Débito) con saldo pendiente
      const { data: comprobantesData } = await supabase
        .from("comprobantes_venta")
        .select("*")
        .eq("cliente_id", pedido.cliente_id)
        .gt("saldo_pendiente", 0) // Trae todo lo que tenga saldo (a favor o en contra)
        .order("fecha", { ascending: true })

      comprobantes = comprobantesData || []

      // 2. Devoluciones pendientes (crédito a favor del cliente)
      const { data: devolucionesData } = await supabase
        .from("devoluciones")
        .select("*")
        .eq("cliente_id", pedido.cliente_id)
        .eq("estado", "pendiente")
        .order("created_at", { ascending: true })

      devolucionesPendientes = devolucionesData || []
    }

    let vendedorNombre = ""
    if (pedido.vendedor_id) {
      const { data: vendedor } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', pedido.vendedor_id)
        .single()

      if (vendedor) {
        vendedorNombre = vendedor.nombre || ""
      }
    }

    const cliente = pedido.clientes as any
    const localidad = cliente?.localidades as any

    const response = {
      id: pedido.id,
      numero_pedido: pedido.numero_pedido, // Normalizado a numero_pedido
      fecha: pedido.fecha || pedido.fecha_pedido,
      cliente_id: pedido.cliente_id,
      cliente_nombre: cliente?.razon_social || cliente?.nombre || "",
      cliente_localidad: localidad?.nombre || "",
      vendedor_nombre: vendedorNombre,
      total: pedido.total || 0,
      estado: pedido.estado || "pendiente",
      observaciones: pedido.observaciones || "",
      direccion_entrega: pedido.direccion_temp || "",
      razon_social_factura: pedido.razon_social_temp || "",
      forma_facturacion: pedido.forma_facturacion_temp || "",
      bultos: pedido.bultos || 0,
      comprobantes: comprobantes,
      devoluciones: devolucionesPendientes,
      detalle: (pedido.pedidos_detalle as any[])?.map((item) => ({
        id: item.id,
        articulo_id: item.articulo_id,
        cantidad: item.cantidad || 0,
        precio_unitario: item.precio_final || 0,
        subtotal: item.subtotal || 0,
        articulos: {
          sku: item.articulos?.sku || "",
          nombre: item.articulos?.descripcion || "",
          precio: item.precio_final || 0,
          unidades_por_bulto: item.articulos?.unidades_por_bulto || 1,
        },
      })) || [],
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[v0] Error en GET /api/pedidos/[id]:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

// PUT: Actualizar un pedido pendiente
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id: pedido_id } = await params
    const body = await request.json()

    const { items, observaciones, condiciones_temporales, bultos } = body

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "Debe incluir al menos un artículo" }, { status: 400 })
    }

    const { data: pedidoExistente, error: pedidoError } = await supabase
      .from("pedidos")
      .select("*, clientes(razon_social, nombre, localidad_id, localidades(nombre))")
      .eq("id", pedido_id)
      .single()

    if (pedidoError || !pedidoExistente) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 })
    }

    if (pedidoExistente.estado !== "pendiente") {
      return NextResponse.json({ error: "Solo se pueden modificar pedidos en estado pendiente" }, { status: 400 })
    }

    // Obtener los items actuales del pedido para liberar las reservas
    const { data: itemsAnteriores } = await supabase
      .from("pedidos_detalle")
      .select("articulo_id, cantidad")
      .eq("pedido_id", pedido_id)

    // Liberar stock reservado de los artículos anteriores
    // BUG CORREGIDO: Se eliminó el loop duplicado que procesaba items N*N veces
    if (itemsAnteriores && itemsAnteriores.length > 0) {
      for (const item of itemsAnteriores) {
        // Liberar reserva: restar cantidad (usamos valor negativo)
        await supabase.rpc("increment_stock_reservado", {
          p_articulo_id: item.articulo_id,
          p_cantidad: -item.cantidad,
        })
      }
    }

    // Eliminar items anteriores
    await supabase.from("pedidos_detalle").delete().eq("pedido_id", pedido_id)

    // Procesar nuevos items
    const nuevosItems = []
    let subtotal = 0

    for (const item of items) {
      const { data: articulo } = await supabase
        .from("articulos")
        .select("*, proveedor_id, proveedores(margen_ganancia)")
        .eq("id", item.articulo_id)
        .single()

      if (!articulo) {
        return NextResponse.json({ error: `Artículo ${item.articulo_id} no encontrado` }, { status: 404 })
      }

      // Verificar stock disponible (stock_actual - stock_reservado)
      const stockDisponible = (articulo.stock_actual || 0) - (articulo.stock_reservado || 0)
      if (stockDisponible < item.cantidad) {
        return NextResponse.json(
          {
            error: `Stock insuficiente para ${articulo.descripcion}. Disponible: ${stockDisponible}, Solicitado: ${item.cantidad}`,
          },
          { status: 400 },
        )
      }

      const subtotalItem = item.precio_unitario * item.cantidad

      nuevosItems.push({
        pedido_id,
        articulo_id: item.articulo_id,
        cantidad: item.cantidad,
        precio_final: item.precio_unitario,
        subtotal: subtotalItem,
        precio_costo: articulo.precio_compra || 0,
        precio_base: item.precio_unitario,
        descuento_articulo: 0,
        flete: 0,
        comision: 0,
        impuestos: 0,
      })

      subtotal += subtotalItem
    }

    // Insertar nuevos items
    const { error: itemsError } = await supabase.from("pedidos_detalle").insert(nuevosItems)

    if (itemsError) {
      console.error("[v0] Error insertando nuevos items:", itemsError)
      return NextResponse.json({ error: "Error al actualizar items del pedido" }, { status: 500 })
    }

    // Actualizar pedido con condiciones temporales
    const updateData: any = {
      subtotal,
      total: subtotal,
      total_flete: 0,
      total_comision: 0,
      total_impuestos: 0,
      observaciones: observaciones || pedidoExistente.observaciones,
      ...(bultos !== undefined && { bultos })
    }

    const { data: pedidoActualizado, error: updateError } = await supabase
      .from("pedidos")
      .update(updateData)
      .eq("id", pedido_id)
      .select()
      .single()

    if (updateError) {
      console.error("[v0] Error actualizando pedido:", updateError)
      return NextResponse.json({ error: "Error al actualizar pedido" }, { status: 500 })
    }

    // Reservar stock (aumentar stock_reservado)
    for (const item of nuevosItems) {
      await supabase.rpc("increment_stock_reservado", {
        p_articulo_id: item.articulo_id,
        p_cantidad: item.cantidad,
      })
    }

    const { data: pedidoCompleto } = await supabase
      .from("pedidos")
      .select(
        `
        *,
        clientes(nombre, razon_social, cuit, localidad_id, localidades(nombre)),
        pedidos_detalle(
          *,
          articulos(descripcion, sku, unidades_por_bulto)
        )
      `,
      )
      .eq("id", pedido_id)
      .single()

    if (!pedidoCompleto) {
      return NextResponse.json({ error: "Error al obtener pedido actualizado" }, { status: 500 })
    }

    let vendedorNombre = ""
    if (pedidoCompleto.vendedor_id) {
      const { data: vendedor } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', pedidoCompleto.vendedor_id)
        .single()

      if (vendedor) {
        vendedorNombre = vendedor.nombre || ""
      }
    }

    const cliente = pedidoCompleto.clientes as any
    const localidad = cliente?.localidades as any

    const response = {
      id: pedidoCompleto.id,
      numero: pedidoCompleto.numero_pedido,
      fecha: pedidoCompleto.fecha || pedidoCompleto.fecha_pedido,
      cliente_id: pedidoCompleto.cliente_id,
      cliente_nombre: cliente?.razon_social || cliente?.nombre || "",
      cliente_localidad: localidad?.nombre || "",
      vendedor_nombre: vendedorNombre,
      total: pedidoCompleto.total || 0,
      estado: pedidoCompleto.estado || "pendiente",
      observaciones: pedidoCompleto.observaciones || "",
      direccion_entrega: pedidoCompleto.direccion_temp || "",
      razon_social_factura: pedidoCompleto.razon_social_temp || "",
      forma_facturacion: pedidoCompleto.forma_facturacion_temp || "",
      bultos: pedidoCompleto.bultos || 0,
      detalle: (pedidoCompleto.pedidos_detalle as any[])?.map((item) => ({
        id: item.id,
        articulo_id: item.articulo_id,
        cantidad: item.cantidad || 0,
        precio_unitario: item.precio_final || 0,
        subtotal: item.subtotal || 0,
        articulos: {
          sku: item.articulos?.sku || "",
          nombre: item.articulos?.descripcion || "",
          precio: item.precio_final || 0,
          unidades_por_bulto: item.articulos?.unidades_por_bulto || 1,
        },
      })) || [],
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[v0] Error en PUT /api/pedidos/[id]:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
