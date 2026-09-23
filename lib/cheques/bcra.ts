// Central de Deudores del BCRA: interpretación de la respuesta y veredicto único
// por cheque ("se puede aceptar" / "riesgo" / "no se pudo consultar"). Puro: lo usan
// el proxy Edge, el handler del outbox y las tres UIs.

export interface BcraResultado {
  cuit: string
  denominacion: string | null
  situacion_max: number
  sin_antecedentes: boolean
  apto: boolean
  /** Peor situación por entidad informante (para resaltar el banco del cheque) */
  entidades: { entidad: string; situacion: number }[]
  error?: string
}

export const SITUACION_LABEL: Record<number, string> = {
  1: "Situación 1 — normal",
  2: "Situación 2 — riesgo bajo",
  3: "Situación 3 — riesgo medio",
  4: "Situación 4 — riesgo alto",
  5: "Situación 5 — irrecuperable",
  6: "Situación 6 — irrecuperable (disp. técnica)",
}

/** Respuesta cruda de api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/{cuit} → resultado. */
export function interpretarRespuestaBcra(cuit: string, data: any): BcraResultado {
  const results = data?.results
  let situacionMax = 1
  const porEntidad = new Map<string, number>()
  for (const periodo of results?.periodos || []) {
    for (const entidad of periodo.entidades || []) {
      const sit = Number(entidad.situacion) || 0
      if (sit > situacionMax) situacionMax = sit
      const nombre = String(entidad.entidad || "").trim()
      if (nombre) porEntidad.set(nombre, Math.max(porEntidad.get(nombre) ?? 0, sit))
    }
  }
  return {
    cuit,
    denominacion: results?.denominacion || null,
    situacion_max: situacionMax,
    sin_antecedentes: false,
    apto: situacionMax === 1,
    entidades: [...porEntidad.entries()].map(([entidad, situacion]) => ({ entidad, situacion })).sort((a, b) => b.situacion - a.situacion),
  }
}

export const bcraSinAntecedentes = (cuit: string): BcraResultado => ({ cuit, denominacion: null, situacion_max: 1, sin_antecedentes: true, apto: true, entidades: [] })
export const bcraError = (cuit: string, error: string): BcraResultado => ({ cuit, denominacion: null, situacion_max: 0, sin_antecedentes: false, apto: false, entidades: [], error })

// ¿La entidad del BCRA es el banco emisor del cheque? Comparación laxa por tokens
// ("Macro" ⊂ "BANCO MACRO S.A.", "Nación" ⊂ "BANCO DE LA NACION ARGENTINA").
const norm = (s: string) =>
  s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(BANCO|BCO|DE|DEL|LA|EL|LOS|Y|S\.?A\.?U?|S\.?R\.?L\.?|ARGENTINA|BUENOS AIRES)\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

export function esMismoBanco(entidadBcra: string, bancoEmisor: string): boolean {
  const a = norm(entidadBcra)
  const b = norm(bancoEmisor)
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

export type Veredicto = "apto" | "riesgo" | "sin_respuesta" | "sin_cuit"

export interface VeredictoBcra {
  veredicto: Veredicto
  /** Una línea para el aviso ("✅ BCRA: se puede aceptar") */
  titulo: string
  /** Detalle por titular con problema / error */
  detalle: string[]
  /** La deuda está en el MISMO banco que emitió el cheque (lo que más pesa) */
  mismoBanco: boolean
  resultados: BcraResultado[]
}

/**
 * Cuentas conjuntas: un cheque puede tener 2+ CUITs. Se consultan todos y se
 * responde UNA cosa. Todos situación 1 → apto. Alguno 2+ → riesgo (detalle solo del
 * titular con problema). Alguno sin respuesta y ninguno con deuda → sin_respuesta.
 */
export function veredictoBcra(resultados: BcraResultado[], bancoEmisor?: string | null): VeredictoBcra {
  const conDeuda = resultados.filter((r) => !r.error && !r.apto)
  const conError = resultados.filter((r) => r.error)
  if (!resultados.length) return { veredicto: "sin_respuesta", titulo: "BCRA: sin CUIT para consultar", detalle: [], mismoBanco: false, resultados }
  if (conDeuda.length) {
    const detalle: string[] = []
    let mismoBanco = false
    for (const r of conDeuda) {
      const enBanco = bancoEmisor ? r.entidades.find((e) => e.situacion > 1 && esMismoBanco(e.entidad, bancoEmisor)) : undefined
      const quien = r.denominacion ? `${r.denominacion} (${r.cuit})` : r.cuit
      detalle.push(`${quien}: ${SITUACION_LABEL[r.situacion_max] || `situación ${r.situacion_max}`}`)
      if (enBanco) {
        mismoBanco = true
        detalle.push(`🚨 La deuda (situación ${enBanco.situacion}) es en ${enBanco.entidad}, el MISMO banco que emitió el cheque.`)
      } else {
        for (const e of r.entidades.filter((e) => e.situacion > 1).slice(0, 3)) detalle.push(`· situación ${e.situacion} en ${e.entidad}`)
      }
    }
    const peor = Math.max(...conDeuda.map((r) => r.situacion_max))
    return { veredicto: "riesgo", titulo: `⛔ BCRA: ${SITUACION_LABEL[peor] || `situación ${peor}`} — evaluá si aceptás el cheque`, detalle, mismoBanco, resultados }
  }
  if (conError.length) {
    return {
      veredicto: "sin_respuesta",
      titulo: conError.length < resultados.length ? "⚠️ BCRA: no se pudo consultar a uno de los titulares" : "⚠️ No se pudo consultar el BCRA — verificá el cheque a mano",
      detalle: [...new Set(conError.map((r) => r.error!))],
      mismoBanco: false,
      resultados,
    }
  }
  const sinAnt = resultados.every((r) => r.sin_antecedentes)
  return {
    veredicto: "apto",
    titulo: `✅ BCRA: se puede aceptar — ${sinAnt ? "sin antecedentes" : "situación 1 / normal"}${resultados.length > 1 ? ` (${resultados.length} titulares)` : ""}`,
    detalle: resultados.map((r) => r.denominacion).filter((d): d is string => !!d),
    mismoBanco: false,
    resultados,
  }
}

/** Payload de la operación `bcra.consultar` del outbox (app vendedor). */
export interface ConsultaBcraPayload {
  /** CUITs válidos (XX-XXXXXXXX-X) del cheque */
  cuits: string[]
  banco?: string | null
  numero_cheque?: string | null
  monto?: number | null
  cliente_nombre?: string | null
}

/** Resultado de `bcra.consultar` (lo que guarda el outbox en `resultado`). */
export interface ConsultaBcraResultado {
  veredicto: Veredicto
  titulo: string
  detalle: string[]
  mismoBanco: boolean
  cheque: { banco: string | null; numero_cheque: string | null; monto: number | null; cliente_nombre: string | null }
  consultado_at: string
}

/** Aviso para un cheque que se registró SIN CUIT válido: no hubo consulta al BCRA y no puede pasar en silencio. */
export function resultadoSinCuit(cheque: ConsultaBcraResultado["cheque"], leido?: string | null): ConsultaBcraResultado {
  return {
    veredicto: "sin_cuit",
    titulo: "⚠️ Cheque sin CUIT — no se consultó el BCRA",
    detalle: [leido ? `El CUIT cargado ("${leido}") no cierra el dígito verificador.` : "No se cargó el CUIT del emisor.", "Este cheque queda sin control de riesgo: verificalo en la oficina."],
    mismoBanco: false,
    cheque,
    consultado_at: new Date().toISOString(),
  }
}

/** Texto de UNA línea para el aviso de la app ("Cheque 12345678 · Macro · Almacén X: ✅ …"). */
export function textoAvisoBcra(r: ConsultaBcraResultado): string {
  const partes = [r.cheque.numero_cheque ? `Cheque ${r.cheque.numero_cheque}` : "Cheque", r.cheque.banco, r.cheque.cliente_nombre].filter(Boolean)
  return `${partes.join(" · ")}: ${r.titulo}`
}

/** Operación `bcra.consultar` ya aplicada cuyo veredicto el usuario todavía no vio. */
export interface AvisoBcra {
  key: string
  resultado: ConsultaBcraResultado
}

/**
 * Avisos pendientes de mostrar: items del outbox de tipo `bcra.consultar` que ya
 * volvieron del servidor (enviado + resultado) y no están en `vistos`. Puro, para
 * que la pantalla de la app (y el test) decidan qué mostrar.
 */
export function avisosBcraPendientes(
  items: Array<{ key: string; tipo: string; estado: string; resultado: unknown }>,
  vistos: Iterable<string>,
): AvisoBcra[] {
  const v = new Set(vistos)
  return items
    .filter((it) => it.tipo === "bcra.consultar" && it.estado === "enviado" && !v.has(it.key) && !!it.resultado && typeof it.resultado === "object" && "veredicto" in (it.resultado as object))
    .map((it) => ({ key: it.key, resultado: it.resultado as ConsultaBcraResultado }))
}
