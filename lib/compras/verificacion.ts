/**
 * Verificación de una orden de compra: lo PEDIDO contra lo RECIBIDO contra lo FACTURADO,
 * artículo por artículo. La arma el servidor (GET /api/ordenes-compra/[id]/verificacion)
 * con la misma cuenta que usa para resolver (lib/compras/diferencias.ts): la pantalla
 * solo muestra.
 *
 * Todo en UNIDADES base y precios NETOS por unidad.
 *
 * Qué es una diferencia (prueba en pantalla del 17/11):
 *   · precio      facturado a otro precio que el acordado (lo bonificado no cuenta: E-42)
 *   · cantidad    facturado ≠ recibido (faltante reclamable, o sobrante)
 *   · pendiente   la orden pedía más de lo que llegó y se facturó (E-92): NO es "OK";
 *                 sigue abierta hasta que llegue el resto o la orden se cierre sin él
 *   · no_pedido   llegó o se facturó algo que la orden no pedía (E-43)
 *   · sin_documentar  se recibió y ningún comprobante lo trae
 *
 * Archivo PURO. Tests: mobile/packages/core/test/entrada-verificacion.test.ts
 */

import { totalesOC } from "./oc-totales"
import { calcularDiferencia, combinarLineasOC, costoDeFicha, netoCompra, type CostoFicha, type DiferenciaLinea, type LineaFactura, type TipoDescuento } from "./diferencias"
import { esAdquisicion, esComprobanteConPrecios, esRemito } from "./finalizar-oc"

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const upbDe = (v: unknown) => (num(v) > 1 ? num(v) : 1)

const ES_CREDITO = ["NC", "NCA", "NCB", "NCC", "Reversa"]
const ES_DEBITO_NOTA = ["ND", "NDA", "NDB", "NDC"]

export interface DatosVerificacion {
  /** Cómo aplica los descuentos el proveedor de la orden (su ficha). Sin dato: en cascada. */
  tipo_descuento?: TipoDescuento | null
  /**
   * Total sin impuestos que la orden tiene GUARDADO (`ordenes_compra.total_neto`, lo escribe
   * oc_guardar). Es el mismo número que muestran la orden, el PDF y el mail. null = orden anterior
   * a que se guardara: se calcula con la misma cuenta (lib/compras/oc-totales.ts).
   */
  total_oc_guardado?: number | null
  ocItems: Array<{
    articulo_id: string; cantidad_pedida: number; tipo_cantidad?: string | null; precio_unitario: number
    descuento1?: number | null; descuento2?: number | null; descuento3?: number | null; descuento4?: number | null
  }>
  articulos: Array<{
    id: string; sku?: string | null; descripcion?: string | null; unidades_por_bulto?: number | null
    /** Costo de la ficha (para valorizar lo no pedido y no facturado) */
    precio_compra?: number | null; descuento1?: number | null; descuento2?: number | null; descuento3?: number | null; descuento4?: number | null
    iva_compras?: string | null
  }>
  comprobantes: Array<{
    id: string; tipo_comprobante: string; numero_comprobante: string; estado: string
    total_factura_declarado?: number | null; total_neto?: number | null; total_iva?: number | null; origen_nc?: string | null
  }>
  detalle: Array<{
    id: string; comprobante_id: string; articulo_id: string | null; cantidad_facturada: number; precio_unitario: number
    descuento1?: number | null; descuento2?: number | null; descuento3?: number | null; descuento4?: number | null
    tipo_cantidad?: string | null; recepcion_item_id?: string | null; iva_porcentaje?: number | null
    match_estado?: string | null; descripcion_proveedor?: string | null
  }>
  /** Líneas de todas las recepciones no canceladas de la orden */
  recItems: Array<{
    id: string; recepcion_id: string; articulo_id: string; cantidad_fisica: number
    /** Unidades base de lo contado (ya convertido por el servidor) */
    unidades: number
    fuera_de_oc?: boolean | null; factor_conversion?: number | null; estado_linea?: string | null
    precio_verificado?: boolean | null; cantidad_diferencia_destino?: string | null
  }>
  /** recepciones_diferencias (vacío si la migración 20261117b no está) */
  resoluciones: Array<{
    recepcion_item_id: string; articulo_id: string; tipo: string; destino: string
    importe_total?: number | null; unidades_devueltas?: number | null; created_at?: string | null; usuario_id?: string | null
  }>
}

export type Bandera = "precio" | "cantidad" | "pendiente" | "no_pedido" | "sin_documentar"

export interface FilaVerificacion {
  articulo_id: string
  sku: string
  descripcion: string
  unidades_por_bulto: number
  /** La línea de la orden está pedida por bulto */
  pedido_por_bulto: boolean
  /** Pedido por bulto y el artículo no tiene unidades por bulto cargadas */
  sin_unidades_por_bulto: boolean
  no_pedido: boolean
  /** Línea de recepción sobre la que se resuelve (la real de la orden, con recepción física) */
  recepcion_item_id: string | null
  recepcion_id: string | null
  /** El depósito marcó que no llegó */
  marcado_faltante: boolean
  /** Por comprobante con renglones del artículo: unidades y neto por unidad */
  por_comprobante: Record<string, { unidades: number; neto_unidad: number }>
  dif: DiferenciaLinea
  /** Lo que sigue SIN resolver. Vacío = OK. */
  banderas: Bandera[]
  resuelto: { precio: string | null; cantidad: string | null }
  /** Costo actual de la ficha del artículo, neto (para lo no pedido y sin factura) */
  costo_ficha: CostoFicha
}

export interface ColumnaComprobante {
  id: string
  tipo: string
  numero: string
  estado: string
  es_remito: boolean
  con_precios: boolean
}

export interface Verificacion {
  filas: FilaVerificacion[]
  /** Comprobantes que tienen renglones (las NC esperadas no: no traen detalle) */
  columnas: ColumnaComprobante[]
  resumen: {
    /** Igual que al crear la orden: neto de cada línea sin redondear, redondeo al final */
    total_oc: number
    /** Comprobantes reales, con IVA: facturas y notas de débito menos notas de crédito */
    total_facturado: number
    /** Notas de crédito que se esperan del proveedor (todavía no llegaron), con IVA */
    nc_esperadas: number
    /** Lo que el proveedor va a facturar por mercadería que llegó de más (notas de débito esperadas), con IVA */
    nd_esperadas: number
    articulos: number
    ok: number
    con_diferencias: number
    /** Renglones de comprobantes sin vincular a un artículo */
    sin_vincular: number
  }
  otros_conceptos: Array<{ comprobante: string; descripcion: string; importe: number }>
}

export function armarVerificacion(d: DatosVerificacion): Verificacion {
  const tipoDto = d.tipo_descuento
  const art = new Map(d.articulos.map((a) => [a.id, a]))
  const comp = new Map(d.comprobantes.map((c) => [c.id, c]))
  // El mismo artículo puede estar en más de un renglón de la orden: se juntan
  const ocPorArt = new Map<string, DatosVerificacion["ocItems"]>()
  for (const i of d.ocItems) ocPorArt.set(i.articulo_id, [...(ocPorArt.get(i.articulo_id) || []), i])
  const recItemPorId = new Map(d.recItems.map((r) => [r.id, r]))
  // Solo cuentan los renglones de comprobantes que siguen existiendo y no son "esperada"
  const detalle = d.detalle.filter((l) => comp.has(l.comprobante_id) && comp.get(l.comprobante_id)!.estado !== "esperada")

  const factorDe = (l: DatosVerificacion["detalle"][number]) => {
    if (l.tipo_cantidad !== "bulto") return 1
    const f = num(recItemPorId.get(l.recepcion_item_id || "")?.factor_conversion)
    return f > 1 ? f : upbDe(art.get(l.articulo_id || "")?.unidades_por_bulto)
  }
  const descuentos = (x: { descuento1?: number | null; descuento2?: number | null; descuento3?: number | null; descuento4?: number | null }) =>
    [x.descuento1, x.descuento2, x.descuento3, x.descuento4].map(num)

  // Artículos: los de la orden, y después lo recibido o facturado que no estaba pedido
  const ids: string[] = [...ocPorArt.keys()]
  const extra = new Set<string>()
  for (const r of d.recItems) if (r.articulo_id && !ocPorArt.has(r.articulo_id) && (num(r.unidades) > 0 || r.fuera_de_oc)) extra.add(r.articulo_id)
  for (const l of detalle) if (l.articulo_id && !ocPorArt.has(l.articulo_id)) extra.add(l.articulo_id)
  ids.push(...extra)

  const hayComprobantesConRenglones = detalle.some((l) => !!l.articulo_id)

  const filas: FilaVerificacion[] = ids.map((articuloId) => {
    const a = art.get(articuloId)
    const renglonesOC = ocPorArt.get(articuloId) || []
    const oc = renglonesOC[0]
    const upb = upbDe(a?.unidades_por_bulto)
    const porBulto = !!oc && renglonesOC.every((x) => x.tipo_cantidad !== "unidad")

    // Recibido: suma de todas las tandas. Las filas fuera_de_oc de un artículo que SÍ está en
    // la orden son duplicados de documentación vieja: no suman.
    const lineasRec = d.recItems.filter((r) => r.articulo_id === articuloId)
    const cuentan = lineasRec.filter((r) => !(r.fuera_de_oc && oc))
    const recibido = cuentan.reduce((s, r) => s + num(r.unidades), 0)
    const preferida =
      cuentan.find((r) => !r.fuera_de_oc && num(r.cantidad_fisica) > 0) || cuentan.find((r) => !r.fuera_de_oc) || cuentan[0] || lineasRec[0] || null

    // Facturado: por comprobante (para las columnas) y los renglones CON precios (para la cuenta)
    const porComprobante: FilaVerificacion["por_comprobante"] = {}
    const lineasFactura: LineaFactura[] = []
    for (const l of detalle) {
      if (l.articulo_id !== articuloId) continue
      const c = comp.get(l.comprobante_id)!
      const f = factorDe(l)
      const unidades = num(l.cantidad_facturada) * f
      const neto = netoCompra(l.precio_unitario, descuentos(l), tipoDto) / f
      const pc = (porComprobante[c.id] ??= { unidades: 0, neto_unidad: 0 })
      pc.unidades += unidades
      if (!pc.neto_unidad && neto > 0) pc.neto_unidad = r2(neto)
      if (esComprobanteConPrecios(c.tipo_comprobante)) {
        lineasFactura.push({ cantidad_facturada: num(l.cantidad_facturada), factor: f, precio_unitario: num(l.precio_unitario), descuentos: descuentos(l), iva_porcentaje: num(l.iva_porcentaje ?? 21), comprobante_id: c.id, comprobante: `${c.tipo_comprobante} ${c.numero_comprobante}`, sin_factura: esAdquisicion(c.tipo_comprobante) })
      }
    }

    const dif = calcularDiferencia({
      tipo_descuento: tipoDto,
      oc: combinarLineasOC(renglonesOC.map((x) => ({ cantidad_pedida: num(x.cantidad_pedida), factor: x.tipo_cantidad !== "unidad" ? upb : 1, precio_unitario: num(x.precio_unitario), descuentos: descuentos(x) }))),
      factura: lineasFactura,
      recibido_unidades: recibido,
    })

    // Qué ya se resolvió (tabla nueva, o las marcas de la línea si la migración no está)
    const res = d.resoluciones.filter((x) => x.articulo_id === articuloId)
    const resuelto = {
      precio: res.find((x) => x.tipo === "precio")?.destino ?? (lineasRec.some((r) => r.precio_verificado) ? "resuelto" : null),
      cantidad: res.find((x) => x.tipo === "cantidad")?.destino ?? lineasRec.find((r) => r.cantidad_diferencia_destino)?.cantidad_diferencia_destino ?? null,
    }

    const banderas: Bandera[] = []
    const noPedido = !oc
    if (dif.precio && !resuelto.precio) banderas.push("precio")
    if (dif.cantidad && !resuelto.cantidad) banderas.push("cantidad")
    if (dif.pendiente_oc > 0) banderas.push("pendiente")
    // Lo no pedido se da por visto al aceptarlo o devolverlo (queda como resolución de cantidad)
    if (noPedido && !resuelto.cantidad) banderas.push("no_pedido")
    // Recibido y ningún comprobante lo trae (habiendo comprobantes con renglones): jamás "OK"
    if (recibido > 0 && Object.keys(porComprobante).length === 0 && hayComprobantesConRenglones && !noPedido) banderas.push("sin_documentar")

    return {
      articulo_id: articuloId,
      sku: a?.sku || "",
      descripcion: a?.descripcion || "",
      unidades_por_bulto: upb,
      pedido_por_bulto: porBulto,
      sin_unidades_por_bulto: porBulto && upb <= 1,
      no_pedido: noPedido,
      recepcion_item_id: preferida?.id ?? null,
      recepcion_id: preferida?.recepcion_id ?? null,
      marcado_faltante: lineasRec.some((r) => r.estado_linea === "faltante"),
      por_comprobante: porComprobante,
      dif,
      banderas,
      resuelto,
      costo_ficha: costoDeFicha(a, tipoDto),
    }
  })

  const conRenglones = new Set(detalle.filter((l) => !!l.articulo_id).map((l) => l.comprobante_id))
  const columnas: ColumnaComprobante[] = d.comprobantes
    .filter((c) => c.estado !== "esperada" && conRenglones.has(c.id))
    .map((c) => ({ id: c.id, tipo: c.tipo_comprobante, numero: c.numero_comprobante, estado: c.estado, es_remito: esRemito(c.tipo_comprobante), con_precios: esComprobanteConPrecios(c.tipo_comprobante) }))

  // Total de la orden: el guardado; si no hay, la MISMA cuenta que usa la orden (renglón =
  // unidades × neto sin redondear, redondeado a centavos). Así no hay centavos de diferencia
  // entre la orden y la verificación.
  const totalOC = d.total_oc_guardado != null && Number.isFinite(Number(d.total_oc_guardado))
    ? num(d.total_oc_guardado)
    : totalesOC(d.ocItems.map((i) => ({ ...i, unidades_por_bulto: art.get(i.articulo_id)?.unidades_por_bulto ?? null })), { tipo_descuento: tipoDto }).neto
  let totalFacturado = 0
  let ncEsperadas = 0
  let ndEsperadas = 0
  for (const c of d.comprobantes) {
    const total = num(c.total_factura_declarado)
    if (c.estado === "esperada") {
      if (ES_DEBITO_NOTA.includes(c.tipo_comprobante)) ndEsperadas += total
      else ncEsperadas += total
    }
    else if (esRemito(c.tipo_comprobante)) continue
    else if (ES_CREDITO.includes(c.tipo_comprobante)) totalFacturado -= total
    else if (ES_DEBITO_NOTA.includes(c.tipo_comprobante) || esComprobanteConPrecios(c.tipo_comprobante)) totalFacturado += total
  }

  const ok = filas.filter((f) => f.banderas.length === 0).length
  return {
    filas,
    columnas,
    resumen: {
      total_oc: r2(totalOC),
      total_facturado: r2(totalFacturado),
      nc_esperadas: r2(ncEsperadas),
      nd_esperadas: r2(ndEsperadas),
      articulos: filas.length,
      ok,
      con_diferencias: filas.length - ok,
      sin_vincular: detalle.filter((l) => !l.articulo_id && l.match_estado !== "no_mercaderia").length,
    },
    otros_conceptos: detalle
      .filter((l) => l.match_estado === "no_mercaderia")
      .map((l) => {
        const c = comp.get(l.comprobante_id)!
        return {
          comprobante: `${c.tipo_comprobante} ${c.numero_comprobante}`,
          descripcion: l.descripcion_proveedor || "(sin descripción)",
          importe: r2(num(l.cantidad_facturada) * netoCompra(l.precio_unitario, descuentos(l), tipoDto)),
        }
      }),
  }
}
