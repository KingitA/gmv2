import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { lecturaError, useOnline, useOverlay, useRuntime } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { useArticulos, useEncolar } from "../../datos/hooks"
import { C } from "../../ui"

// Artículo DADO DE BAJA (regla del dueño, 20/10/2026 — MOBILE.md §17).
// La réplica solo trae artículos activos. Cuando un código escaneado o tipeado no está en
// ella y hay señal, se le pregunta al servidor (GET /api/mobile/deposito/articulo-baja,
// online-only) si es de un artículo dado de baja; si lo es, se ofrece reactivarlo con
// la operación `articulo.reactivar` del outbox (el servidor registra quién y desde dónde).

export interface ArticuloBaja {
  id: string
  sku: string | null
  descripcion: string | null
}

export type ResultadoBaja = { tipo: "baja"; articulo: ArticuloBaja } | { tipo: "nada" } | { tipo: "sin_senal" } | { tipo: "error" }

type Mostrar = (m: string, t?: "ok" | "err") => void

export const SIN_SENAL_BAJA = "(sin señal no se puede ver si está dado de baja)"

export interface ControlBaja {
  /** Pregunta al servidor si el código es de un artículo dado de baja (sin abrir nada). */
  consultar: (codigo: string) => Promise<ResultadoBaja>
  /** Lectura del lector sin coincidencia local: avisa y, si está dado de baja, abre la hoja. */
  noEncontrado: (codigo: string) => Promise<void>
  /** Abre la hoja "¿Reactivarlo?" para un artículo ya consultado. */
  ofrecer: (a: ArticuloBaja) => void
  /** La hoja (va una vez en la pantalla). */
  hoja: ReactNode
}

/**
 * @param onReactivado se llama cuando el artículo reactivado ya llegó a la réplica
 *   (el parche de la respuesta del outbox), mientras la pantalla siga abierta.
 */
export function useDadoDeBaja(mostrar: Mostrar, onReactivado?: (articuloId: string) => void): ControlBaja {
  const { api } = useRuntime()
  const online = useOnline()
  const encolar = useEncolar()
  const { indice } = useArticulos()
  const { abierto, abrir, cerrar } = useOverlay("baja")
  const [art, setArt] = useState<ArticuloBaja | null>(null)
  const [esperando, setEsperando] = useState<ArticuloBaja | null>(null)

  // Abierta por historial (adelante) sin el artículo en memoria: no hay nada que mostrar
  useEffect(() => {
    if (abierto && !art) cerrar()
  }, [abierto, art, cerrar])

  // Reactivado y ya en la réplica ⇒ avisar (y abrirlo, si la pantalla lo pide)
  useEffect(() => {
    if (!esperando || !indice.porId.has(esperando.id)) return
    setEsperando(null)
    mostrar(`✓ Reactivado: ${esperando.descripcion || esperando.sku || "artículo"}${onReactivado ? "" : " — escanealo de nuevo"}`)
    onReactivado?.(esperando.id)
  }, [esperando, indice, mostrar, onReactivado])

  const consultar = useCallback(
    async (codigo: string): Promise<ResultadoBaja> => {
      if (!online) return { tipo: "sin_senal" }
      try {
        const r = await api.get<{ articulo: ArticuloBaja | null }>(`/api/mobile/deposito/articulo-baja?codigo=${encodeURIComponent(codigo.trim())}`, { timeoutMs: 8000 })
        return r?.articulo ? { tipo: "baja", articulo: r.articulo } : { tipo: "nada" }
      } catch {
        return { tipo: "error" }
      }
    },
    [api, online],
  )

  const ofrecer = useCallback((a: ArticuloBaja) => { setArt(a); abrir() }, [abrir])
  // La consulta es asíncrona: al volver, abrir con la URL de ESE momento (no la del render viejo)
  const ofrecerActual = useRef(ofrecer)
  ofrecerActual.current = ofrecer

  const noEncontrado = useCallback(
    async (codigo: string) => {
      lecturaError()
      const r = await consultar(codigo)
      if (r.tipo === "baja") { ofrecerActual.current(r.articulo); return }
      const extra = r.tipo === "sin_senal" ? ` ${SIN_SENAL_BAJA}` : r.tipo === "error" ? " (no se pudo ver si está dado de baja)" : ""
      mostrar(`No se encontró el código ${codigo}${extra}`, "err")
    },
    [consultar, mostrar],
  )

  const reactivar = async () => {
    if (!art) return
    await encolar("articulo.reactivar", { articulo_id: art.id }, `Reactivar ${art.sku || ""} ${art.descripcion || ""}`.trim())
    setEsperando(art)
    cerrar()
    mostrar(online ? "Reactivando… aparece en cuanto se sincronice" : "Queda para enviar: el artículo aparece cuando vuelva la señal")
  }

  const hoja = (
    <Hoja abierta={abierto && !!art} onCerrar={cerrar} titulo="Artículo dado de baja">
      {art && (
        <>
          <p style={{ fontSize: 16, color: C.text, margin: "0 0 16px", lineHeight: 1.4 }}>
            Este artículo está dado de baja: <b style={{ fontFamily: "monospace" }}>{art.sku || "—"}</b> <b>{art.descripcion || ""}</b>. ¿Reactivarlo?
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <button onClick={cerrar} style={{ background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "16px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>Cancelar</button>
            <button onClick={() => void reactivar()} style={{ background: C.green, color: "#fff", fontWeight: 800, fontSize: 16, padding: "16px 0", borderRadius: 16, border: "none" }}>♻️ Reactivar</button>
          </div>
        </>
      )}
    </Hoja>
  )

  return { consultar, noEncontrado, ofrecer, hoja }
}

/** Aviso dentro del buscador cuando lo TIPEADO es el código de un artículo dado de baja. */
export function AvisoBaja({ resultado, onReactivar }: { resultado: ResultadoBaja | null; onReactivar: (a: ArticuloBaja) => void }) {
  if (!resultado || resultado.tipo === "nada" || resultado.tipo === "error") return null
  if (resultado.tipo === "sin_senal") {
    return <div style={{ margin: "0 16px 10px", fontSize: 13, color: C.sub, textAlign: "center" }}>Sin coincidencias {SIN_SENAL_BAJA}</div>
  }
  const a = resultado.articulo
  return (
    <div style={{ margin: "0 16px 10px", background: C.yellowL, border: `1.5px solid ${C.yellowB}`, borderRadius: 16, padding: "12px 16px" }}>
      <div style={{ fontSize: 15, color: C.text, lineHeight: 1.4 }}>
        Este artículo está dado de baja: <b style={{ fontFamily: "monospace" }}>{a.sku || "—"}</b> <b>{a.descripcion || ""}</b>
      </div>
      <button onClick={() => onReactivar(a)} style={{ marginTop: 10, width: "100%", background: C.green, color: "#fff", fontWeight: 800, fontSize: 16, padding: "14px 0", borderRadius: 14, border: "none" }}>♻️ ¿Reactivarlo?</button>
    </div>
  )
}
