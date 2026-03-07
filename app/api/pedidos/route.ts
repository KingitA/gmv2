import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()

    const {
      cliente_id,
      vendedor_id,
      items, // Array de { articulo_id, cantidad }
      observaciones,
      punto_venta = "CRM",
    } = body

    // Validaciones básicas
    if (!cliente_id || !items || items.length === 0) {
      return NextResponse.json({ error: "Faltan datos requeridos: cliente_id e items" }, { status: 400 })
    }

    // Obtener datos del cliente
    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .select(`
        *,
        localidades!inner(
          zona_id,
          zonas!inner(
            porcentaje_flete,
            tipo_flete
          )
        )
      `)
      .eq("id", cliente_id)
      .single()

    if (clienteError || !cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    const { data: vendedorInfo } = await supabase
      .from('vendedores_info')
      .select('*')
      .eq('usuario_id', vendedor_id || cliente.vendedor_id)
      .single()

    // 2. Obtener configuración de precios
    const { data: config } = await supabase.from("configuracion_precios").select("*").single()

    const porcentajeGastosOperativos = config?.porcentaje_gastos_operativos || 3
    const ivaVentas = config?.iva_ventas_porcentaje || 21
    const ivaMixto = config?.iva_mixto_porcentaje || 10.5

    // 3. Calcular precios para cada artículo
    const itemsCalculados = []
    let subtotalPedido = 0
    let totalFlete = 0
    let totalComision = 0
    let totalImpuestos = 0

    for (const item of items) {
      const { data: articulo } = await supabase
        .from("articulos")
        .select(`
          *,
          proveedores!inner(tipo_descuento)
        `)
        .eq("id", item.articulo_id)
        .single()

      if (!articulo) continue

      // Verificar stock disponible
      if (articulo.stock_actual < item.cantidad) {
        return NextResponse.json(
          {
            error: `Stock insuficiente para ${articulo.descripcion}. Disponible: ${articulo.stock_actual}, Solicitado: ${item.cantidad}`,
          },
          { status: 400 },
        )
      }

      // PASO 1: Costo Bruto
      let costoBruto = articulo.precio_compra || 0
      const tipoDescuento = articulo.proveedores?.tipo_descuento || "cascada"

      if (tipoDescuento === "cascada") {
        costoBruto *= 1 - (articulo.descuento1 || 0) / 100
        costoBruto *= 1 - (articulo.descuento2 || 0) / 100
        costoBruto *= 1 - (articulo.descuento3 || 0) / 100
        costoBruto *= 1 - (articulo.descuento4 || 0) / 100
      } else {
        const descuentoTotal =
          (articulo.descuento1 || 0) +
          (articulo.descuento2 || 0) +
          (articulo.descuento3 || 0) +
          (articulo.descuento4 || 0)
        costoBruto *= 1 - descuentoTotal / 100
      }

      // PASO 2: Costo Final (con IVA compras)
      const costoFinal = costoBruto * (1 + ivaVentas / 100)

      // PASO 3: Precio Base
      const ganancia = costoBruto * ((articulo.porcentaje_ganancia || 0) / 100)
      const gastosOperativos = costoBruto * (porcentajeGastosOperativos / 100)
      const precioBase = costoBruto + ganancia + gastosOperativos

      // PASO 4: Precio Venta (con flete y puntaje)
      let fleteVenta = 0
      if (!cliente.retira_en_deposito) {
        const porcentajeFlete = cliente.localidades?.zonas?.porcentaje_flete || 0
        fleteVenta = precioBase * (porcentajeFlete / 100)
      }

      let recargoPuntaje = 0
      if (cliente.nivel_puntaje === "RIESGO") {
        recargoPuntaje = precioBase * 0.05
      } else if (cliente.nivel_puntaje === "CRITICO") {
        recargoPuntaje = precioBase * 0.15
      }

      // Comisión del vendedor según categoría
      let comisionPorcentaje = 0
      if (articulo.categoria === "PERFUMERIA") {
        comisionPorcentaje = vendedorInfo?.comision_perfumeria || 0
      } else {
        comisionPorcentaje = vendedorInfo?.comision_bazar_limpieza || 0
      }

      const precioVentaNeto = (precioBase + fleteVenta + recargoPuntaje) / (1 - comisionPorcentaje / 100)
      const comision = precioVentaNeto * (comisionPorcentaje / 100)

      // PASO 5: Precio Final (con impuestos)
      let impuestos = 0
      const ivaCompras = articulo.iva_compras || "factura"
      const ivaVentasArticulo = articulo.iva_ventas || "factura"

      if (ivaVentasArticulo === "factura") {
        impuestos = precioVentaNeto * (ivaVentas / 100)
      } else if (ivaVentasArticulo === "presupuesto") {
        if (ivaCompras === "mixto") {
          impuestos = precioVentaNeto * (ivaMixto / 100)
        }
      }

      const precioFinal = Math.round(precioVentaNeto + impuestos)
      const subtotalItem = precioFinal * item.cantidad

      itemsCalculados.push({
        articulo_id: item.articulo_id,
        cantidad: item.cantidad,
        precio_costo: costoBruto,
        precio_base: precioBase,
        precio_final: precioFinal,
        subtotal: subtotalItem,
        descuento_articulo: 0,
        flete: fleteVenta,
        comision: comision,
        impuestos: impuestos,
      })

      subtotalPedido += subtotalItem
      totalFlete += fleteVenta * item.cantidad
      totalComision += comision * item.cantidad
      totalImpuestos += impuestos * item.cantidad
    }

    // 4. Generar número de pedido
    const { data: ultimoPedido } = await supabase
      .from("pedidos")
      .select("numero_pedido")
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    let numeroPedido = "0001"
    if (ultimoPedido?.numero_pedido) {
      const ultimoNumero = Number.parseInt(ultimoPedido.numero_pedido)
      numeroPedido = String(ultimoNumero + 1).padStart(4, "0")
    }

    // 5. Crear el pedido
    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .insert({
        numero_pedido: numeroPedido,
        cliente_id,
        vendedor_id: vendedor_id || cliente.vendedor_id,
        fecha: todayArgentina(),
        estado: "pendiente",
        punto_venta,
        subtotal: subtotalPedido,
        total_flete: totalFlete,
        total_comision: totalComision,
        total_impuestos: totalImpuestos,
        descuento_general: 0,
        descuento_vendedor: 0,
        total: subtotalPedido,
        observaciones,
      })
      .select()
      .single()

    if (pedidoError) {
      console.error("[v0] Error creando pedido:", pedidoError)
      return NextResponse.json({ error: "Error al crear el pedido" }, { status: 500 })
    }

    // 6. Insertar items del pedido
    const { error: itemsError } = await supabase.from("pedidos_detalle").insert(
      itemsCalculados.map((item) => ({
        ...item,
        pedido_id: pedido.id,
      })),
    )

    if (itemsError) {
      console.error("[v0] Error insertando items:", itemsError)
      // Rollback: eliminar el pedido
      await supabase.from("pedidos").delete().eq("id", pedido.id)
      return NextResponse.json({ error: "Error al crear los items del pedido" }, { status: 500 })
    }

    // 7. Actualizar stock (reservar)
    for (const item of itemsCalculados) {
      await supabase.rpc("actualizar_stock", {
        p_articulo_id: item.articulo_id,
        p_cantidad: -item.cantidad,
      })
    }

    return NextResponse.json({
      success: true,
      pedido: {
        id: pedido.id,
        numero_pedido: pedido.numero_pedido,
        total: pedido.total,
        items: itemsCalculados.length,
      },
    })
  } catch (error) {
    console.error("[v0] Error en POST /api/pedidos:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

// GET: Obtener pedidos de un cliente o vendedor
export async function GET(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const cliente_id = searchParams.get("cliente_id")
    const vendedor_id = searchParams.get("vendedor_id")

    let query = supabase
      .from("pedidos")
      .select(`
        *,
        clientes(
          nombre, 
          razon_social,
          localidades(nombre)
        ),
        pedidos_detalle(
          *,
          articulos(descripcion, sku)
        )
      `)
      .neq("estado", "eliminado")
      .order("created_at", { ascending: false })

    if (cliente_id) {
      query = query.eq("cliente_id", cliente_id)
    } else if (vendedor_id) {
      query = query.eq("vendedor_id", vendedor_id)
    }

    const { data: pedidos, error } = await query

    if (error) {
      console.error("[v0] Error obteniendo pedidos:", error)
      return NextResponse.json({ error: "Error al obtener pedidos" }, { status: 500 })
    }

    const vendedorIds = [...new Set(pedidos?.map(p => p.vendedor_id).filter(Boolean) || [])]
    const vendedoresMap: Record<string, string> = {}

    if (vendedorIds.length > 0) {
      const { data: vendedores } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .in('id', vendedorIds)

      if (vendedores) {
        vendedores.forEach((v) => {
          vendedoresMap[v.id] = v.nombre
        })
      }
    }

    const pedidosFormateados =
      pedidos?.map((pedido) => ({
        id: pedido.id,
        numero: pedido.numero_pedido,
        fecha: pedido.fecha,
        cliente_id: pedido.cliente_id,
        cliente_nombre: pedido.clientes?.razon_social || pedido.clientes?.nombre || "",
        cliente_localidad: pedido.clientes?.localidades?.nombre || "",
        total: pedido.total || 0,
        estado: pedido.estado || "pendiente",
        observaciones: pedido.observaciones || "",
        vendedor_id: pedido.vendedor_id || "",
        vendedor_nombre: pedido.vendedor_id ? (vendedoresMap[pedido.vendedor_id] || "") : "",
        items: pedido.pedidos_detalle?.length || 0,
        detalle: pedido.pedidos_detalle || [],
      })) || []

    return NextResponse.json(pedidosFormateados)
  } catch (error) {
    console.error("[v0] Error en GET /api/pedidos:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
