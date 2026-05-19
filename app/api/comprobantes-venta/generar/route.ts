import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from "@/lib/auth"
import {
  calcularPrecioFinal,
  articuloToDatosArticulo,
  type DatosLista,
  type MetodoFacturacion,
  type DescuentoTipado,
} from "@/lib/pricing/calculator"
import { generarBonificacionContado } from "@/lib/comprobantes/generar-bonificacion"
import { insertarKardex, vincularKardexAComprobante, distribuirPercepcionesKardex } from "@/lib/kardex/insertar-kardex"
import { getBonificacionArticuloId } from "@/lib/articulos/bonificacion"

export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const supabase = createAdminClient()
    const body = await request.json()
    const { pedido_id, pago_contado } = body

    // ─── 1. Obtener pedido con cliente y detalles ───
    // Prices are already stored in pedidos_detalle (calculated when the order was created).
    // precio_final = precio al cliente con IVA incluido (siempre)
    // precio_base  = precio neto antes de IVA
    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select(`
        *,
        cliente:clientes!pedidos_cliente_id_fkey(
          id, nombre_razon_social, condicion_iva, metodo_facturacion,
          cuit, direccion, exento_iva, provincia, vendedor_id
        ),
        detalle:pedidos_detalle(
          id, articulo_id, cantidad, precio_final, precio_base, es_bonificado, estado_item,
          articulo:articulos!pedidos_detalle_articulo_id_fkey(
            id, descripcion, sku, iva_ventas, categoria, iva_compras, marca_id, proveedor_id, segmento_precio
          )
        )
      `)
      .eq("id", pedido_id)
      .single()

    if (pedidoError || !pedido) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 })
    }

    // ─── 2. Determinar método de facturación ───
    const metodoRaw = pedido.metodo_facturacion_pedido || pedido.cliente.metodo_facturacion || "Final"
    const metodoFacturacion: MetodoFacturacion =
      metodoRaw === "Factura (21% IVA)" || metodoRaw === "Factura" ? "Factura" :
      metodoRaw === "Presupuesto" ? "Presupuesto" : "Final"

    // ─── 3. Build items using stored prices ───
    // precio_final = lo que el cliente paga (IVA incluido en presupuesto, neto en factura)
    // Para factura A: discriminamos IVA retrocalculando desde el precio almacenado.
    type ItemCalculado = {
      detalle_id: string
      articulo_id: string
      descripcion: string
      sku: string
      cantidad: number
      precioUnitario: number    // precio en la línea del comprobante
      precioAntesIva: number    // neto (= precioUnitario para factura)
      precioBase: number        // precio neto real antes de IVA (det.precio_base)
      precioFinal: number       // precio con IVA al cliente (det.precio_final)
      ivaUnitario: number       // IVA por unidad
      ivaIncluido: boolean
      subtotalNeto: number
      subtotalIva: number
      subtotalFinal: number
      descNegroAplicado: boolean
      vaEnComprobante: "factura" | "presupuesto"
      segmento: string
      esBonificado: boolean
      marcaId: string | null
      proveedorId: string | null
      ivaCompras: string | null
      ivaVentas: string | null
    }

    const IVA_RATE = 0.21

    const itemsCalculados: ItemCalculado[] = []
    for (const det of pedido.detalle) {
      const art = det.articulo
      if (!art) continue
      if (det.estado_item === "FALTANTE" || (det.cantidad ?? 0) <= 0) continue

      const esPresupuesto = art.iva_ventas === "presupuesto" || metodoFacturacion === "Presupuesto"
      const vaEnComprobante: "factura" | "presupuesto" =
        metodoFacturacion === "Presupuesto" ? "presupuesto" :
        metodoFacturacion === "Factura"     ? "factura"     :
        esPresupuesto ? "presupuesto" : "factura"

      // precio_final = precio final al cliente (IVA siempre incluido)
      // precio_base  = precio neto antes de IVA
      const precioAlCliente = det.precio_final || 0
      const precioNeto = det.precio_base > 0
        ? det.precio_base
        : round2(precioAlCliente / (1 + IVA_RATE))

      let precioUnitario: number
      let ivaUnitario: number
      let ivaIncluido: boolean

      if (vaEnComprobante === "factura") {
        // Factura: la línea muestra el neto, el IVA se discrimina al pie
        // precio_final = $100 (con IVA) → línea = $82.64, IVA = $17.36
        precioUnitario = precioNeto
        ivaUnitario    = round2(precioAlCliente - precioNeto)
        ivaIncluido    = false
      } else {
        // Presupuesto/Reversa: precio final con IVA incluido, sin discriminar
        precioUnitario = precioAlCliente
        ivaUnitario    = 0
        ivaIncluido    = true
      }

      const subtotalNeto  = round2(precioUnitario * det.cantidad)
      const subtotalIva   = round2(ivaUnitario * det.cantidad)
      const subtotalFinal = round2(subtotalNeto + subtotalIva)

      const segmento = detectarSegmento(art)
      const precioBase = det.precio_base > 0 ? det.precio_base : round2(precioAlCliente / (1 + IVA_RATE))
      itemsCalculados.push({
        detalle_id: det.id,
        articulo_id: det.articulo_id,
        descripcion: art.descripcion || "",
        sku: art.sku || "",
        cantidad: det.cantidad,
        precioUnitario,
        precioAntesIva: precioUnitario,
        precioBase,
        precioFinal: precioAlCliente,
        ivaUnitario,
        ivaIncluido,
        subtotalNeto,
        subtotalIva,
        subtotalFinal,
        descNegroAplicado: false,
        vaEnComprobante,
        segmento,
        esBonificado: det.es_bonificado === true,
        marcaId: (art as any).marca_id ?? null,
        proveedorId: (art as any).proveedor_id ?? null,
        ivaCompras: art.iva_compras ?? null,
        ivaVentas: art.iva_ventas ?? null,
      })
    }

    // ─── 4. Cargar bonificaciones general + viajante del cliente ───
    const { data: bonificacionesCliente } = await supabase
      .from("bonificaciones")
      .select("tipo, porcentaje, segmento")
      .eq("cliente_id", pedido.cliente.id)
      .eq("activo", true)
      .in("tipo", ["general", "viajante"])

    // ─── Agrupar items por (vaEnComprobante, perfil de descuento) ───
    const grupos = new Map<string, typeof itemsCalculados>()
    for (const item of itemsCalculados) {
      const bonifProfile = getBonifProfile(item.segmento, bonificacionesCliente || [])
      const key = `${item.vaEnComprobante}__${bonifProfile}`
      if (!grupos.has(key)) grupos.set(key, [])
      grupos.get(key)!.push(item)
    }

    const comprobantesGenerados: Array<any & { _segmento?: string; _bonifs?: any[] }> = []
    const tipoFactura = determinarTipoFactura(pedido.cliente.condicion_iva)

    // ─── 5. Generar un comprobante por grupo ───
    for (const [key, grupoItems] of grupos) {
      const vaEnComp = key.split("__")[0] as "factura" | "presupuesto"
      const tipo = vaEnComp === "factura" ? tipoFactura : "PRES"
      const resultado = await generarComprobante(supabase, pedido, grupoItems, tipo, auth.user.id)
      const segmentoGrupo = grupoItems[0].segmento
      const bonifAplicables = (bonificacionesCliente || []).filter(
        (b: any) => !b.segmento || b.segmento === segmentoGrupo
      )
      comprobantesGenerados.push({ ...resultado, _segmento: segmentoGrupo, _bonifs: bonifAplicables, _items: grupoItems })
    }

    // ── Kardex: vincular entradas existentes o crear si no existen ────────────
    // Entries may already exist from createPedido (session client, may have failed
    // silently due to RLS). Here we use admin client so it always succeeds.
    const { count: kardexCount } = await supabase
      .from('kardex')
      .select('id', { count: 'exact', head: true })
      .eq('pedido_id', pedido_id)

    if ((kardexCount ?? 0) > 0) {
      // Entries exist: just link them to the comprobante
      for (const comp of comprobantesGenerados) {
        if (!comp.id) continue
        const esP = comp.tipo_comprobante === 'PRES'
        await vincularKardexAComprobante(
          supabase, pedido_id, comp.id, comp.tipo_comprobante,
          comp.numero, esP ? 'Presupuesto' : 'Factura', esP ? 'NEGRO' : 'BLANCO',
          auth.user.id,
        )
      }
    } else {
      // No entries: create them now with full comprobante data (admin client bypasses RLS)
      for (const comp of comprobantesGenerados) {
        if (!comp.id) continue
        const esP = comp.tipo_comprobante === 'PRES'
        const colorDinero = esP ? 'NEGRO' : 'BLANCO'
        const metodoFact = esP ? 'Presupuesto' : 'Factura'
        for (const item of (comp._items as ItemCalculado[])) {
          const ivaPct = !item.ivaIncluido && item.ivaUnitario > 0 ? 21 : 0
          await insertarKardex(supabase, {
            tipo_movimiento: 'venta',
            fecha: nowArgentina(),
            articulo_id: item.articulo_id,
            cantidad: item.cantidad,
            precio_lista: item.precioBase,
            precio_unitario_final: item.precioFinal,
            iva_porcentaje: ivaPct,
            iva_monto_unitario: item.ivaUnitario,
            iva_incluido: item.ivaIncluido,
            subtotal_neto: round2(item.precioBase * item.cantidad),
            subtotal_iva: item.subtotalIva,
            subtotal_total: item.subtotalFinal,
            cliente_id: pedido.cliente.id,
            vendedor_id: (pedido.cliente as any).vendedor_id ?? null,
            pedido_id: pedido_id,
            comprobante_venta_id: comp.id,
            tipo_comprobante: comp.tipo_comprobante,
            numero_comprobante: comp.numero,
            metodo_facturacion: metodoFact,
            color_dinero: colorDinero,
            va_en_comprobante: item.vaEnComprobante,
            provincia_destino: (pedido.cliente as any).provincia ?? null,
            facturador_id: auth.user.id,
          }, {
            sku: item.sku,
            descripcion: item.descripcion,
            categoria: item.segmento,
            marca_id: item.marcaId,
            proveedor_id: item.proveedorId,
            iva_compras: item.ivaCompras,
            iva_ventas: item.ivaVentas,
          })
        }
      }
    }

    // ── Distribuir percepciones IVA/IIBB del comprobante entre ítems del kardex
    const percIva = comprobantesGenerados.reduce((s: number, c: any) => s + (c.percepcion_iva ?? 0), 0)
    const percIibb = comprobantesGenerados.reduce((s: number, c: any) => s + (c.percepcion_iibb ?? 0), 0)
    if (percIva > 0 || percIibb > 0) {
      await distribuirPercepcionesKardex(supabase, pedido_id, percIva, percIibb)
    }

    // ── Vincular comisión al comprobante principal ────────────────────────────
    if (comprobantesGenerados.length > 0 && comprobantesGenerados[0].id) {
      await supabase
        .from("comisiones")
        .update({ comprobante_venta_id: comprobantesGenerados[0].id })
        .eq("pedido_id", pedido_id)
        .is("comprobante_venta_id", null)
    }

    // ─── 6. Actualizar total del pedido ───
    const totalPedido = itemsCalculados.reduce((sum, i) => sum + i.subtotalFinal, 0)

    // ─── 7. Aplicar bonificaciones por comprobante (filtradas por segmento) + bonif mercadería ───
    const bonifArticuloId = await getBonificacionArticuloId(supabase)
    for (const comp of comprobantesGenerados) {
      if (!comp.id) continue
      const esPresupuesto = comp.tipo_comprobante === "PRES"
      const grupoItems: typeof itemsCalculados = comp._items || []
      const bonifAplicables: any[] = comp._bonifs || []

      let descuentoTotal = 0
      const lineas: { descripcion: string; monto: number }[] = []

      // Bonif mercadería: ítems bonificados al precio real → se descuenta el 100% de su subtotal
      const totalBonificados = grupoItems
        .filter(i => i.esBonificado)
        .reduce((sum, i) => sum + i.subtotalFinal, 0)
      if (totalBonificados > 0) {
        lineas.push({ descripcion: "Bonificación Mercadería 100%", monto: totalBonificados })
        descuentoTotal = round2(descuentoTotal + totalBonificados)
      }

      // Bonif general + viajante: se aplican sobre la base SIN los ítems bonificados (sólo ítems normales)
      const baseNormal = round2((comp.total ?? comp.total_neto + (comp.total_iva ?? 0)) - totalBonificados)
      for (const bonif of bonifAplicables) {
        const monto = round2(baseNormal * bonif.porcentaje / 100)
        const label = bonif.tipo === "general" ? "Bonificación General" : "Desc. Viajante"
        lineas.push({ descripcion: `${label} ${bonif.porcentaje}%`, monto })
        descuentoTotal = round2(descuentoTotal + monto)
      }

      if (descuentoTotal > 0) {
        const detalleInserts = lineas.map(l => ({
          comprobante_id: comp.id,
          articulo_id: bonifArticuloId,
          descripcion: l.descripcion,
          cantidad: 1,
          precio_unitario: -l.monto,
          precio_total: -l.monto,
        }))
        await supabase.from("comprobantes_venta_detalle").insert(detalleInserts)

        const descNeto = esPresupuesto ? descuentoTotal : round2(descuentoTotal / (1 + IVA_RATE))
        const descIva = esPresupuesto ? 0 : round2(descuentoTotal - descNeto)
        await supabase.from("comprobantes_venta").update({
          total_neto: round2(comp.total_neto - descNeto),
          total_iva: round2((comp.total_iva ?? 0) - descIva),
          total_factura: round2((comp.total ?? comp.total_neto + (comp.total_iva ?? 0)) - descuentoTotal),
          saldo_pendiente: round2((comp.total ?? comp.total_neto + (comp.total_iva ?? 0)) - descuentoTotal),
        }).eq("id", comp.id)
      }

      // Reduce viajante commission proportionally
      const bonifViajante = bonifAplicables.filter((b: any) => b.tipo === "viajante")
      if (bonifViajante.length > 0) {
        const { data: comision } = await supabase
          .from("comisiones")
          .select("id, monto, porcentaje")
          .eq("pedido_id", pedido_id)
          .maybeSingle()
        if (comision && comision.porcentaje > 0) {
          let montoReducido = comision.monto
          for (const bv of bonifViajante) {
            const reduccionPct = (bv.porcentaje * 100) / comision.porcentaje
            montoReducido = round2(montoReducido * (1 - reduccionPct / 100))
          }
          await supabase.from("comisiones").update({ monto: montoReducido }).eq("id", comision.id)
        }
      }
    }

    // ─── 8. Generar bonificación pago contado si corresponde ───
    let bonificacion = null
    if (pago_contado && comprobantesGenerados.length > 0) {
      const comprobanteIds = comprobantesGenerados.map((c: any) => c.id).filter(Boolean)
      bonificacion = await generarBonificacionContado(supabase, {
        cliente_id: pedido.cliente.id,
        comprobante_ids: comprobanteIds,
      })
    }

    return NextResponse.json({
      success: true,
      comprobantes: comprobantesGenerados,
      metodo_facturacion: metodoFacturacion,
      total_pedido: round2(totalPedido),
      bonificacion_contado: bonificacion,
    })
  } catch (error: any) {
    console.error("[Generar Comprobantes] Error:", error)
    return NextResponse.json({ error: error.message || "Error generando comprobantes" }, { status: 500 })
  }
}

// ─── Helpers ───────────────────────────────────────────

function detectarSegmento(art: { categoria?: string | null; iva_compras?: string | null; segmento_precio?: string | null }): string {
  // segmento_precio is the canonical field. Falling back to the legacy categoria string
  // only handles the edge case where segmento_precio is not yet set on an article.
  const esPerfumeria =
    art.segmento_precio === "perfumeria" ||
    (art.categoria || "").toUpperCase().includes("PERFUMERIA") ||
    (art.categoria || "").toUpperCase().includes("PERFUMERÍA")
  if (esPerfumeria)
    return art.iva_compras === "adquisicion_stock" ? "perf0" : "perf_plus"
  return "limpieza_bazar"
}

function getBonifProfile(itemSegmento: string, bonificaciones: any[]): string {
  const aplicables = bonificaciones.filter((b: any) => !b.segmento || b.segmento === itemSegmento)
  return aplicables
    .sort((a: any, b: any) => a.tipo.localeCompare(b.tipo))
    .map((b: any) => `${b.tipo}:${b.porcentaje}`)
    .join("|")
}

function determinarTipoFactura(condicionIva: string): string {
  const c = (condicionIva || "").toLowerCase()
  if (c.includes("responsable inscri")) return "FA"
  if (c.includes("monotributo")) return "FB"
  return "FC"
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function generarComprobante(
  supabase: any,
  pedido: any,
  items: Array<{
    articulo_id: string; descripcion: string; sku: string
    cantidad: number; precioUnitario: number; precioAntesIva: number
    ivaUnitario: number; ivaIncluido: boolean
    subtotalNeto: number; subtotalIva: number; subtotalFinal: number
    descNegroAplicado: boolean
  }>,
  tipoComprobante: string,
  creadoPor?: string,
) {
  // Obtener numeración
  const { data: numeracion, error: numError } = await supabase
    .from("numeracion_comprobantes")
    .select("*")
    .eq("tipo_comprobante", tipoComprobante)
    .eq("punto_venta", "0001")
    .single()

  if (numError) throw new Error(`Numeración no encontrada para ${tipoComprobante}. Verificá la tabla numeracion_comprobantes.`)

  const nuevoNumero = numeracion.ultimo_numero + 1
  const numeroComprobante = `${numeracion.punto_venta}-${nuevoNumero.toString().padStart(8, "0")}`

  // Calcular totales del comprobante
  const esPresupuesto = tipoComprobante === "PRES"

  let totalNeto = 0
  let totalIva = 0

  for (const item of items) {
    if (esPresupuesto) {
      // En presupuesto: si tiene IVA incluido (blanco en presupuesto), el total ya lo incluye
      totalNeto += item.subtotalNeto
      // No discriminamos IVA en presupuesto
    } else {
      // En factura: neto + IVA discriminado
      totalNeto += round2(item.precioAntesIva * item.cantidad)
      totalIva += item.subtotalIva
    }
  }

  totalNeto = round2(totalNeto)
  totalIva = round2(totalIva)
  const totalFactura = round2(totalNeto + totalIva)

  // Crear comprobante
  const { data: comprobante, error: compError } = await supabase
    .from("comprobantes_venta")
    .insert({
      tipo_comprobante: tipoComprobante,
      numero_comprobante: numeroComprobante,
      punto_venta: numeracion.punto_venta,
      fecha: todayArgentina(),
      cliente_id: pedido.cliente_id,
      pedido_id: pedido.id,
      total_neto: totalNeto,
      total_iva: totalIva,
      total_factura: totalFactura,
      saldo_pendiente: totalFactura,
      estado_pago: "pendiente",
      ...(creadoPor ? { creado_por: creadoPor } : {}),
    })
    .select("id, percepcion_iva, percepcion_iibb")
    .single()

  if (compError) throw new Error("Error creando comprobante: " + compError.message)

  // Crear detalle
  const detalleInserts = items.map(item => ({
    comprobante_id: comprobante.id,
    articulo_id: item.articulo_id,
    descripcion: item.descripcion,
    cantidad: item.cantidad,
    precio_unitario: item.precioUnitario,
    precio_total: item.subtotalNeto,
  }))

  const { error: detError } = await supabase.from("comprobantes_venta_detalle").insert(detalleInserts)
  if (detError) throw new Error("Error creando detalle: " + detError.message)

  // Descontar stock y registrar movimiento
  for (const item of items) {
    await supabase.rpc("increment_stock_actual", {
      p_articulo_id: item.articulo_id,
      p_cantidad: -item.cantidad,
    }).then(() => {})  // Ignorar error si la función no existe

    await supabase.from("movimientos_stock").insert({
      articulo_id: item.articulo_id,
      tipo_movimiento: "salida",
      cantidad: item.cantidad,
      precio_unitario: item.precioUnitario,
      fecha_movimiento: nowArgentina(),
      observaciones: `Venta - ${tipoComprobante} ${numeroComprobante}`,
    })
  }

  // Actualizar numeración
  await supabase
    .from("numeracion_comprobantes")
    .update({ ultimo_numero: nuevoNumero })
    .eq("tipo_comprobante", tipoComprobante)
    .eq("punto_venta", numeracion.punto_venta)

  return {
    tipo: "comprobante",
    id: comprobante.id,
    tipo_comprobante: tipoComprobante,
    numero: numeroComprobante,
    total_neto: totalNeto,
    total_iva: totalIva,
    total: totalFactura,
    percepcion_iva: comprobante.percepcion_iva ?? 0,
    percepcion_iibb: comprobante.percepcion_iibb ?? 0,
  }
}
