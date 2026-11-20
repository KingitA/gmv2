"use client"

import { useEffect, useMemo, useState } from "react"
import { Smartphone, AlertCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { CargaProgreso } from "@/components/ui/carga-progreso"
import { fechaHora } from "@/lib/formato"

// Equipos de las apps (vendedor / chofer / depósito): quién usa cada uno, qué versión
// tiene y cuándo se conectó por última vez, contra la última versión publicada
// (actualización con un botón, 17/11/2026). Solo admin.

type Equipo = {
  device_id: string
  app: string
  usuario: string | null
  app_version: string | null
  app_version_code: number | null
  ultimo_contacto_at: string | null
  revocado: boolean
  motivo_no_suena: string | null
}
type Ultima = { app: string; version_name: string; version_code: number; obligatoria: boolean; publicada_at: string }

const APPS: Record<string, string> = { vendedor: "Vendedor", chofer: "Chofer", deposito: "Depósito" }

export default function EquiposPage() {
  const [datos, setDatos] = useState<{ equipos: Equipo[]; ultimas: Record<string, Ultima>; firebase_configurado?: boolean } | null>(null)
  // Hacer sonar un equipo perdido (20/11/2026): aviso por equipo tras tocar el botón
  const [avisos, setAvisos] = useState<Record<string, { ok: boolean; texto: string }>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  const accion = async (e: Equipo, que: "sonar" | "detener") => {
    const k = `${e.device_id}-${e.app}`
    setEnviando(k + que)
    try {
      const r = await fetch(`/api/mobile/dispositivos/${encodeURIComponent(e.device_id)}/${que}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: e.app }),
      })
      const b = await r.json().catch(() => null)
      setAvisos((p) => ({ ...p, [k]: { ok: !!b?.ok, texto: b?.mensaje || b?.error || "No se pudo avisar al equipo." } }))
    } catch {
      setAvisos((p) => ({ ...p, [k]: { ok: false, texto: "Sin conexión con el servidor." } }))
    } finally {
      setEnviando(null)
    }
  }
  const [error, setError] = useState<string | null>(null)
  const [app, setApp] = useState<string>("")

  useEffect(() => {
    fetch("/api/admin/equipos-moviles", { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json()
        if (!r.ok) throw new Error(b?.error || "No se pudieron leer los equipos")
        setDatos(b)
      })
      .catch((e) => setError(e.message))
  }, [])

  const filas = useMemo(() => (datos?.equipos ?? []).filter((e) => !app || e.app === app), [datos, app])

  // Al día = tiene la última publicada (por versionCode; si el equipo no lo informa, por nombre)
  const alDia = (e: Equipo) => {
    const u = datos?.ultimas[e.app]
    if (!u) return null
    return e.app_version_code != null ? e.app_version_code >= u.version_code : e.app_version === u.version_name
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex items-center gap-3">
        <Smartphone className="h-6 w-6 text-slate-600" />
        <div>
          <h1 className="text-xl font-semibold">Equipos y apps</h1>
          <p className="text-sm text-muted-foreground">Versión instalada en cada equipo y última conexión. Las apps se actualizan solas con el botón ACTUALIZAR del inicio.</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}
      {!datos && !error && <CargaProgreso />}

      {datos && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(APPS).map(([k, label]) => {
              const u = datos.ultimas[k]
              const deApp = datos.equipos.filter((e) => e.app === k)
              const atrasados = deApp.filter((e) => alDia(e) === false).length
              return (
                <button key={k} onClick={() => setApp(app === k ? "" : k)}
                  className={`rounded-xl border p-4 text-left transition ${app === k ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                  <p className="text-sm font-medium text-slate-500">App {label}</p>
                  <p className="mt-1 text-lg font-semibold">{u ? `v${u.version_name}` : "Sin publicar"}</p>
                  <p className="text-xs text-muted-foreground">
                    {u ? `Publicada ${fechaHora(u.publicada_at)}${u.obligatoria ? " · obligatoria" : ""}` : "Se publica con npm run publicar:apk"}
                  </p>
                  <p className="mt-2 text-xs">
                    {deApp.length} {deApp.length === 1 ? "equipo" : "equipos"}
                    {atrasados > 0 && <span className="font-semibold text-amber-700"> · {atrasados} sin actualizar</span>}
                  </p>
                </button>
              )
            })}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Equipo</th>
                  <th className="px-4 py-2.5">App</th>
                  <th className="px-4 py-2.5">Usuario</th>
                  <th className="px-4 py-2.5">Versión</th>
                  <th className="px-4 py-2.5">Última conexión</th>
                  <th className="px-4 py-2.5">Buscar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Todavía no se conectó ningún equipo.</td></tr>
                )}
                {filas.map((e) => {
                  const ok = alDia(e)
                  return (
                    <tr key={`${e.device_id}-${e.app}`} className={e.revocado ? "opacity-50" : ""}>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{e.device_id.slice(0, 8)}{e.revocado ? " (dado de baja)" : ""}</td>
                      <td className="px-4 py-2.5">{APPS[e.app] ?? e.app}</td>
                      <td className="px-4 py-2.5">{e.usuario ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{e.app_version ? `v${e.app_version}` : "—"}</span>
                        {ok === true && <Badge className="ml-2 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">al día</Badge>}
                        {ok === false && <Badge className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">sin actualizar</Badge>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{e.ultimo_contacto_at ? fechaHora(e.ultimo_contacto_at) : "—"}</td>
                      <td className="px-4 py-2.5">
                        {e.motivo_no_suena ? (
                          <span className="text-xs text-muted-foreground">{e.motivo_no_suena}</span>
                        ) : datos.firebase_configurado === false ? (
                          <span className="text-xs text-amber-700">Falta configurar Firebase</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button onClick={() => void accion(e, "sonar")} disabled={!!enviando}
                              className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                              {enviando === `${e.device_id}-${e.app}sonar` ? "Enviando…" : "🔔 HACER SONAR"}
                            </button>
                            <button onClick={() => void accion(e, "detener")} disabled={!!enviando}
                              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                              DETENER
                            </button>
                          </div>
                        )}
                        {avisos[`${e.device_id}-${e.app}`] && (
                          <p className={`mt-1 text-xs ${avisos[`${e.device_id}-${e.app}`]!.ok ? "text-emerald-700" : "text-red-700"}`}>{avisos[`${e.device_id}-${e.app}`]!.texto}</p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
