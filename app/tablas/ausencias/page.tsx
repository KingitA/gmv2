"use client"

// VACACIONES Y AUSENCIAS (Ajustes → Personas). Todos los empleados son usuarios:
// acá se carga quién no viene y de cuándo a cuándo. Se ven en "Armar mes" y
// Jarvis avisa si un chofer de vacaciones quedó asignado a un viaje.
// No se borran: se anulan (queda quién la cargó y quién la anuló, en la bitácora).

import { useEffect, useMemo, useState } from "react"
import { Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { fecha as fmtFecha, hoyISO } from "@/lib/formato"
import { cn } from "@/lib/utils"

interface Persona { id: string; nombre: string; roles: string[]; activo: boolean }
interface Ausencia { id: string; usuario_id: string; nombre: string; desde: string; hasta: string; tipo: string; nota: string | null; cargado_por: string; created_at: string }

const ROL: Record<string, string> = { admin: "Admin", administrativo: "Oficina", chofer: "Chofer", deposito: "Depósito", vendedor: "Vendedor", viajante: "Viajante", mostrador: "Mostrador" }
const TIPO: Record<string, string> = { vacaciones: "Vacaciones", licencia: "Licencia", otro: "Otro" }

export default function AusenciasPage() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [ausencias, setAusencias] = useState<Ausencia[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nueva, setNueva] = useState({ usuario_id: "", desde: "", hasta: "", tipo: "vacaciones", nota: "" })
  const [guardando, setGuardando] = useState(false)
  const [filtroRol, setFiltroRol] = useState("")

  const cargar = async () => {
    try {
      const r = await fetch("/api/personal/ausencias")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setPersonas(j.personas)
      setAusencias(j.ausencias)
      setError(null)
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar")
    } finally {
      setCargando(false)
    }
  }
  useEffect(() => { cargar() }, [])

  const guardar = async () => {
    setGuardando(true)
    try {
      const r = await fetch("/api/personal/ausencias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nueva) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success("Cargada. Quedó a tu nombre.")
      setNueva({ usuario_id: "", desde: "", hasta: "", tipo: "vacaciones", nota: "" })
      cargar()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo cargar")
    } finally {
      setGuardando(false)
    }
  }

  const anular = async (a: Ausencia) => {
    if (!confirm(`¿Anular ${TIPO[a.tipo]?.toLowerCase() ?? a.tipo} de ${a.nombre} (${fmtFecha(a.desde)} al ${fmtFecha(a.hasta)})?`)) return
    const r = await fetch(`/api/personal/ausencias/${a.id}/anular`, { method: "POST" })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) toast.error(j.error || "No se pudo anular")
    else toast.success("Anulada. Quedó registrado quién la anuló.")
    cargar()
  }

  const hoy = hoyISO()
  const roles = useMemo(() => [...new Set(personas.flatMap((p) => p.roles))].filter((r) => ROL[r]), [personas])
  const rolesDe = (id: string) => personas.find((p) => p.id === id)?.roles ?? []
  const visibles = ausencias.filter((a) => !filtroRol || rolesDe(a.usuario_id).includes(filtroRol))

  if (cargando) return <div className="p-6"><CargaProgreso mensajes={MENSAJES.general} className="mx-auto max-w-sm py-10" /></div>

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-azul-900">Vacaciones y ausencias</h1>
        <p className="text-sm text-neutro-500">Quién no viene y cuándo. Se ve en el calendario de viajes; Jarvis avisa si un chofer de vacaciones quedó en un viaje.</p>
      </div>
      {error && <p className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">{error}</p>}

      <section className="rounded-2xl border bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-azul-900">Cargar</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1 text-xs text-neutro-500">Persona
            <select value={nueva.usuario_id} onChange={(e) => setNueva({ ...nueva, usuario_id: e.target.value })}
              className="mt-0.5 block w-full rounded-lg border border-neutro-200 bg-white px-2 py-2 text-sm text-neutro-800">
              <option value="">Elegí…</option>
              {personas.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.roles.length ? ` · ${p.roles.map((r) => ROL[r] ?? r).join(", ")}` : ""}</option>)}
            </select>
          </label>
          <label className="text-xs text-neutro-500">Desde<DateInputAR className="mt-0.5 w-36" value={nueva.desde} onChange={(v) => setNueva({ ...nueva, desde: v, hasta: nueva.hasta || v })} /></label>
          <label className="text-xs text-neutro-500">Hasta (inclusive)<DateInputAR className="mt-0.5 w-36" value={nueva.hasta} min={nueva.desde || undefined} onChange={(v) => setNueva({ ...nueva, hasta: v })} /></label>
          <label className="text-xs text-neutro-500">Tipo
            <select value={nueva.tipo} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value })} className="mt-0.5 block rounded-lg border border-neutro-200 bg-white px-2 py-2 text-sm text-neutro-800">
              {Object.entries(TIPO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
          <label className="min-w-[180px] flex-1 text-xs text-neutro-500">Nota (opcional)
            <input value={nueva.nota} onChange={(e) => setNueva({ ...nueva, nota: e.target.value })} className="mt-0.5 block w-full rounded-lg border border-neutro-200 px-2 py-2 text-sm" />
          </label>
          <Button onClick={guardar} disabled={guardando || !nueva.usuario_id || !nueva.desde || !nueva.hasta}><Plus className="h-4 w-4" />{guardando ? "Guardando…" : "Cargar"}</Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-azul-900">Cargadas (desde hace 30 días)</p>
          <select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)} className="rounded-lg border border-neutro-200 bg-white px-2 py-1 text-xs">
            <option value="">Todos</option>
            {roles.map((r) => <option key={r} value={r}>{ROL[r]}</option>)}
          </select>
        </div>
        {visibles.length === 0 ? <p className="text-sm text-neutro-500">No hay ausencias cargadas.</p> : (
          <ul className="divide-y divide-neutro-100">
            {visibles.map((a) => {
              const enCurso = a.desde <= hoy && a.hasta >= hoy
              const paso = a.hasta < hoy
              return (
                <li key={a.id} className={cn("flex flex-wrap items-center gap-3 py-2", paso && "opacity-60")}>
                  <div className="min-w-[220px] flex-1">
                    <p className="text-sm font-semibold text-azul-900">{a.nombre} <span className="font-normal text-neutro-500">· {rolesDe(a.usuario_id).map((r) => ROL[r] ?? r).join(", ")}</span></p>
                    <p className="text-xs text-neutro-500">{TIPO[a.tipo] ?? a.tipo} · {fmtFecha(a.desde)} al {fmtFecha(a.hasta)}{a.nota ? ` · ${a.nota}` : ""} · cargó {a.cargado_por}</p>
                  </div>
                  {enCurso && <span className="rounded-full bg-cian-100 px-2 py-0.5 text-xs font-semibold text-cian-800">Ahora</span>}
                  <button type="button" onClick={() => anular(a)} className="grid size-7 place-items-center rounded-lg text-neutro-300 hover:bg-neutro-100 hover:text-error-600" title="Anular (queda registrado)"><X className="h-4 w-4" /></button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
