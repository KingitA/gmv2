"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  bcraError,
  cuitValido,
  esMismoBanco,
  normalizarCuit,
  SITUACION_LABEL,
  veredictoBcra,
  type BcraResultado,
  type VeredictoBcra,
} from "@/lib/cheques/isomorfico"

// Chequeo del CUIT del emisor de un cheque contra la Central de Deudores del
// BCRA (proxy Edge /api/bcra/deudor/[cuit]). Reutilizable en oficina
// (MetodoPagoForm), cobro del vendedor y chofer. Las reglas (veredicto, mismo
// banco, etiquetas) viven en lib/cheques; acá solo la consulta y el pintado.
//
// Solo se consulta un CUIT COMPLETO y válido (dígito verificador): nada a medio
// tipear. La consulta nunca bloquea nada: el cobro se registra igual.

export type { BcraResultado }
export { esMismoBanco }

const BCRA_TIMEOUT_MS = 12_000

/** Consulta un CUIT (ya validado). Nunca lanza. */
export async function consultarBcra(cuit: string): Promise<BcraResultado> {
  const limpio = cuit.replace(/\D/g, "")
  try {
    const res = await fetch(`/api/bcra/deudor/${limpio}`, { signal: AbortSignal.timeout(BCRA_TIMEOUT_MS) })
    const d = await res.json().catch(() => null)
    if (!d || d.error) return bcraError(limpio, d?.error || `Error ${res.status}`)
    return { ...d, cuit: limpio, entidades: d.entidades || [] }
  } catch (e: any) {
    return bcraError(limpio, e?.name === "TimeoutError" ? "El BCRA no respondió a tiempo" : "Sin conexión con el BCRA")
  }
}

// Caché de sesión: el mismo CUIT no se consulta dos veces (oficina abre y cierra el form).
const cache = new Map<string, BcraResultado>()

export function useBcraDeudor(cuit: string | null | undefined) {
  const [resultado, setResultado] = useState<BcraResultado | null>(null)
  const [consultando, setConsultando] = useState(false)

  useEffect(() => {
    const limpio = (cuit || "").replace(/\D/g, "")
    if (!cuitValido(limpio)) {
      setResultado(null)
      return
    }
    const ya = cache.get(limpio)
    if (ya) {
      setResultado(ya)
      return
    }
    let vivo = true
    const timer = setTimeout(async () => {
      setConsultando(true)
      setResultado(null)
      const r = await consultarBcra(limpio)
      if (!r.error) cache.set(limpio, r)
      if (vivo) {
        setResultado(r)
        setConsultando(false)
      }
    }, 500)
    return () => {
      vivo = false
      clearTimeout(timer)
    }
  }, [cuit])

  return { resultado, consultando }
}

// ─── Consultas en segundo plano a nivel PÁGINA (chofer / vendedor web) ────────
//
// El formulario de cobro dispara la consulta cuando el CUIT queda completo y sigue
// su vida: si el operario registra el cobro antes de que el BCRA conteste, el
// resultado igual llega y se muestra como aviso en la página (patrón de avisos de
// la app vendedor). Cada consulta lleva el contexto del cheque para que el aviso
// diga de qué cheque habla.

export interface ContextoCheque {
  cuits: string[]
  banco?: string | null
  numero_cheque?: string | null
  monto?: number | null
  cliente_nombre?: string | null
}

export interface ConsultaBcra {
  id: string
  ctx: ContextoCheque
  consultando: boolean
  veredicto: VeredictoBcra | null
  /** Ya se mostró en el formulario mientras estaba abierto: no hace falta el aviso */
  visto: boolean
  iniciada_at: number
}

class AlmacenConsultas {
  private mapa = new Map<string, ConsultaBcra>()
  private subs = new Set<() => void>()
  private snapshot: ConsultaBcra[] = []
  /** Cards de cheque montadas (formulario abierto): mientras haya, los "consultando" se ven ahí y no en el aviso global */
  montajes = 0
  suscribir = (fn: () => void) => {
    this.subs.add(fn)
    return () => void this.subs.delete(fn)
  }
  lista = () => this.snapshot
  private emitir() {
    this.snapshot = [...this.mapa.values()]
    for (const fn of this.subs) fn()
  }
  get(id: string) {
    return this.mapa.get(id) ?? null
  }
  consultar(id: string, ctx: ContextoCheque) {
    const cuits = [...new Set(ctx.cuits.map((c) => normalizarCuit(c)).filter((c): c is string => !!c))]
    if (!cuits.length) {
      if (this.mapa.delete(id)) this.emitir()
      return
    }
    const clave = cuits.join(",")
    const previa = this.mapa.get(id)
    if (previa && previa.ctx.cuits.join(",") === clave) return // mismo CUIT: ya está en curso o resuelta
    const c: ConsultaBcra = { id, ctx: { ...ctx, cuits }, consultando: true, veredicto: null, visto: false, iniciada_at: Date.now() }
    this.mapa.set(id, c)
    this.emitir()
    void Promise.all(cuits.map(async (cuit) => cache.get(cuit.replace(/\D/g, "")) ?? consultarBcra(cuit))).then((res) => {
      for (const r of res) if (!r.error) cache.set(r.cuit, r)
      const actual = this.mapa.get(id)
      if (!actual || actual.ctx.cuits.join(",") !== clave) return // cambió el CUIT mientras tanto
      this.mapa.set(id, { ...actual, consultando: false, veredicto: veredictoBcra(res, ctx.banco) })
      this.emitir()
    })
  }
  marcarVisto(id: string) {
    const c = this.mapa.get(id)
    if (c && !c.visto) {
      this.mapa.set(id, { ...c, visto: true })
      this.emitir()
    }
  }
  quitar(id: string) {
    if (this.mapa.delete(id)) this.emitir()
  }
  montar(delta: number) {
    this.montajes = Math.max(0, this.montajes + delta)
    this.emitir()
  }
  /** El formulario se cerró: lo que ya se vio se descarta; lo pendiente/no visto queda para avisar. */
  cerrarFormulario() {
    let cambio = false
    for (const [id, c] of this.mapa) if (c.visto) { this.mapa.delete(id); cambio = true }
    if (cambio) this.emitir()
  }
}

const almacen = new AlmacenConsultas()

export function useConsultasBcra() {
  const lista = useSyncExternalStore(almacen.suscribir, almacen.lista, almacen.lista)
  const consultar = useCallback((id: string, ctx: ContextoCheque) => almacen.consultar(id, ctx), [])
  const quitar = useCallback((id: string) => almacen.quitar(id), [])
  const cerrarFormulario = useCallback(() => almacen.cerrarFormulario(), [])
  const avisos = lista.filter((c) => !c.visto && c.veredicto)
  const pendientes = almacen.montajes === 0 ? lista.filter((c) => c.consultando && !c.visto) : []
  return { consultas: lista, consultar, quitar, cerrarFormulario, avisos, pendientes }
}

/**
 * Dispara la consulta de una fila cuando su CUIT queda completo y válido. Se usa
 * desde la card del cheque; `id` = id de la fila.
 */
export function useConsultaBcraFila(id: string, ctx: ContextoCheque | null) {
  const clave = ctx ? ctx.cuits.map((c) => c.replace(/\D/g, "")).filter(cuitValido).join(",") : ""
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  useEffect(() => {
    if (!clave) return
    const t = setTimeout(() => ctxRef.current && almacen.consultar(id, ctxRef.current), 500)
    return () => clearTimeout(t)
  }, [id, clave])
  useEffect(() => {
    almacen.montar(1)
    return () => almacen.montar(-1)
  }, [])
  const consultas = useSyncExternalStore(almacen.suscribir, almacen.lista, almacen.lista)
  const consulta = consultas.find((c) => c.id === id) ?? null
  // Si el resultado se pintó con el formulario abierto, no hace falta avisar después
  useEffect(() => {
    if (consulta?.veredicto && !consulta.visto) almacen.marcarVisto(id)
  }, [id, consulta?.veredicto, consulta?.visto])
  return consulta
}

// ─── Pintado ─────────────────────────────────────────────────────────────────

const CLS_POR_VEREDICTO = {
  apto: "bg-green-50 border-green-300 text-green-800",
  riesgo: "bg-red-50 border-2 border-red-400 text-red-800",
  sin_respuesta: "bg-amber-50 border-amber-300 text-amber-800",
} as const

/** Resultado de una consulta (una sola línea + detalle si hay riesgo). */
export function VeredictoBcraCard({ v, compacto = false }: { v: VeredictoBcra; compacto?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${CLS_POR_VEREDICTO[v.veredicto]}`}>
      <p className={v.veredicto === "riesgo" ? "font-bold" : "font-medium"}>{v.titulo}</p>
      {!compacto &&
        v.detalle.slice(0, 4).map((d, i) => (
          <p key={i} className={`mt-0.5 text-xs ${d.startsWith("🚨") ? "font-bold" : "opacity-80"}`}>
            {d}
          </p>
        ))}
    </div>
  )
}

export function ConsultandoBcra() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
      <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
      Consultando Central de Deudores (BCRA)… el cobro se puede registrar igual.
    </div>
  )
}

/** Avisos de consultas que terminaron después de cerrar el formulario. */
export function AvisosBcra({ avisos, pendientes, onVisto }: { avisos: ConsultaBcra[]; pendientes?: ConsultaBcra[]; onVisto: (id: string) => void }) {
  if (!avisos.length && !pendientes?.length) return null
  const titulo = (c: ConsultaBcra) => [c.ctx.numero_cheque ? `Cheque ${c.ctx.numero_cheque}` : "Cheque", c.ctx.banco, c.ctx.cliente_nombre].filter(Boolean).join(" · ")
  return (
    <div className="space-y-2">
      {pendientes?.map((c) => (
        <div key={c.id} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          {titulo(c)}: consultando el BCRA…
        </div>
      ))}
      {avisos.map((c) => (
        <div key={c.id} className={`rounded-xl border px-3 py-2 text-sm ${CLS_POR_VEREDICTO[c.veredicto!.veredicto]}`}>
          <p className="text-xs opacity-70">{titulo(c)}</p>
          <p className={c.veredicto!.veredicto === "riesgo" ? "font-bold" : "font-medium"}>{c.veredicto!.titulo}</p>
          {c.veredicto!.detalle.slice(0, 3).map((d, i) => (
            <p key={i} className="mt-0.5 text-xs opacity-80">
              {d}
            </p>
          ))}
          <button type="button" onClick={() => onVisto(c.id)} className="mt-1.5 rounded-lg border border-current px-3 py-1 text-xs font-bold">
            Visto
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Componentes históricos (oficina) ────────────────────────────────────────

export function BcraDeudorChip({ cuit, bancoEmisor }: { cuit: string | null | undefined; bancoEmisor?: string | null }) {
  const { resultado, consultando } = useBcraDeudor(cuit)
  if (consultando) return <ConsultandoBcra />
  if (!resultado) return null
  return <VeredictoBcraCard v={veredictoBcra([resultado], bancoEmisor)} />
}

/** Cuentas conjuntas: consulta a todos los CUITs y responde UNA cosa. */
export function BcraDeudorMulti({ cuits, bancoEmisor }: { cuits: (string | null | undefined)[]; bancoEmisor?: string | null }) {
  const unicos = [...new Set(cuits.map((c) => (c || "").replace(/\D/g, "")).filter(cuitValido))]
  const clave = unicos.join(",")
  const [resultados, setResultados] = useState<BcraResultado[] | null>(null)
  const [consultando, setConsultando] = useState(false)

  useEffect(() => {
    if (!unicos.length) {
      setResultados(null)
      return
    }
    let vivo = true
    const timer = setTimeout(async () => {
      setConsultando(true)
      setResultados(null)
      const res = await Promise.all(unicos.map(async (c) => cache.get(c) ?? consultarBcra(c)))
      for (const r of res) if (!r.error) cache.set(r.cuit, r)
      if (vivo) {
        setResultados(res)
        setConsultando(false)
      }
    }, 500)
    return () => {
      vivo = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  if (!unicos.length) return null
  if (consultando) return <ConsultandoBcra />
  if (!resultados) return null
  return <VeredictoBcraCard v={veredictoBcra(resultados, bancoEmisor)} />
}

export { SITUACION_LABEL }
