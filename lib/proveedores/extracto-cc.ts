/**
 * Extracto de la cuenta corriente de un proveedor (E-68).
 *
 * Arma, a partir de los movimientos de `cuenta_corriente_proveedores`, una lista
 * cronológica con saldo corrido, en la que cada orden de pago aparece UNA sola vez
 * (pago + retenciones agrupados) con sus medios, y cada anulación también.
 *
 * El saldo es la suma de los movimientos: la misma fuente que usa el resto del
 * sistema (E-56). Positivo = le debemos al proveedor.
 *
 * Las provisiones de órdenes de compra (mercadería pedida, todavía sin factura) NO son
 * deuda: no entran al extracto ni al saldo; se devuelven aparte como "comprometido".
 *
 * Las fechas se pasan a día de Argentina con fechaISO (lib/formato): un pago registrado a
 * las 22 h figura ese día, no el siguiente.
 *
 * Sin imports de React ni de la base: se usa en la ruta y se puede probar suelto.
 */
import { fechaISO } from "@/lib/formato"

export interface MovimientoCC {
  id: string
  fecha: string
  created_at?: string | null
  tipo_movimiento: string
  monto: number | string
  descripcion?: string | null
  referencia_id?: string | null
  referencia_tipo?: string | null
  numero_comprobante?: string | null
  tipo_comprobante?: string | null
}

export interface OrdenPagoResumen {
  id: string
  numero_op: string
  estado: string
  neto_a_pagar: number | string | null
  retencion_ganancias: number | string | null
  total_retenciones: number | string | null
  ordenes_pago_detalle?: Array<{ medio: string; monto: number | string; cheque_numero?: string | null; cheque_banco?: string | null; observaciones?: string | null }>
  numero_certificado?: string | null
}

export interface FilaExtracto {
  clave: string
  fecha: string
  clase: "comprobante" | "credito" | "pago" | "anulacion" | "provision" | "otro"
  movimiento: string
  detalle: string
  debe: number
  haber: number
  saldo: number
  orden_pago_id?: string
  orden_pago_estado?: string
  tiene_certificado?: boolean
  orden_compra_id?: string
  comprobante_id?: string
  medios?: Array<{ medio: string; monto: number; detalle: string }>
  retencion?: number
  pagado?: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function etiquetaComprobante(tc?: string | null): string {
  if (!tc) return "Comprobante"
  if (tc === "Adquisicion") return "Adquisición"
  if (tc === "Reversa") return "Reversa"
  if (tc === "Remito") return "Remito"
  if (tc === "OP") return "Orden de pago"
  if (tc.startsWith("NC")) return `Nota de crédito ${tc.slice(2)}`.trim()
  if (tc.startsWith("ND")) return `Nota de débito ${tc.slice(2)}`.trim()
  if (tc.startsWith("F")) return `Factura ${tc.slice(1)}`.trim()
  return tc
}

const NOMBRE_MEDIO: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", deposito: "Depósito", cheque: "Cheque", cheque_propio: "Cheque propio",
}

function mediosDe(op?: OrdenPagoResumen) {
  return (op?.ordenes_pago_detalle ?? []).map((d) => ({
    medio: NOMBRE_MEDIO[d.medio] ?? d.medio,
    monto: Number(d.monto) || 0,
    detalle: d.medio === "cheque" || d.medio === "cheque_propio"
      ? [d.cheque_banco, d.cheque_numero ? `N° ${d.cheque_numero}` : null].filter(Boolean).join(" ")
      : (d.observaciones || ""),
  }))
}

/**
 * @param movimientos todos los del proveedor (cualquier orden)
 * @param ops órdenes de pago referenciadas, por id
 * @param rango filtra lo que se devuelve; el saldo corrido arranca siempre desde el principio
 */
export function armarExtracto(
  movimientos: MovimientoCC[],
  ops: Map<string, OrdenPagoResumen>,
  rango?: { desde?: string | null; hasta?: string | null },
): { filas: FilaExtracto[]; saldoAnterior: number; saldoFinal: number; saldoActual: number; comprometido: FilaExtracto[] } {
  const comprometido: FilaExtracto[] = movimientos
    .filter((m) => m.tipo_movimiento === "orden_compra")
    .map((m) => ({
      clave: `mov:${m.id}`, fecha: m.fecha, clase: "provision" as const,
      movimiento: "Mercadería pedida, sin facturar", detalle: m.descripcion || "Provisión de la orden de compra",
      debe: Math.max(0, Number(m.monto) || 0), haber: 0, saldo: 0,
      orden_compra_id: m.referencia_tipo === "orden_compra" ? m.referencia_id ?? undefined : undefined,
    }))
  const orden = movimientos.filter((m) => m.tipo_movimiento !== "orden_compra").sort((a, b) =>
    String(a.fecha).localeCompare(String(b.fecha)) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id))

  // Agrupar: una fila por orden de pago y una por su anulación
  const grupos = new Map<string, { clave: string; movs: MovimientoCC[] }>()
  const secuencia: Array<{ clave: string; movs: MovimientoCC[] }> = []
  for (const m of orden) {
    const esOP = (m.referencia_tipo === "orden_pago" || m.referencia_tipo === "orden_pago_anulacion") && m.referencia_id
    const clave = esOP ? `${m.referencia_tipo}:${m.referencia_id}` : `mov:${m.id}`
    let g = grupos.get(clave)
    if (!g) { g = { clave, movs: [] }; grupos.set(clave, g); secuencia.push(g) }
    g.movs.push(m)
  }

  const todas: FilaExtracto[] = []
  let saldo = 0
  for (const g of secuencia) {
    const m0 = g.movs[0]
    const total = r2(g.movs.reduce((s, m) => s + (Number(m.monto) || 0), 0))
    saldo = r2(saldo + total)
    const base = { clave: g.clave, fecha: m0.fecha, debe: total > 0 ? total : 0, haber: total < 0 ? -total : 0, saldo }

    if (m0.referencia_tipo === "orden_pago" && m0.referencia_id) {
      const op = ops.get(m0.referencia_id)
      const ret = r2(g.movs.filter((m) => m.tipo_movimiento === "retencion").reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0))
      const pagado = r2(g.movs.filter((m) => m.tipo_movimiento === "pago").reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0))
      const medios = mediosDe(op)
      todas.push({
        ...base, clase: "pago",
        movimiento: `Pago · OP ${op?.numero_op ?? m0.numero_comprobante ?? ""}`.trim(),
        detalle: [
          medios.length ? medios.map((x) => `${x.medio}${x.detalle ? ` ${x.detalle}` : ""}`).join(" + ") : null,
          ret > 0 ? `retención de Ganancias${op?.numero_certificado ? ` (cert. ${op.numero_certificado})` : ""}` : null,
          op?.estado === "anulada" ? "ANULADA" : null,
        ].filter(Boolean).join(" · "),
        orden_pago_id: m0.referencia_id, orden_pago_estado: op?.estado,
        tiene_certificado: ret > 0 && !!op?.numero_certificado,
        medios, retencion: ret, pagado,
      })
    } else if (m0.referencia_tipo === "orden_pago_anulacion" && m0.referencia_id) {
      const op = ops.get(m0.referencia_id)
      todas.push({
        ...base, clase: "anulacion",
        movimiento: `Anulación · OP ${op?.numero_op ?? ""}`.trim(),
        detalle: "Se anuló el pago: la deuda vuelve a la cuenta",
        orden_pago_id: m0.referencia_id, orden_pago_estado: op?.estado,
      })
    } else if (m0.tipo_movimiento === "orden_compra") {
      todas.push({
        ...base, clase: "provision",
        movimiento: "Mercadería pedida, sin facturar",
        detalle: m0.descripcion || "Provisión de la orden de compra",
        orden_compra_id: m0.referencia_tipo === "orden_compra" ? m0.referencia_id ?? undefined : undefined,
      })
    } else {
      const esDoc = ["factura", "nota_credito", "nota_debito"].includes(m0.tipo_movimiento) || m0.referencia_tipo === "comprobante_compra"
      todas.push({
        ...base, clase: esDoc ? (total < 0 ? "credito" : "comprobante") : "otro",
        movimiento: esDoc
          ? `${etiquetaComprobante(m0.tipo_comprobante) || m0.tipo_movimiento} ${m0.numero_comprobante ?? ""}`.trim()
          : (m0.tipo_movimiento.charAt(0).toUpperCase() + m0.tipo_movimiento.slice(1).replace(/_/g, " ")),
        detalle: m0.descripcion || "",
        comprobante_id: m0.referencia_tipo === "comprobante_compra" ? m0.referencia_id ?? undefined : undefined,
      })
    }
  }

  const dia = (f: string) => fechaISO(f)
  const desde = rango?.desde || null, hasta = rango?.hasta || null
  const antes = desde ? todas.filter((f) => dia(f.fecha) < desde) : []
  const filas = todas.filter((f) => (!desde || dia(f.fecha) >= desde) && (!hasta || dia(f.fecha) <= hasta))
  const saldoAnterior = antes.length ? antes[antes.length - 1].saldo : 0
  const saldoFinal = filas.length ? filas[filas.length - 1].saldo : saldoAnterior
  return { filas, saldoAnterior, saldoFinal, saldoActual: saldo, comprometido }
}
