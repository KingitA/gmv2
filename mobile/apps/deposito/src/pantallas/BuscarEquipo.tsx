import { useCallback, useEffect, useState } from "react"
import { ErrorHttp, probarAlarmaLocal, detenerAlarmaLocal, useOnline, useRuntime } from "@gm/core"
import { fechaHora } from "@gm/formato"
import { C, Marco } from "../ui"

// /buscar-equipo — "Buscar el equipo de un compañero" (20/11/2026): los NuStar se pierden
// entre la mercadería. Lista de equipos de depósito (lo arma el servidor: GET
// /api/mobile/dispositivos) y en cada uno HACER SONAR / DETENER. Letra grande, un botón
// por equipo. Necesita señal (el aviso sale del servidor). MOBILE.md → "Hacer sonar un equipo".

interface Equipo {
  device_id: string
  app: "deposito"
  usuario: string | null
  ultimo_contacto_at: string | null
  motivo: string | null
  es_este: boolean
}

const boton = (fondo: string, color = "#fff") => ({
  width: "100%", minHeight: 60, border: "none", borderRadius: 16, background: fondo, color, fontSize: 20, fontWeight: 800,
} as const)

export function BuscarEquipo() {
  const rt = useRuntime()
  const online = useOnline()
  const [equipos, setEquipos] = useState<Equipo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [avisos, setAvisos] = useState<Record<string, { ok: boolean; texto: string }>>({})
  const [enviando, setEnviando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!online) return
    setError(null)
    try {
      const r = await rt.api.get<{ equipos: Equipo[] }>("/api/mobile/dispositivos")
      setEquipos(r.equipos || [])
    } catch {
      setError("No se pudo traer la lista. Probá con señal.")
    }
  }, [online, rt.api])
  useEffect(() => void cargar(), [cargar])

  const accion = async (e: Equipo, que: "sonar" | "detener") => {
    setEnviando(e.device_id + que)
    try {
      const r = await rt.api.post<{ ok: boolean; mensaje: string }>(`/api/mobile/dispositivos/${encodeURIComponent(e.device_id)}/${que}`, { app: e.app })
      setAvisos((p) => ({ ...p, [e.device_id]: { ok: r.ok, texto: r.mensaje } }))
    } catch (err) {
      const texto = err instanceof ErrorHttp ? err.body?.mensaje || err.body?.error || "No se pudo avisar al equipo." : "Sin señal: probá de nuevo."
      setAvisos((p) => ({ ...p, [e.device_id]: { ok: false, texto } }))
    } finally {
      setEnviando(null)
    }
  }

  return (
    <Marco titulo="Buscar un equipo">
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 16, color: C.sub, lineHeight: 1.4 }}>
          Tocá <b style={{ color: C.text }}>HACER SONAR</b> en el equipo que se perdió: suena fuerte hasta 60 segundos o hasta que lo apaguen.
        </p>

        {!online && <p style={{ margin: 0, padding: 14, borderRadius: 14, background: C.yellowL, border: `1px solid ${C.yellowB}`, color: C.text, fontSize: 16 }}>Necesitás señal para hacer sonar un equipo.</p>}
        {error && <p style={{ margin: 0, padding: 14, borderRadius: 14, background: C.redL, border: `1px solid ${C.redB}`, color: C.red, fontSize: 16, fontWeight: 700 }}>{error}</p>}
        {online && !equipos && !error && <p style={{ margin: 0, color: C.sub, fontSize: 16 }}>Buscando los equipos…</p>}
        {equipos?.length === 0 && <p style={{ margin: 0, color: C.sub, fontSize: 16 }}>No hay equipos de depósito para mostrar.</p>}

        {equipos?.map((e) => {
          const aviso = avisos[e.device_id]
          return (
            <div key={e.device_id} style={{ background: C.white, border: `1.5px solid ${e.es_este ? C.indigoB : C.border}`, borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>
                  {e.usuario || "Sin usuario"} {e.es_este && <span style={{ fontSize: 14, color: C.indigo }}>· ESTE EQUIPO</span>}
                </div>
                <div style={{ fontSize: 14, color: C.sub, marginTop: 2 }}>
                  Equipo {e.device_id.slice(0, 6).toUpperCase()} · última vez {e.ultimo_contacto_at ? fechaHora(e.ultimo_contacto_at) : "—"}
                </div>
              </div>
              {e.es_este ? (
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                  <button type="button" onClick={() => void probarAlarmaLocal()} style={boton(C.indigo)}>PROBAR ACÁ</button>
                  <button type="button" onClick={() => void detenerAlarmaLocal()} style={boton(C.bg, C.text)}>APAGAR</button>
                </div>
              ) : e.motivo ? (
                <p style={{ margin: 0, fontSize: 15, color: C.sub }}>{e.motivo}</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                  <button type="button" disabled={!!enviando || !online} onClick={() => void accion(e, "sonar")} style={{ ...boton(C.red), opacity: enviando || !online ? 0.6 : 1 }}>
                    {enviando === e.device_id + "sonar" ? "Enviando…" : "🔔 HACER SONAR"}
                  </button>
                  <button type="button" disabled={!!enviando || !online} onClick={() => void accion(e, "detener")} style={{ ...boton(C.bg, C.text), border: `1.5px solid ${C.border}`, opacity: enviando || !online ? 0.6 : 1 }}>
                    DETENER
                  </button>
                </div>
              )}
              {aviso && <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: aviso.ok ? C.green : C.red }}>{aviso.texto}</p>}
            </div>
          )
        })}
      </div>
    </Marco>
  )
}
