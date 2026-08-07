"use client"

import { useEffect, useState } from "react"

// Chequeo del CUIT del emisor de un cheque contra la Central de Deudores del
// BCRA (proxy Edge /api/bcra/deudor/[cuit]). Reutilizable en oficina
// (MetodoPagoForm), cobro del vendedor y chofer: se le pasa el CUIT y muestra
// el semáforo (situación 1 = normal; 2+ = con deuda en el sistema financiero).

export interface BcraResultado {
  situacion_max: number
  denominacion: string | null
  apto: boolean
  sin_antecedentes: boolean
  /** Peor situación por entidad informante (para resaltar el banco del cheque). */
  entidades?: { entidad: string; situacion: number }[]
  error?: string
}

// ¿La entidad del BCRA es el banco emisor del cheque? Comparación laxa por
// tokens ("Macro" ⊂ "BANCO MACRO S.A.", "Nación" ⊂ "BANCO DE LA NACION ARGENTINA").
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

const SITUACION_LABEL: Record<number, string> = {
  1: "Situación 1 — normal",
  2: "Situación 2 — riesgo bajo",
  3: "Situación 3 — riesgo medio",
  4: "Situación 4 — riesgo alto",
  5: "Situación 5 — irrecuperable",
  6: "Situación 6 — irrecuperable (disp. técnica)",
}

export function useBcraDeudor(cuit: string | null | undefined) {
  const [resultado, setResultado] = useState<BcraResultado | null>(null)
  const [consultando, setConsultando] = useState(false)

  useEffect(() => {
    const limpio = (cuit || "").replace(/\D/g, "")
    if (limpio.length < 10) {
      setResultado(null)
      return
    }
    const timer = setTimeout(async () => {
      setConsultando(true)
      setResultado(null)
      try {
        const res = await fetch(`/api/bcra/deudor/${limpio}`)
        const d = await res.json()
        if (d.error) setResultado({ situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: d.error })
        else setResultado(d)
      } catch {
        setResultado({ situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: "Sin conexión con el BCRA" })
      } finally {
        setConsultando(false)
      }
    }, 700)
    return () => clearTimeout(timer)
  }, [cuit])

  return { resultado, consultando }
}

export function BcraDeudorChip({
  cuit,
  bancoEmisor,
}: {
  cuit: string | null | undefined
  /** Banco que emitió el cheque: si la deuda está justo ahí, se resalta aparte
   *  (es el banco que va a decidir si el cheque se paga). */
  bancoEmisor?: string | null
}) {
  const { resultado, consultando } = useBcraDeudor(cuit)

  if (consultando) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-500">
        <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin shrink-0" />
        Consultando Central de Deudores (BCRA)...
      </div>
    )
  }
  if (!resultado) return null

  if (resultado.error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-xl border border-amber-300 text-sm text-amber-800">
        ⚠️ No se pudo consultar el BCRA — verificá el cheque a mano. <span className="text-amber-600">{resultado.error}</span>
      </div>
    )
  }

  if (resultado.apto) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-xl border border-green-300 text-sm text-green-800">
        ✅ BCRA: {resultado.sin_antecedentes ? "sin antecedentes" : "situación 1 — normal"}
        {resultado.denominacion && <span className="text-green-600 truncate">· {resultado.denominacion}</span>}
      </div>
    )
  }

  // La deuda ¿está en el banco que emitió el cheque? Es el dato que más pesa.
  const entidadDelCheque = bancoEmisor
    ? (resultado.entidades || []).find((e) => e.situacion > 1 && esMismoBanco(e.entidad, bancoEmisor))
    : null

  return (
    <div className="px-3 py-2 bg-red-50 rounded-xl border-2 border-red-400 text-sm">
      <p className="font-bold text-red-700">
        ⛔ BCRA: {SITUACION_LABEL[resultado.situacion_max] || `situación ${resultado.situacion_max}`}
      </p>
      {resultado.denominacion && <p className="text-red-600 truncate">{resultado.denominacion}</p>}
      {entidadDelCheque ? (
        <p className="text-red-700 text-xs mt-0.5 font-bold">
          🚨 La deuda (situación {entidadDelCheque.situacion}) es en {entidadDelCheque.entidad} — el
          MISMO banco que emitió este cheque.
        </p>
      ) : (
        (resultado.entidades || [])
          .filter((e) => e.situacion > 1)
          .slice(0, 3)
          .map((e) => (
            <p key={e.entidad} className="text-red-500 text-xs mt-0.5">
              · situación {e.situacion} en {e.entidad}
            </p>
          ))
      )}
      <p className="text-red-500 text-xs mt-0.5">El emisor registra deuda en el sistema financiero — evaluá si aceptás el cheque.</p>
    </div>
  )
}

/**
 * Cuentas conjuntas: un cheque puede tener 2+ CUITs impresos (cotitulares).
 * Consulta a todos pero responde UNA sola cosa: ¿se puede aceptar o no?
 * - Todos situación 1 → una línea verde (sin desglose por CUIT).
 * - Alguno situación 2+ → detalle SOLO del titular con problema, resaltando
 *   si la deuda está en el mismo banco que emitió el cheque.
 */
export function BcraDeudorMulti({
  cuits,
  bancoEmisor,
}: {
  cuits: (string | null | undefined)[]
  bancoEmisor?: string | null
}) {
  const unicos = [...new Set(cuits.map((c) => (c || "").replace(/\D/g, "")).filter((c) => c.length >= 10))]
  const clave = unicos.join(",")
  const [resultados, setResultados] = useState<BcraResultado[] | null>(null)
  const [consultando, setConsultando] = useState(false)

  useEffect(() => {
    if (!unicos.length) {
      setResultados(null)
      return
    }
    const timer = setTimeout(async () => {
      setConsultando(true)
      setResultados(null)
      try {
        const res = await Promise.all(
          unicos.map(async (c) => {
            try {
              const r = await fetch(`/api/bcra/deudor/${c}`)
              const d = await r.json()
              if (d.error)
                return { situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: d.error } as BcraResultado
              return d as BcraResultado
            } catch {
              return { situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: "Sin conexión con el BCRA" } as BcraResultado
            }
          })
        )
        setResultados(res)
      } finally {
        setConsultando(false)
      }
    }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  if (!unicos.length) return null

  if (consultando || (!resultados && unicos.length)) {
    if (!consultando && !resultados) return null
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-500">
        <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin shrink-0" />
        Consultando Central de Deudores (BCRA)…
      </div>
    )
  }
  if (!resultados) return null

  const conError = resultados.filter((r) => r.error)
  const conDeuda = resultados.filter((r) => !r.error && !r.apto)

  return (
    <div className="flex flex-col gap-1.5">
      {conDeuda.length === 0 && conError.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-xl border border-green-300 text-sm text-green-800">
          ✅ BCRA: se puede aceptar — situación 1 / sin antecedentes
          {unicos.length > 1 && <span className="text-green-600">({unicos.length} titulares consultados)</span>}
        </div>
      )}
      {conDeuda.map((r, i) => {
        const entidadDelCheque = bancoEmisor
          ? (r.entidades || []).find((e) => e.situacion > 1 && esMismoBanco(e.entidad, bancoEmisor))
          : null
        return (
          <div key={i} className="px-3 py-2 bg-red-50 rounded-xl border-2 border-red-400 text-sm">
            <p className="font-bold text-red-700">
              ⛔ BCRA: {SITUACION_LABEL[r.situacion_max] || `situación ${r.situacion_max}`}
              {r.denominacion && <span className="font-semibold"> · {r.denominacion}</span>}
            </p>
            {entidadDelCheque ? (
              <p className="text-red-700 text-xs mt-0.5 font-bold">
                🚨 La deuda (situación {entidadDelCheque.situacion}) es en {entidadDelCheque.entidad} — el
                MISMO banco que emitió este cheque.
              </p>
            ) : (
              (r.entidades || [])
                .filter((e) => e.situacion > 1)
                .slice(0, 3)
                .map((e) => (
                  <p key={e.entidad} className="text-red-500 text-xs mt-0.5">
                    · situación {e.situacion} en {e.entidad}
                  </p>
                ))
            )}
            <p className="text-red-500 text-xs mt-0.5">Evaluá si aceptás el cheque.</p>
          </div>
        )
      })}
      {conError.length > 0 && conDeuda.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-xl border border-amber-300 text-sm text-amber-800">
          ⚠️ No se pudo consultar el BCRA {conError.length < resultados.length ? "para uno de los titulares" : ""} —
          verificá el cheque a mano.
        </div>
      )}
    </div>
  )
}
