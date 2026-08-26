import { insertarKardex } from "./insertar-kardex"
import { buildKardexDescuentos } from "./descuentos"
import { getComisionPorcentaje, calcularComisionMonto } from "@/lib/comisiones/calcular"
import { nowArgentina } from "@/lib/utils"

/**
 * Sincroniza el kardex de un pedido con sus renglones (pedidos_detalle).
 *
 * Regla: el kardex es el ESPEJO de los renglones mientras el pedido no está
 * facturado. Cada vez que cambian (reprecio por cabecera —lista, método,
 * descuentos por segmento—, cantidad, alta/baja de artículo, mercadería
 * bonificada) el kardex se vuelve a alinear:
 *   - línea que existe y cambió  → se actualiza (precios, desglose de
 *     descuentos, IVA, subtotales, comisión del viajante)
 *   - renglón sin línea          → se crea
 *   - línea sin renglón          → se elimina (con su comisión "vendida" no paga)
 *
 * Las líneas ya vinculadas a un comprobante VIVO no se tocan: el comprobante
 * es la verdad de lo vendido y el kardex tiene que seguir reflejándolo. Por
 * eso al facturar se llama a este sincronizador ANTES de vincular.
 *
 * Emparejamiento renglón ↔ línea: por artículo y por "es mercadería
 * bonificada" (kardex.descuento_mercaderia_pct = 100).
 *
 * `admin` debe ser el service role (el kardex no es visible con RLS de sesión).
 */
export interface ResultadoSincKardex {
  actualizadas: number
  creadas: number
  eliminadas: number
  congeladas: number
}

type VendedorComisiones = {
  comision_limpieza_bazar: number
  comision_perfumeria_0: number
  comision_perfumeria_plus: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const esBlanco = (m: string | null | undefined) => m === "Factura (21% IVA)" || m === "Factura"
const claveDe = (articuloId: string, bonif: boolean) => `${articuloId}|${bonif ? 1 : 0}`

const DETALLE_COLS =
  "id, articulo_id, cantidad, estado_item, es_bonificado, precio_base, precio_final, precio_lista, " +
  "descuento_propio_pct, bonif_general_pct, bonif_viajante_pct, lista_precio_id, metodo_facturacion_item, precio_costo, " +
  "articulos:articulo_id(id, sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas, segmento_precio, stock_actual, precio_compra)"

/** Valores de kardex que salen de un renglón (misma cascada que createPedido / agregarItemPedido / agregarItemBonificado). */
function valoresLinea(
  det: any,
  vend: VendedorComisiones | null,
  metodoPedido: string | null,
  listaPedido: string | null,
) {
  const art = det.articulos || {}
  const cantidad = Number(det.cantidad || 0)
  const bonif = det.es_bonificado === true
  const oferta = Number(det.descuento_propio_pct || 0)
  const g = bonif ? 0 : Number(det.bonif_general_pct || 0)
  const v = Number(det.bonif_viajante_pct || 0)
  const neto = Number(det.precio_base || 0)
  const alCliente = Number(det.precio_final || 0)
  const listaBruto = Number(det.precio_lista || 0)

  // precio_lista del kardex = P.Lista post-oferta, PRE-bonificación (no altera el margen)
  const factor = (1 - g / 100) * (1 - v / 100)
  const precioLista = listaBruto > 0
    ? r2(listaBruto * (1 - oferta / 100))
    : bonif || factor <= 0 ? neto : r2(neto / factor)

  const metodoRaw: string | null = det.metodo_facturacion_item || metodoPedido || null
  const color = esBlanco(metodoRaw) ? "BLANCO" : "NEGRO"
  const precioCosto = det.precio_costo ?? art.precio_compra ?? null

  // Comisión del viajante embebida (fórmula única: tasa = comisión% − viajante%).
  // En mercadería bonificada es NEGATIVA: no se cobra comisión por lo regalado.
  // Sin comisión → 0 (no null): el trigger de comisiones toma COALESCE(monto, viejo).
  const comision = (() => {
    if (!vend || !art.segmento_precio) return { comision_viajante_pct: 0, comision_viajante_monto: 0 }
    const pct = getComisionPorcentaje(vend, art.segmento_precio, art.iva_ventas)
    if (pct <= 0 && v <= 0) return { comision_viajante_pct: 0, comision_viajante_monto: 0 }
    const { monto, tasaEfectivaPct } = calcularComisionMonto({
      precioNetoUnitario: neto,
      cantidad,
      metodoFacturacion: metodoRaw,
      ivaVentas: art.iva_ventas,
      comisionPct: pct,
      viajantePct: v,
    })
    return { comision_viajante_pct: tasaEfectivaPct, comision_viajante_monto: bonif ? -monto : monto }
  })()

  const margen = precioCosto != null && Number(precioCosto) > 0
    ? {
        margen_unitario: r2(precioLista - Number(precioCosto)),
        margen_porcentaje: precioLista > 0 ? r2(((precioLista - Number(precioCosto)) / precioLista) * 100) : null,
      }
    : { margen_unitario: null, margen_porcentaje: null }

  const comunes = {
    cantidad,
    precio_costo: precioCosto,
    lista_precio_id: det.lista_precio_id || listaPedido || null,
    metodo_facturacion: metodoRaw,
    color_dinero: color,
    ...comision,
    ...margen,
  }

  if (bonif) {
    return {
      ...comunes,
      precio_lista: precioLista,
      precio_unitario_final: 0,
      iva_porcentaje: 0,
      iva_monto_unitario: 0,
      iva_incluido: false,
      descuentos_json: [{ tipo: "mercaderia" as const, porcentaje: 100, monto_unitario: precioLista }],
      descuento_oferta_pct: null,
      descuento_oferta_monto: null,
      descuento_mercaderia_pct: 100,
      descuento_mercaderia_monto: precioLista,
      descuento_general_pct: null,
      descuento_general_monto: null,
      descuento_viajante_pct: null,
      descuento_viajante_monto: null,
      subtotal_neto: 0,
      subtotal_iva: 0,
      subtotal_total: 0,
    }
  }

  const desc = buildKardexDescuentos(precioLista, neto, oferta, g, v)
  const ivaIncluido = alCliente === neto
  const ivaMonto = ivaIncluido ? 0 : r2(alCliente - neto)
  const ivaPct = ivaMonto > 0 && neto > 0 ? Math.round((ivaMonto / neto) * 10000) / 100 : 0
  return {
    ...comunes,
    precio_lista: desc.precio_lista,
    precio_unitario_final: alCliente,
    iva_porcentaje: ivaPct,
    iva_monto_unitario: ivaMonto,
    iva_incluido: ivaIncluido,
    descuentos_json: desc.descuentos_json.length ? desc.descuentos_json : null,
    descuento_oferta_pct: desc.descuento_oferta_pct,
    descuento_oferta_monto: desc.descuento_oferta_monto,
    descuento_mercaderia_pct: null,
    descuento_mercaderia_monto: null,
    descuento_general_pct: desc.descuento_general_pct,
    descuento_general_monto: desc.descuento_general_monto,
    descuento_viajante_pct: desc.descuento_viajante_pct,
    descuento_viajante_monto: desc.descuento_viajante_monto,
    subtotal_neto: r2(neto * cantidad),
    subtotal_iva: r2(ivaMonto * cantidad),
    subtotal_total: r2(alCliente * cantidad),
  }
}

export async function sincronizarKardexPedido(
  admin: any,
  pedidoId: string,
  opts: {
    operadorId?: string | null
    /** Mantenimiento: también re-alinea las líneas vinculadas a un comprobante
     *  VIVO (conserva el vínculo, corrige valores). Solo para reparar pedidos
     *  facturados con kardex viejo — nunca desde el circuito normal. */
    forzarVinculadas?: boolean
  } = {},
): Promise<ResultadoSincKardex> {
  const res: ResultadoSincKardex = { actualizadas: 0, creadas: 0, eliminadas: 0, congeladas: 0 }

  const { data: pedido, error: pedErr } = await admin
    .from("pedidos")
    .select("id, numero_pedido, estado, cliente_id, vendedor_id, metodo_facturacion_pedido, lista_precio_pedido_id, clientes:cliente_id(vendedor_id, provincia, metodo_facturacion, lista_precio_id)")
    .eq("id", pedidoId)
    .maybeSingle()
  if (pedErr) throw new Error(pedErr.message)
  if (!pedido || pedido.estado === "eliminado") return res

  const cli = (pedido.clientes as any) || {}
  const vendedorId: string | null = pedido.vendedor_id || cli.vendedor_id || null
  const metodoPedido: string | null = pedido.metodo_facturacion_pedido || cli.metodo_facturacion || null
  const listaPedido: string | null = pedido.lista_precio_pedido_id || cli.lista_precio_id || null

  const [detRes, kRes, vendRes] = await Promise.all([
    admin.from("pedidos_detalle").select(DETALLE_COLS).eq("pedido_id", pedidoId),
    admin
      .from("kardex")
      .select("id, articulo_id, comprobante_venta_id, descuento_mercaderia_pct, created_at")
      .eq("pedido_id", pedidoId)
      .eq("tipo_movimiento", "venta")
      .order("created_at"),
    vendedorId
      ? admin.from("vendedores").select("comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus").eq("id", vendedorId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (detRes.error) throw new Error(detRes.error.message)
  if (kRes.error) throw new Error(kRes.error.message)
  const detalle: any[] = detRes.data || []
  const kardexRows: any[] = kRes.data || []
  const vend: VendedorComisiones | null = (vendRes as any)?.data ?? null

  // Líneas congeladas: vinculadas a un comprobante vivo (no anulado)
  const cbteIds = [...new Set(kardexRows.map((k) => k.comprobante_venta_id).filter(Boolean))] as string[]
  const vivos = new Set<string>()
  if (cbteIds.length) {
    const { data: cbtes } = await admin.from("comprobantes_venta").select("id, anulado_en").in("id", cbteIds)
    for (const c of cbtes || []) if (!c.anulado_en) vivos.add(c.id)
  }
  const congelada = (k: any) => !opts.forzarVinculadas && !!k.comprobante_venta_id && vivos.has(k.comprobante_venta_id)

  const detPorClave = new Map<string, any[]>()
  for (const d of detalle) {
    if (d.estado_item === "FALTANTE" || Number(d.cantidad || 0) <= 0) continue
    const k = claveDe(d.articulo_id, d.es_bonificado === true)
    if (!detPorClave.has(k)) detPorClave.set(k, [])
    detPorClave.get(k)!.push(d)
  }
  const libresPorClave = new Map<string, any[]>()
  const clavesCongeladas = new Set<string>()
  for (const k of kardexRows) {
    const clave = claveDe(k.articulo_id, Number(k.descuento_mercaderia_pct || 0) >= 100)
    if (congelada(k)) {
      res.congeladas++
      clavesCongeladas.add(clave)
      continue
    }
    if (!libresPorClave.has(clave)) libresPorClave.set(clave, [])
    libresPorClave.get(clave)!.push(k)
  }

  const eliminarLinea = async (kardexId: string) => {
    // La FK comisiones.kardex_id es ON DELETE SET NULL: si no se borra antes,
    // la comisión "vendida" quedaría huérfana (y contaría para el viajante).
    await admin.from("comisiones").delete().eq("kardex_id", kardexId).eq("pagado", false).eq("tipo", "vendida")
    const { error } = await admin.from("kardex").delete().eq("id", kardexId)
    if (error) throw new Error(error.message)
    res.eliminadas++
  }

  for (const [clave, dets] of detPorClave) {
    const libres = libresPorClave.get(clave) || []
    for (let i = 0; i < dets.length; i++) {
      const det = dets[i]
      const art = det.articulos || {}
      const valores = valoresLinea(det, vend, metodoPedido, listaPedido)
      const existente = libres[i]
      if (existente) {
        // Línea que apuntaba a un comprobante ANULADO: se desvincula (la
        // anulación no toca el kardex) para que al volver a facturar el
        // pedido se enganche al comprobante nuevo. Solo se limpia el vínculo;
        // la línea sigue siendo la misma venta.
        const desvincular =
          existente.comprobante_venta_id && !vivos.has(existente.comprobante_venta_id)
            ? { comprobante_venta_id: null, tipo_comprobante: null, numero_comprobante: null, comprobante_cobrado: false, fecha_comprobante_cobrado: null }
            : {}
        const { error } = await admin
          .from("kardex")
          .update({
            ...valores,
            ...desvincular,
            cliente_id: pedido.cliente_id,
            vendedor_id: vendedorId,
            numero_pedido: pedido.numero_pedido ?? null,
            provincia_destino: cli.provincia ?? null,
          })
          .eq("id", existente.id)
        if (error) throw new Error(error.message)
        // El trigger de kardex sincroniza monto/% de la comisión; cantidad,
        // neto y viajante los alineamos acá (solo comisiones no pagas).
        await admin
          .from("comisiones")
          .update({
            cantidad: valores.cantidad,
            precio_neto_unitario: Number(det.precio_base || 0),
            ...(vendedorId ? { viajante_id: vendedorId } : {}),
          })
          .eq("kardex_id", existente.id)
          .eq("pagado", false)
          .eq("tipo", "vendida")
        res.actualizadas++
      } else if (clavesCongeladas.has(clave)) {
        // Ya está reflejado en una línea vinculada a un comprobante vivo.
        continue
      } else {
        const stockActual = art.stock_actual ?? null
        await insertarKardex(
          admin,
          {
            tipo_movimiento: "venta",
            fecha: nowArgentina(),
            articulo_id: det.articulo_id,
            ...valores,
            descuentos_json: valores.descuentos_json ?? undefined,
            cliente_id: pedido.cliente_id,
            vendedor_id: vendedorId,
            provincia_destino: cli.provincia ?? null,
            pedido_id: pedidoId,
            numero_pedido: pedido.numero_pedido ?? null,
            stock_antes: stockActual,
            stock_despues: stockActual !== null ? stockActual - valores.cantidad : null,
            operador_id: opts.operadorId ?? null,
          },
          {
            sku: art.sku,
            descripcion: art.descripcion,
            categoria: art.categoria,
            marca_id: art.marca_id,
            proveedor_id: art.proveedor_id,
            iva_compras: art.iva_compras,
            iva_ventas: art.iva_ventas,
          },
        )
        res.creadas++
      }
    }
    // Líneas de más para este artículo (duplicadas): fuera
    for (let i = dets.length; i < libres.length; i++) await eliminarLinea(libres[i].id)
    libresPorClave.delete(clave)
  }
  // Líneas libres cuyo artículo ya no está en el pedido: fuera
  for (const libres of libresPorClave.values()) for (const k of libres) await eliminarLinea(k.id)

  return res
}
