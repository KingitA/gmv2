/**
 * "Pagos de la semana" (E-71) y proyección de caja (E-69). Lógica pura: recibe los datos ya
 * leídos de la base y arma la vista. Sin imports de React ni de la base.
 *
 * Reglas:
 *  - Un vencimiento ESTIMADO de una orden de compra (mercadería pedida, sin factura) NO es
 *    deuda: va aparte en "lo que viene" y no suma a lo que hay que pagar.
 *  - El importe a pagar de cada vencimiento es NETO de la retención de Ganancias estimada
 *    (la misma proyección que usa el panel de Finanzas: ganancias_proyeccion_vencimientos).
 *  - Cómo se paga cada vencimiento: su forma de pago; si no la tiene, el acuerdo del proveedor.
 *    "Cheque" se abre en: e-cheq (el acuerdo dice e-cheq), cheque propio (el proveedor no
 *    acepta cheques de terceros) o cheque de tercero (el resto).
 */
import { colorDeCheque, elegirCheques, ventanaCheques, type ChequeCartera } from "@/lib/ordenes-pago/sugerir-cheques"
import { sumarDiasISO } from "@/lib/formato"

export type MedioSemana = "transferencia" | "echeq" | "cheque_tercero" | "cheque_propio" | "efectivo" | "sin_definir"

export interface VencimientoSemana {
  id: string
  proveedor_id: string | null
  concepto: string
  tipo: string
  monto: number | string
  fecha_vencimiento: string
  fecha_validez?: string | null
  forma_pago?: string | null
  modalidad?: string | null
  canal?: string | null
  es_estimado?: boolean | null
  referencia_tipo?: string | null
  monto_original?: number | string | null
  monto_pagado?: number | string | null
  proveedores?: { id: string; nombre: string; sigla?: string | null } | null
}

export interface ProveedorPago {
  id: string
  nombre: string
  pago_blanco_medio?: string | null
  pago_blanco_plazo_cheque?: number | null
  pago_negro_medio?: string | null
  pago_negro_plazo_cheque?: number | null
  acepta_cheques_terceros?: boolean | null
  acepta_echeq?: boolean | null
}

export interface CuentaFondo { cuenta_tipo: "CAJA" | "BANCO"; cuenta_id: string; nombre: string; saldo: number }

export interface ItemSemana {
  id: string
  concepto: string
  fecha_vencimiento: string
  atrasado: boolean
  bruto: number
  retencion: number
  neto: number
  canal: string
  parcial: { total: number; pagado: number } | null
  /** Solo cheque propio / e-cheq: con qué fecha de pago hay que hacerlo */
  fecha_cheque?: string
}

export interface GrupoProveedor {
  proveedor_id: string | null
  nombre: string
  items: ItemSemana[]
  bruto: number
  retencion: number
  neto: number
  /** Dirección de la Nueva OP con este proveedor y estos vencimientos tildados (null si no hay proveedor) */
  url_pagar: string | null
  /** Solo cheque de tercero */
  cheques_sugeridos?: Array<{ id: string; banco: string; numero: string; fecha_vencimiento: string; monto: number; color: string }>
  falta_cubrir?: number
  aviso?: string
}

export interface BloqueMedio {
  medio: MedioSemana
  titulo: string
  ayuda: string
  proveedores: GrupoProveedor[]
  bruto: number
  retencion: number
  neto: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const n0 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export const esEstimadoOC = (v: { es_estimado?: boolean | null; referencia_tipo?: string | null }) =>
  v.es_estimado === true && v.referencia_tipo === "orden_compra"

const TITULOS: Record<MedioSemana, { titulo: string; ayuda: string }> = {
  transferencia: { titulo: "Transferencias", ayuda: "Salen de un banco. Abajo, el saldo de cada cuenta y si alcanza." },
  echeq: { titulo: "E-cheq a emitir", ayuda: "Se emiten desde un banco, como una transferencia, con fecha de pago." },
  cheque_tercero: { titulo: "Cheques de terceros", ayuda: "Se paga con cheques de la cartera. Los sugeridos entran en el importe y en la fecha del acuerdo." },
  cheque_propio: { titulo: "Cheques propios a hacer", ayuda: "Proveedores que no aceptan cheques de terceros: cuánto y con qué fecha hay que hacer cada cheque." },
  efectivo: { titulo: "Efectivo a separar", ayuda: "Cuánto hay que separar, para quién y para qué día." },
  sin_definir: { titulo: "Sin forma de pago definida", ayuda: "No tienen forma de pago ni el proveedor tiene acuerdo cargado: definilo en el vencimiento o en la ficha." },
}
const ORDEN: MedioSemana[] = ["transferencia", "echeq", "cheque_tercero", "cheque_propio", "efectivo", "sin_definir"]

/** Cómo se paga un vencimiento (ver reglas arriba). */
export function medioDe(v: VencimientoSemana, prov?: ProveedorPago | null): MedioSemana {
  const negro = v.canal === "negro"
  const acuerdo = (negro ? prov?.pago_negro_medio : null) ?? prov?.pago_blanco_medio ?? null
  const comoCheque = (): MedioSemana =>
    acuerdo === "echeq" ? "echeq" : prov?.acepta_cheques_terceros === false ? (prov?.acepta_echeq === true ? "echeq" : "cheque_propio") : "cheque_tercero"
  if (v.forma_pago === "transferencia") return "transferencia"
  if (v.forma_pago === "efectivo") return "efectivo"
  if (v.forma_pago === "cheque") return comoCheque()
  if (acuerdo === "transferencia") return "transferencia"
  if (acuerdo === "efectivo") return "efectivo"
  if (acuerdo === "echeq" || acuerdo === "cheques" || acuerdo === "cheques_y_efectivo") return comoCheque()
  return "sin_definir"
}

export interface EntradaSemana {
  hoy: string
  desde: string
  hasta: string
  /** Pendientes con fecha <= hasta (incluye atrasados) */
  vencimientos: VencimientoSemana[]
  proveedores: ProveedorPago[]
  /** vencimiento_id → retención de Ganancias estimada */
  retenciones: Record<string, number>
  /** Cheques de terceros EN_CARTERA */
  cartera: ChequeCartera[]
  /** cheque_id → número de la orden pendiente que lo reservó */
  reservados: Record<string, string>
  cuentas: CuentaFondo[]
}

export function armarPagosSemana(e: EntradaSemana) {
  const provDe = new Map(e.proveedores.map((p) => [p.id, p]))
  const reales = e.vencimientos.filter((v) => !esEstimadoOC(v))
  const estimados = e.vencimientos.filter(esEstimadoOC)

  const item = (v: VencimientoSemana): ItemSemana => {
    const bruto = r2(n0(v.monto))
    const retencion = r2(Math.min(bruto, Math.max(0, n0(e.retenciones[v.id]))))
    return {
      id: v.id, concepto: v.concepto, fecha_vencimiento: v.fecha_vencimiento, atrasado: v.fecha_vencimiento < e.hoy,
      bruto, retencion, neto: r2(bruto - retencion), canal: v.canal === "negro" ? "negro" : "blanco",
      parcial: v.monto_original != null && n0(v.monto_pagado) > 0 ? { total: r2(n0(v.monto_original)), pagado: r2(n0(v.monto_pagado)) } : null,
    }
  }

  // medio → proveedor → items
  const porMedio = new Map<MedioSemana, Map<string, { v: VencimientoSemana[]; prov: ProveedorPago | null; nombre: string }>>()
  for (const v of reales) {
    const prov = v.proveedor_id ? provDe.get(v.proveedor_id) ?? null : null
    const medio = medioDe(v, prov)
    const clave = v.proveedor_id ?? `sin:${v.concepto}`
    const m = porMedio.get(medio) ?? new Map()
    const g = m.get(clave) ?? { v: [], prov, nombre: prov?.nombre ?? v.proveedores?.nombre ?? v.concepto }
    g.v.push(v)
    m.set(clave, g)
    porMedio.set(medio, m)
  }

  // Cheques de cartera: libres (sin reservar) y los ya propuestos a otro proveedor no se repiten
  const usados = new Set<string>()
  const libres = e.cartera.filter((c) => !e.reservados[c.id])

  const bloques: BloqueMedio[] = []
  for (const medio of ORDEN) {
    const m = porMedio.get(medio)
    if (!m) continue
    const proveedores: GrupoProveedor[] = []
    for (const g of m.values()) {
      const ordenados = [...g.v].sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
      const items = ordenados.map(item)
      const bruto = r2(items.reduce((s, i) => s + i.bruto, 0))
      const retencion = r2(items.reduce((s, i) => s + i.retencion, 0))
      const neto = r2(bruto - retencion)
      const grupo: GrupoProveedor = {
        proveedor_id: g.prov?.id ?? null, nombre: g.nombre, items, bruto, retencion, neto,
        url_pagar: g.prov ? `/ordenes-pago/nueva?proveedor_id=${g.prov.id}&vencimiento_ids=${items.map((i) => i.id).join(",")}` : null,
      }
      const plazoDe = (canal: string) => n0(canal === "negro" ? g.prov?.pago_negro_plazo_cheque ?? g.prov?.pago_blanco_plazo_cheque : g.prov?.pago_blanco_plazo_cheque)

      if (medio === "cheque_propio" || medio === "echeq") {
        // Fecha de pago del cheque: la validez anotada en el vencimiento, o día de pago + plazo del acuerdo
        ordenados.forEach((v, i) => {
          const pago = v.fecha_vencimiento < e.hoy ? e.hoy : v.fecha_vencimiento
          items[i].fecha_cheque = v.fecha_validez || sumarDiasISO(pago, plazoDe(items[i].canal))
        })
      }
      if (medio === "cheque_tercero") {
        // Por canal: negro se paga con cheques negros; blanco con blancos o e-cheq
        const sugeridos: ChequeCartera[] = []
        let falta = 0
        for (const canal of ["negro", "blanco"]) {
          const objetivo = r2(items.filter((i) => i.canal === canal).reduce((s, i) => s + i.neto, 0))
          if (objetivo <= 0) continue
          // Igual que la Nueva OP: la fecha sale del vencimiento de lo que se paga (el más
          // próximo de este proveedor y canal), nunca antes de hoy, más el plazo del acuerdo
          const vence = items.filter((i) => i.canal === canal).map((i) => i.fecha_vencimiento).sort()[0]
          const win = ventanaCheques(vence && vence > e.hoy ? vence : e.hoy, plazoDe(canal), sumarDiasISO)
          const candidatos = libres.filter((c) => !usados.has(c.id)
            && (canal === "negro" ? colorDeCheque(c) === "NEGRO" : colorDeCheque(c) !== "NEGRO")
            && c.fecha_vencimiento >= win.desde && c.fecha_vencimiento <= win.hasta)
          const elegidos = elegirCheques(candidatos, objetivo)
          for (const c of elegidos) { usados.add(c.id); sugeridos.push(c) }
          falta += r2(objetivo - elegidos.reduce((s, c) => s + n0(c.monto), 0))
        }
        grupo.cheques_sugeridos = sugeridos.map((c) => ({
          id: c.id, banco: c.banco ?? "", numero: c.numero ?? "", fecha_vencimiento: c.fecha_vencimiento, monto: r2(n0(c.monto)), color: colorDeCheque(c),
        }))
        grupo.falta_cubrir = r2(Math.max(0, falta))
        if (grupo.falta_cubrir > 0.01) grupo.aviso = "No hay cheques en cartera que cubran todo: lo que falta se completa con transferencia o efectivo."
      }
      proveedores.push(grupo)
    }
    proveedores.sort((a, b) => (a.items[0]?.fecha_vencimiento ?? "").localeCompare(b.items[0]?.fecha_vencimiento ?? "") || a.nombre.localeCompare(b.nombre))
    bloques.push({
      medio, ...TITULOS[medio], proveedores,
      bruto: r2(proveedores.reduce((s, p) => s + p.bruto, 0)),
      retencion: r2(proveedores.reduce((s, p) => s + p.retencion, 0)),
      neto: r2(proveedores.reduce((s, p) => s + p.neto, 0)),
    })
  }

  const netoDe = (m: MedioSemana) => bloques.find((b) => b.medio === m)?.neto ?? 0
  const bancos = e.cuentas.filter((c) => c.cuenta_tipo === "BANCO")
  const cajas = e.cuentas.filter((c) => c.cuenta_tipo === "CAJA")
  const saleDeBancos = r2(netoDe("transferencia") + netoDe("echeq"))
  const saldoBancos = r2(bancos.reduce((s, c) => s + c.saldo, 0))
  const saldoCajas = r2(cajas.reduce((s, c) => s + c.saldo, 0))

  // Efectivo por día (para saber cuánto separar cada día)
  const efectivoPorDia = new Map<string, number>()
  for (const p of bloques.find((b) => b.medio === "efectivo")?.proveedores ?? []) {
    for (const i of p.items) {
      const dia = i.atrasado ? e.hoy : i.fecha_vencimiento
      efectivoPorDia.set(dia, r2((efectivoPorDia.get(dia) ?? 0) + i.neto))
    }
  }

  return {
    semana: { desde: e.desde, hasta: e.hasta, hoy: e.hoy },
    bloques,
    totales: {
      bruto: r2(bloques.reduce((s, b) => s + b.bruto, 0)),
      retencion: r2(bloques.reduce((s, b) => s + b.retencion, 0)),
      neto: r2(bloques.reduce((s, b) => s + b.neto, 0)),
      atrasado: r2(bloques.flatMap((b) => b.proveedores).flatMap((p) => p.items).filter((i) => i.atrasado).reduce((s, i) => s + i.neto, 0)),
    },
    bancos: {
      cuentas: bancos.map((c) => ({ ...c, alcanza: c.saldo >= saleDeBancos - 0.01 })),
      sale: saleDeBancos, saldo: saldoBancos, alcanza: saldoBancos >= saleDeBancos - 0.01, falta: r2(Math.max(0, saleDeBancos - saldoBancos)),
    },
    efectivo: {
      cuentas: cajas, sale: netoDe("efectivo"), saldo: saldoCajas, alcanza: saldoCajas >= netoDe("efectivo") - 0.01,
      falta: r2(Math.max(0, netoDe("efectivo") - saldoCajas)),
      por_dia: [...efectivoPorDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dia, monto]) => ({ dia, monto })),
    },
    cartera: {
      disponibles: libres.length, monto_disponible: r2(libres.reduce((s, c) => s + n0(c.monto), 0)),
      reservados: e.cartera.filter((c) => e.reservados[c.id]).map((c) => ({
        id: c.id, banco: c.banco ?? "", numero: c.numero ?? "", fecha_vencimiento: c.fecha_vencimiento, monto: r2(n0(c.monto)), orden_pago: e.reservados[c.id],
      })),
    },
    lo_que_viene: {
      total: r2(estimados.reduce((s, v) => s + n0(v.monto), 0)),
      items: estimados.sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento)).map((v) => ({
        id: v.id, concepto: v.concepto, proveedor: v.proveedor_id ? provDe.get(v.proveedor_id)?.nombre ?? v.proveedores?.nombre ?? "" : "",
        fecha_vencimiento: v.fecha_vencimiento, monto: r2(n0(v.monto)),
      })),
    },
  }
}

// ─────────────────────────── Proyección de caja (E-69) ───────────────────────────

export interface EntradaProyeccion {
  hoy: string
  dias: number
  /** Saldo real de bancos + cajas hoy */
  saldo_inicial: number
  /** TODOS los vencimientos pendientes hasta hoy + dias */
  vencimientos: VencimientoSemana[]
  retenciones: Record<string, number>
  /** Cheques de terceros que van a entrar: EN_CARTERA (sin reservar) y DEPOSITADOS sin acreditar */
  cheques_a_cobrar: Array<{ fecha_vencimiento: string; monto: number | string }>
  /** Cheques propios emitidos que todavía no se debitaron */
  cheques_a_debitar: Array<{ fecha_vencimiento: string; monto: number | string }>
}

export interface DiaProyeccion {
  dia: string
  pagos: number        // neto de retención, sin estimados
  cheques_propios: number
  entra_cheques: number
  saldo: number        // saldo al final del día
  estimado: number     // estimados de órdenes de compra de ese día (NO restados del saldo)
  saldo_con_estimados: number
}

/**
 * Parte de los saldos reales, resta los pagos netos de retención y los cheques propios que
 * se van a debitar, suma los cheques de cartera a su fecha de cobro, y muestra aparte los
 * estimados de órdenes de compra (y cómo quedaría el saldo si también se pagaran).
 * Lo atrasado (pagos, cheques) cae en el día de hoy.
 */
export function proyectarCaja(e: EntradaProyeccion): { saldo_inicial: number; dias: DiaProyeccion[]; minimo: { dia: string; saldo: number } | null } {
  const fin = sumarDiasISO(e.hoy, e.dias - 1)
  const alDia = (f: string) => (f < e.hoy ? e.hoy : f)
  const suma = (m: Map<string, number>, dia: string, x: number) => { if (dia <= fin) m.set(dia, (m.get(dia) ?? 0) + x) }
  const pagos = new Map<string, number>(), est = new Map<string, number>(), entra = new Map<string, number>(), propios = new Map<string, number>()
  for (const v of e.vencimientos) {
    const bruto = n0(v.monto)
    if (esEstimadoOC(v)) suma(est, alDia(v.fecha_vencimiento), bruto)
    else suma(pagos, alDia(v.fecha_vencimiento), bruto - Math.min(bruto, Math.max(0, n0(e.retenciones[v.id]))))
  }
  for (const c of e.cheques_a_cobrar) suma(entra, alDia(c.fecha_vencimiento), n0(c.monto))
  for (const c of e.cheques_a_debitar) suma(propios, alDia(c.fecha_vencimiento), n0(c.monto))

  const dias: DiaProyeccion[] = []
  let saldo = e.saldo_inicial, saldoEst = e.saldo_inicial
  let minimo: { dia: string; saldo: number } | null = null
  for (let i = 0; i < e.dias; i++) {
    const dia = sumarDiasISO(e.hoy, i)
    const p = r2(pagos.get(dia) ?? 0), cp = r2(propios.get(dia) ?? 0), en = r2(entra.get(dia) ?? 0), es = r2(est.get(dia) ?? 0)
    saldo = r2(saldo - p - cp + en)
    saldoEst = r2(saldoEst - p - cp + en - es)
    dias.push({ dia, pagos: p, cheques_propios: cp, entra_cheques: en, saldo, estimado: es, saldo_con_estimados: saldoEst })
    if (!minimo || saldo < minimo.saldo) minimo = { dia, saldo }
  }
  return { saldo_inicial: r2(e.saldo_inicial), dias, minimo }
}
