/**
 * ¿Se puede FINALIZAR (cerrar) una orden de compra?
 *
 * Decisión de Juan (17/11/2026): "sin precio no deberíamos poder validar una orden de
 * compra. Lo que sí podemos es validar cantidades, pero no nos debería permitir cerrar
 * la OC". Un remito controla cantidades; para cerrar hace falta la factura.
 *
 * Reglas (las aplica el servidor en POST /api/ordenes-compra/[id]/finalizar; la pantalla
 * usa el mismo resultado para avisar antes):
 *   1. Tiene que haber al menos un comprobante CON precios (factura o adquisición) VALIDADO.
 *   2. No puede quedar ningún comprobante con precios, nota de crédito o de débito sin validar.
 *   3. Toda la mercadería recibida tiene que figurar en algún comprobante con precios
 *      validado (por artículo: las diferencias de cantidad se resuelven aparte, en la
 *      verificación).
 * Los remitos no cuentan para ninguna: ni cubren, ni frenan.
 */

/** Comprobantes que traen precios: con ellos se controlan cantidades Y precios. */
/**
 * Adquisición (compra sin factura, canal negro). El valor es "Adquisicion"; hasta el 18/11 el
 * procesador de mails la guardaba como "ADQ" y esos comprobantes siguen en la base: al LEER se
 * aceptan los dos, al escribir va siempre "Adquisicion".
 */
export const TIPOS_ADQUISICION = ["Adquisicion", "ADQ"]
export const esAdquisicion = (tipo: unknown) => TIPOS_ADQUISICION.includes(String(tipo || ""))

export const TIPOS_CON_PRECIOS = ["FA", "FB", "FC", ...TIPOS_ADQUISICION]
export const esComprobanteConPrecios = (tipo: unknown) => TIPOS_CON_PRECIOS.includes(String(tipo || ""))
export const esRemito = (tipo: unknown) => String(tipo || "") === "Remito"

const VALIDADO = ["validado", "cerrado"]

export interface ComprobanteOC {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  estado: string
}

export interface ControlFinalizarOC {
  puede: boolean
  /** Motivos, en palabras para la oficina. Vacío = se puede finalizar. */
  faltas: string[]
  /** true = lo único que hay son remitos (o nada): falta la factura */
  falta_factura: boolean
  /** Comprobantes que hay que validar antes (no incluye remitos) */
  sin_validar: ComprobanteOC[]
  /** Artículos recibidos que ningún comprobante con precios validado trae */
  sin_cubrir: Array<{ articulo_id: string; sku: string | null; descripcion: string | null }>
}

/**
 * Regla pura (tests: mobile/packages/core/test/entrada-finalizar-oc.test.ts).
 * `recibidos`: artículos con cantidad recibida > 0. `cubiertos`: artículos que figuran en
 * el detalle de un comprobante con precios validado. `resueltos`: artículos cuya diferencia de
 * CANTIDAD ya se resolvió en la verificación (sin cargo / bonificado, se espera la factura —queda
 * en "Notas esperadas"—, se devolvió o se aceptó sin factura): tampoco frenan aunque ninguna
 * factura validada los traiga (caso OC-000014, 26/11).
 */
export function evaluarFinalizarOC(p: {
  comprobantes: ComprobanteOC[]
  recibidos: Array<{ articulo_id: string; sku?: string | null; descripcion?: string | null }>
  cubiertos: Iterable<string>
  resueltos?: Iterable<string>
}): ControlFinalizarOC {
  const comps = p.comprobantes.filter((c) => c.estado !== "esperada")
  const conPreciosValidados = comps.filter((c) => esComprobanteConPrecios(c.tipo_comprobante) && VALIDADO.includes(c.estado))
  const sinValidar = comps.filter((c) => !esRemito(c.tipo_comprobante) && !VALIDADO.includes(c.estado))
  const hayConPrecios = comps.some((c) => esComprobanteConPrecios(c.tipo_comprobante))
  const faltas: string[] = []

  const faltaFactura = !hayConPrecios
  if (faltaFactura) {
    const remitos = comps.filter((c) => esRemito(c.tipo_comprobante)).length
    faltas.push(
      remitos > 0
        ? "Falta la factura para controlar precios: esta orden solo tiene remito. Con el remito se controlan las cantidades, pero la orden queda abierta hasta cargar y validar la factura."
        : "Falta la factura para controlar precios: la orden no tiene ningún comprobante con precios cargado.",
    )
  }
  if (sinValidar.length > 0) {
    faltas.push(`Hay ${sinValidar.length} comprobante(s) sin validar: ${sinValidar.map((c) => `${c.tipo_comprobante} ${c.numero_comprobante}`).join(", ")}.`)
  }

  const cubiertos = new Set([...p.cubiertos, ...(p.resueltos ?? [])])
  const vistos = new Set<string>()
  const sinCubrir: ControlFinalizarOC["sin_cubrir"] = []
  for (const r of p.recibidos) {
    if (!r.articulo_id || vistos.has(r.articulo_id)) continue
    vistos.add(r.articulo_id)
    if (!cubiertos.has(r.articulo_id)) sinCubrir.push({ articulo_id: r.articulo_id, sku: r.sku ?? null, descripcion: r.descripcion ?? null })
  }
  // Solo tiene sentido decirlo cuando ya hay una factura validada (si no, la falta es la factura)
  if (conPreciosValidados.length > 0 && sinCubrir.length > 0) {
    const lista = sinCubrir.slice(0, 5).map((a) => a.sku || a.descripcion || a.articulo_id).join(", ")
    faltas.push(
      `Hay ${sinCubrir.length} artículo(s) recibido(s) que no figuran en ninguna factura validada (${lista}${sinCubrir.length > 5 ? "…" : ""}): falta la factura que los trae, o vincular el renglón en "Revisar matches".`,
    )
  }

  return { puede: faltas.length === 0, faltas, falta_factura: faltaFactura, sin_validar: sinValidar, sin_cubrir: sinCubrir }
}

/** Lee la orden de la base y aplica la regla. */
export async function controlFinalizarOC(supabase: any, ordenId: string): Promise<ControlFinalizarOC> {
  const { data: comps, error: compErr } = await supabase
    .from("comprobantes_compra")
    .select("id, tipo_comprobante, numero_comprobante, estado")
    .eq("orden_compra_id", ordenId)
  if (compErr) throw compErr
  const comprobantes: ComprobanteOC[] = comps || []

  // Artículos de los comprobantes con precios validados
  const idsValidados = comprobantes.filter((c) => esComprobanteConPrecios(c.tipo_comprobante) && VALIDADO.includes(c.estado)).map((c) => c.id)
  const cubiertos = new Set<string>()
  if (idsValidados.length > 0) {
    const { data: det, error: detErr } = await supabase
      .from("comprobantes_compra_detalle")
      .select("articulo_id")
      .in("comprobante_id", idsValidados)
      .not("articulo_id", "is", null)
    if (detErr) throw detErr
    for (const d of det || []) cubiertos.add(d.articulo_id)
  }

  // Mercadería recibida (todas las tandas no canceladas de la orden)
  const { data: recs, error: recErr } = await supabase.from("recepciones").select("id").eq("orden_compra_id", ordenId).neq("estado", "cancelada")
  if (recErr) throw recErr
  const recIds: string[] = (recs || []).map((r: any) => r.id)
  let recibidos: Array<{ articulo_id: string; sku: string | null; descripcion: string | null }> = []
  const resueltos = new Set<string>()
  if (recIds.length > 0) {
    const { data: items, error: itErr } = await supabase
      .from("recepciones_items")
      .select("articulo_id, cantidad_fisica, cantidad_diferencia_destino, articulo:articulos(sku, descripcion)")
      .in("recepcion_id", recIds)
    if (itErr) throw itErr
    for (const i of items || []) if (i.articulo_id && i.cantidad_diferencia_destino) resueltos.add(i.articulo_id)
    recibidos = (items || []).filter((i: any) => Number(i.cantidad_fisica) > 0).map((i: any) => {
      const a = Array.isArray(i.articulo) ? i.articulo[0] : i.articulo
      return { articulo_id: i.articulo_id, sku: a?.sku ?? null, descripcion: a?.descripcion ?? null }
    })
    // Diferencias de cantidad resueltas (tabla de la migración 20261117b; sin ella valen las marcas de la línea)
    const { data: res, error: resErr } = await supabase.from("recepciones_diferencias").select("articulo_id").in("recepcion_id", recIds).eq("tipo", "cantidad")
    if (!resErr) for (const r of res || []) if (r.articulo_id) resueltos.add(r.articulo_id)
  }

  return evaluarFinalizarOC({ comprobantes, recibidos, cubiertos, resueltos })
}
