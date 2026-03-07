
"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import {
    calcularCostoBruto,
    calcularPrecioBase
} from "@/lib/pricing"
import {
    calcularPrecioVentaOffline,
    calcularPrecioFinalOffline
} from "@/lib/pricing-calc"
import { searchProductsByVector } from "@/lib/actions/embeddings"
import { getNextOrderNumber } from "@/lib/utils/next-order-number"
import { nowArgentina } from "@/lib/utils"

export interface ProductoViajante {
    id: string
    nombre: string
    sku: string
    stock_disponible: number
    precio_final: number
    unidades_por_bulto: number
    imagen_url?: string
    proveedor?: string
    categoria?: string
    ean13?: string
}

export async function searchProductosViajante(query: string, clienteId: string): Promise<ProductoViajante[]> {
    const supabase = await createClient()

    // 1. Fetch Context (Client & Config) ONCE
    const { data: cliente } = await supabase
        .from("clientes")
        .select(`
            *,
            vendedor:vendedores(*),
            localidad:localidades(
                id, nombre,
                zona:zonas(tipo_flete, porcentaje_flete, transporte:transportes(porcentaje_flete))
            )
        `)
        .eq("id", clienteId)
        .single()

    if (!cliente) throw new Error("Cliente no encontrado")

    let { data: config } = await supabase.from("configuracion_precios").select("*").limit(1).single()
    if (!config) {
        config = { porcentaje_gastos_operativos: 3.0, iva_compras_porcentaje: 21.0, iva_ventas_porcentaje: 21.0, iva_mixto_porcentaje: 10.5 }
    }

    // 2. Prepare Calculation Context
    // Flete logic
    let fletePorcentaje = 0
    if (cliente.localidad?.zona) {
        const zona = cliente.localidad.zona
        if (zona.tipo_flete === "transporte" && zona.transporte) {
            fletePorcentaje = zona.transporte.porcentaje_flete || 0
        } else if (zona.tipo_flete === "propio") {
            fletePorcentaje = zona.porcentaje_flete || 0
        }
    }

    // Mapped Client for Calc
    const clienteCalc = {
        nivel_puntaje: cliente.nivel_puntaje || "REGULAR",
        retira_en_deposito: cliente.retira_en_deposito || false,
        exento_iva: cliente.exento_iva || false,
        exento_iibb: cliente.exento_iibb || false,
        percepcion_iibb: cliente.percepcion_iibb || 0,
        porcentaje_flete: fletePorcentaje,
        comisiones: {
            perfumeria: cliente.vendedor?.comision_perfumeria || 0,
            bazar_limpieza: cliente.vendedor?.comision_bazar_limpieza || 0
        }
    }

    // 3. Build Query
    // STRICT: Only articles with provider (!inner join).
    let dbQuery = supabase
        .from("articulos")
        .select(`
            id, descripcion, sku, ean13, stock_actual, unidades_por_bulto, precio_compra, 
            iva_compras, iva_ventas, porcentaje_ganancia, descuento1, descuento2, descuento3, descuento4,
            proveedor:proveedores!inner(nombre, tipo_descuento, percepcion_iva, percepcion_iibb, retencion_ganancias, retencion_iibb)
        `)
        .eq("activo", true)
        .order("descripcion")

    let vectorIds: string[] = []

    if (query && query.trim().length > 0) {
        // Try Vector Search
        try {
            const vectorResults = await searchProductsByVector(query, 0.3, 50) // Back to 0.3 but we'll improve text weighting
            if (vectorResults && vectorResults.length > 0) {
                vectorIds = vectorResults.map((p: any) => p.id)
                dbQuery = dbQuery.in('id', vectorIds)
            }
        } catch (e) {
            console.warn("Vector search error in viajante:", e)
        }

        // Fallback to ILIKE if vector search failed or returned no results
        if (vectorIds.length === 0) {
            dbQuery = dbQuery.or(`descripcion.ilike.%${query}%,sku.ilike.%${query}%,ean13.ilike.%${query}%`)
        }
    }

    // Limit results
    dbQuery = dbQuery.limit(100)

    const { data: productos, error } = await dbQuery

    if (error) {
        console.error("Error searching products DB:", error)
        return []
    }

    // 4. Calculate Prices in Memory (Bulk)
    const results = (productos || []).map((articulo: any) => {
        try {
            // A. Costo Bruto
            const { costoBruto } = calcularCostoBruto(
                articulo.precio_compra || 0,
                {
                    d1: articulo.descuento1 || 0,
                    d2: articulo.descuento2 || 0,
                    d3: articulo.descuento3 || 0,
                    d4: articulo.descuento4 || 0
                },
                articulo.proveedor?.tipo_descuento || "cascada"
            )

            // B. Precio Base
            const { precioBase } = calcularPrecioBase(
                costoBruto,
                articulo.porcentaje_ganancia || 20,
                config.porcentaje_gastos_operativos
            )

            // C. Venta Neto
            const categoriaNombre = "BAZAR Y LIMPIEZA"

            const { precioVentaNeto } = calcularPrecioVentaOffline(
                precioBase,
                clienteCalc,
                categoriaNombre
            )

            // D. Precio Final
            const articuloCalc = {
                id: articulo.id,
                precio_base: precioBase,
                iva_compras: articulo.iva_compras || "factura",
                iva_ventas: articulo.iva_ventas || "factura",
                categoria: categoriaNombre
            }

            const { precioFinalRedondeado } = calcularPrecioFinalOffline(
                precioVentaNeto,
                articuloCalc,
                clienteCalc,
                config
            )

            return {
                id: articulo.id,
                nombre: articulo.descripcion || "Sin nombre",
                sku: articulo.sku,
                stock_disponible: articulo.stock_actual,
                precio_final: precioFinalRedondeado,
                unidades_por_bulto: articulo.unidades_por_bulto || 1,
                proveedor: articulo.proveedor?.nombre,
                categoria: articulo.categoria?.nombre || "General",
                ean13: articulo.ean13
            }
        } catch (e) {
            console.error("Price calc error for item", articulo.id, e)
            return null
        }
    })

    const finalResults = results.filter(Boolean) as ProductoViajante[]

    // PRESERVE RANKING if vector search was used
    if (vectorIds.length > 0) {
        finalResults.sort((a, b) => {
            const indexA = vectorIds.indexOf(a.id)
            const indexB = vectorIds.indexOf(b.id)
            // If both are in vectorIds, sort by their position
            if (indexA !== -1 && indexB !== -1) return indexA - indexB
            // If only one is in vectorIds (shouldn't happen with .in filter but safe), put it first
            if (indexA !== -1) return -1
            if (indexB !== -1) return 1
            return 0
        })
    }

    return finalResults
}

// --- PEDIDOS (Draft & Final) ---

export async function getDraftPedido(clienteId: string, vendedorId: string) {
    const supabase = await createClient()

    // Buscar pedido 'borrador' usando las tablas correctas
    // NOTA: 'condicion_venta' NO existe en la tabla pedidos.
    // Usamos 'pedidos_detalle' en lugar de 'pedido_items'
    const { data: draft } = await supabase
        .from("pedidos")
        .select(`
            *, 
            items:pedidos_detalle(*, articulo:articulos(id, descripcion, sku, stock_actual, precio_compra, iva_ventas, categoria, proveedor:proveedores(tipo_descuento)))
        `)
        .eq("cliente_id", clienteId)
        .eq("vendedor_id", vendedorId)
        .eq("estado", "pendiente")
        .eq("numero_pedido", "0")
        .maybeSingle()

    if (!draft) return null

    // Intentar recuperar condicion_venta de las observaciones
    let condicion_venta = "cta_cte" // Default
    const obs = draft.observaciones || ""
    const match = obs.match(/\[Condición: (.*?)\]/)
    if (match) {
        condicion_venta = match[1]
    }

    return {
        id: draft.id,
        observaciones: obs.replace(/\[Condición: .*?\]/, "").trim(),
        condicion_venta,
        direccion_entrega: draft.direccion_temp,
        items: draft.items.map((item: any) => ({
            producto: {
                id: item.articulo.id,
                nombre: item.articulo.descripcion,
                sku: item.articulo.sku,
                stock_disponible: item.articulo.stock_actual,
                precio_final: item.precio_final,
                proveedor: item.articulo.proveedor,
                categoria: item.articulo.categoria,
                unidades_por_bulto: 1
            },
            cantidad: item.cantidad,
            subtotal: item.subtotal
        }))
    }
}

// Función para INICIAR o ACTUALIZAR un borrador
export async function saveDraftPedido(data: {
    pedido_id?: string
    cliente_id: string
    vendedor_id: string
    items: { producto_id: string; cantidad: number; precio_final: number }[]
    observaciones?: string
    condicion_venta?: string
    direccion_entrega?: string
    // Nuevos campos para actualización de perfil
    condicion_iva?: string
    metodo_facturacion?: string
    exento_iibb?: boolean
    exento_iva?: boolean
    condicion_entrega?: string
    updateClientProfile?: boolean
}) {
    const supabase = await createClient()

    // 0. Update Client Profile if requested
    if (data.updateClientProfile) {
        const updateData: any = {}
        if (data.condicion_iva) updateData.condicion_iva = data.condicion_iva
        if (data.metodo_facturacion) updateData.metodo_facturacion = data.metodo_facturacion
        if (data.exento_iibb !== undefined) updateData.exento_iibb = data.exento_iibb
        if (data.exento_iva !== undefined) updateData.exento_iva = data.exento_iva
        if (data.condicion_entrega) updateData.condicion_entrega = data.condicion_entrega
        if (data.direccion_entrega) updateData.direccion = data.direccion_entrega
        if (data.condicion_venta) updateData.condicion_pago = data.condicion_venta

        await supabase.from("clientes").update(updateData).eq("id", data.cliente_id)
    }

    const total = data.items.reduce((sum, item) => sum + (item.precio_final * item.cantidad), 0)
    let pedidoId = data.pedido_id

    // Guardar snapshots en observaciones
    const datosVentaSnapshot = `[Datos Venta: Pago: ${data.condicion_venta || '?'} | Entrega: ${data.condicion_entrega || '?'} | Fact: ${data.metodo_facturacion || '?'} | IVA: ${data.condicion_iva || '?'} | Ex.IIBB: ${data.exento_iibb ? 'SI' : 'NO'} | Ex.IVA: ${data.exento_iva ? 'SI' : 'NO'}]`

    let observacionesClean = (data.observaciones || "").replace(/\[Datos Venta:.*?\]/g, "").trim()
    // También limpiar viejos format [Condición: ...]
    observacionesClean = observacionesClean.replace(/\[Condición:.*?\]/g, "").trim()

    const observacionesFinal = `${observacionesClean} ${datosVentaSnapshot}`.trim()

    // 1. Crear o Actualizar Cabecera
    if (pedidoId) {
        await supabase.from("pedidos").update({
            total,
            observaciones: observacionesFinal,
            fecha: nowArgentina(),
            direccion_temp: data.direccion_entrega
        }).eq("id", pedidoId)
    } else {
        // Verificar si existe uno huérfano (Pendiente + DRAFT)
        const { data: existing } = await supabase.from("pedidos")
            .select("id")
            .eq("cliente_id", data.cliente_id)
            .eq("vendedor_id", data.vendedor_id)
            .eq("estado", "pendiente")
            .eq("numero_pedido", "0")
            .maybeSingle()

        if (existing) {
            pedidoId = existing.id
            await supabase.from("pedidos").update({
                total,
                observaciones: observacionesFinal,
                fecha: nowArgentina(),
                direccion_temp: data.direccion_entrega
            }).eq("id", pedidoId)
        } else {
            // Crear NUEVO borrador
            // Draft pedidos use '0' as placeholder until confirmed
            const numero_pedido = "0"

            const { data: newPedido, error } = await supabase.from("pedidos").insert({
                cliente_id: data.cliente_id,
                vendedor_id: data.vendedor_id,
                fecha: nowArgentina(),
                estado: "pendiente", // Valid DB state
                total,
                observaciones: observacionesFinal,
                numero_pedido,
                direccion_temp: data.direccion_entrega
            }).select("id").single()

            if (error) throw new Error("Error creando borrador: " + error.message)
            pedidoId = newPedido.id
        }
    }

    // 2. Sincronizar Items (Tabla: pedidos_detalle)
    if (pedidoId) {
        // Borrar anteriores (estrategia simple para borrador)
        await supabase.from("pedidos_detalle").delete().eq("pedido_id", pedidoId)

        if (data.items.length > 0) {
            const itemsData = data.items.map(item => ({
                pedido_id: pedidoId,
                articulo_id: item.producto_id,
                cantidad: item.cantidad,
                precio_final: item.precio_final,
                subtotal: item.precio_final * item.cantidad,
            }))
            await supabase.from("pedidos_detalle").insert(itemsData)
        }
    }

    return pedidoId
}


// Función para CONFIRMAR el pedido (pasar de borrador a pendiente)
export async function confirmPedidoViajante(pedidoId: string) {
    const supabase = await createClient()

    // 1. Obtener datos actuales del pedido para CTA CTE
    const { data: pedido, error: fetchError } = await supabase
        .from("pedidos")
        .select("*")
        .eq("id", pedidoId)
        .single()

    if (fetchError || !pedido) throw new Error("Pedido no encontrado para confirmar")

    // Generar número real
    // Generate numeric-only order number
    const numero_pedido = await getNextOrderNumber(supabase)

    // 2. Actualizar estado y número
    const { error: updateError } = await supabase.from("pedidos").update({
        numero_pedido,
        estado: "pendiente",
        fecha: nowArgentina()
    }).eq("id", pedidoId)

    if (updateError) throw new Error("Error finalizando pedido: " + updateError.message)

    // 3. Crear movimiento en Cta Cte
    const { error: ctaCteError } = await supabase.from("cuenta_corriente").insert({
        cliente_id: pedido.cliente_id,
        fecha: nowArgentina(),
        tipo_comprobante: "PEDIDO",
        numero_comprobante: numero_pedido,
        concepto: `Pedido N°${numero_pedido} (Pendiente Facturación)`,
        debe: pedido.total,
        haber: 0,
        saldo: pedido.total,
        viajante_id: pedido.vendedor_id,
        pedido_ref_id: pedidoId
    })

    if (ctaCteError) console.error("Error creating cta cte:", ctaCteError)

    revalidatePath(`/viajante/clientes/${pedido.cliente_id}`)
    return pedidoId
}

// Helper wrapper for compatibility (if needed)
export async function createPedidoViajante(data: any) {
    if (data.draft_id) {
        return confirmPedidoViajante(data.draft_id)
    } else {
        const id = await saveDraftPedido(data)
        if (id) return confirmPedidoViajante(id)
        throw new Error("No se pudo crear el pedido")
    }
}

// --- DASHBOARD ---

export async function getViajanteDashboardData() {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return {
            clienteCount: 0,
            totalComisionesPendientes: 0,
            totalComisionesPagadas: 0,
            viajes: []
        }
    }

    const { data: crmUser } = await supabase
        .from("usuarios_crm")
        .select("id, rol")
        .eq("email", user.email)
        .single()

    const userIdToUse = crmUser?.id || user.id
    const userRole = crmUser?.rol || "viajante"

    let clienteCount = 0
    let totalComisionesPendientes = 0
    let totalComisionesPagadas = 0
    let viajes: any[] = []

    // 1. Clientes Count
    let clientesQuery = supabase.from("clientes").select("*", { count: "exact", head: true }).eq("activo", true)
    if (userRole !== "admin") {
        clientesQuery = clientesQuery.eq("vendedor_id", userIdToUse)
    }
    const { count } = await clientesQuery
    clienteCount = count || 0

    // 2. Comisiones 
    try {
        let commPendingQuery = supabase.from("comisiones").select("monto").eq("pagado", false)
        if (userRole !== "admin") commPendingQuery = commPendingQuery.eq("viajante_id", userIdToUse)
        const { data: pending } = await commPendingQuery
        totalComisionesPendientes = pending?.reduce((sum, c) => sum + (c.monto || 0), 0) || 0

        let commPaidQuery = supabase.from("comisiones").select("monto").eq("pagado", true)
        if (userRole !== "admin") commPaidQuery = commPaidQuery.eq("viajante_id", userIdToUse)
        const { data: paid } = await commPaidQuery
        totalComisionesPagadas = paid?.reduce((sum, c) => sum + (c.monto || 0), 0) || 0
    } catch (e) {
        console.error("Error fetching commissions", e)
    }

    // 3. Viajes 
    try {
        let viajesQuery = supabase.from("viajes").select("*").gte("fecha_salida", nowArgentina()).limit(5)
        if (userRole !== "admin") {
            viajesQuery = viajesQuery.eq("chofer_id", userIdToUse)
        }
        const { data: viajesData } = await viajesQuery
        viajes = viajesData || []
    } catch (e) {
        console.error("Error fetching trips", e)
    }

    return {
        clienteCount,
        totalComisionesPendientes,
        totalComisionesPagadas,
        viajes
    }
}
