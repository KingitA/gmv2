"use client"

// #43 — Gastos del viaje dentro de "Controlar rendición" (Caja). La oficina los
// aprueba o rechaza AL ACEPTAR la rendición, con su concepto (nafta, camión,
// peón, hotel u otro) y el vehículo. Las decisiones viajan en el confirmar
// (body.gastos) y el servidor las aplica (lib/viajes/gastos-rendicion.ts).

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { fecha, moneda } from "@/lib/formato"
import { CATEGORIAS_GASTO, ETIQUETA_CATEGORIA, type DecisionGasto } from "@/lib/viajes/gastos-rendicion"

type Gasto = {
  id: string
  categoria: string
  monto: number
  observaciones: string | null
  foto_url: string | null
  estado: string
  vehiculo_id?: string | null
  created_at: string
  motivo_rechazo: string | null
}

const NUM = { fontVariantNumeric: "tabular-nums" } as const

export function GastosRendicion({
  viajeId,
  decisiones,
  onChange,
}: {
  viajeId: string
  decisiones: Record<string, DecisionGasto>
  onChange: (d: Record<string, DecisionGasto>) => void
}) {
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [vehiculos, setVehiculos] = useState<{ id: string; nombre: string }[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const sb = createClient()
    Promise.all([
      sb.from("viajes_gastos").select("*").eq("viaje_id", viajeId).order("created_at", { ascending: true }),
      sb.from("viajes").select("vehiculo_id").eq("id", viajeId).maybeSingle(),
      sb.from("vehiculos").select("id, nombre, patente").eq("activo", true).order("nombre"),
    ])
      .then(([g, v, ve]: any[]) => {
        const lista = ((g.data || []) as any[]).map((x) => ({ ...x, monto: Number(x.monto) || 0 })) as Gasto[]
        setGastos(lista)
        setVehiculos(((ve.data || []) as any[]).map((x) => ({ id: x.id, nombre: x.patente ? `${x.nombre} · ${x.patente}` : x.nombre })))
        // Por defecto: aprobar, con su concepto y el vehículo del viaje
        const vehiculoViaje = (v.data?.vehiculo_id as string | null) ?? null
        const ini: Record<string, DecisionGasto> = {}
        for (const x of lista.filter((x) => x.estado === "declarado")) {
          ini[x.id] = { id: x.id, aprobar: true, categoria: x.categoria, vehiculo_id: x.vehiculo_id ?? vehiculoViaje, motivo: "" }
        }
        onChange(ini)
      })
      .finally(() => setCargando(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viajeId])

  if (cargando || gastos.length === 0) return null

  const cambiar = (id: string, patch: Partial<DecisionGasto>) => onChange({ ...decisiones, [id]: { ...decisiones[id], ...patch } })
  const pendientes = gastos.filter((g) => g.estado === "declarado")

  return (
    <div className="mt-3 rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-semibold text-neutro-500">
        Gastos del viaje {pendientes.length > 0 && <span className="font-normal">— aprobá o rechazá cada uno al aceptar la rendición</span>}
      </p>
      <div className="mt-1.5 space-y-1.5">
        {gastos.map((g) => {
          const d = decisiones[g.id]
          if (g.estado !== "declarado" || !d) {
            return (
              <div key={g.id} className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="truncate">{ETIQUETA_CATEGORIA[g.categoria] || g.categoria}{g.observaciones ? ` — ${g.observaciones}` : ""}</span>
                <span className="ml-2 shrink-0">
                  <span style={NUM}>{moneda(g.monto)}</span>{" "}
                  <b className={g.estado === "aprobado" ? "text-exito-700" : "text-error-700"}>{g.estado === "aprobado" ? "aprobado" : "rechazado"}</b>
                </span>
              </div>
            )
          }
          return (
            <div key={g.id} className={`rounded-md border px-2 py-1.5 ${d.aprobar ? "border-slate-200" : "border-error-200 bg-error-50/40"}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {g.observaciones || ETIQUETA_CATEGORIA[g.categoria] || g.categoria}
                  <span className="ml-1 text-[11px] text-slate-400">{fecha(g.created_at)}</span>
                  {g.foto_url && <a className="ml-1 text-[11px] text-blue-600 underline" href={g.foto_url} target="_blank" rel="noreferrer">ticket</a>}
                </span>
                <span className="font-semibold" style={NUM}>{moneda(g.monto)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <select
                  value={d.categoria}
                  onChange={(e) => cambiar(g.id, { categoria: e.target.value })}
                  aria-label="Concepto del gasto"
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
                >
                  {CATEGORIAS_GASTO.map((c) => <option key={c} value={c}>{ETIQUETA_CATEGORIA[c]}</option>)}
                </select>
                <select
                  value={d.vehiculo_id || ""}
                  onChange={(e) => cambiar(g.id, { vehiculo_id: e.target.value || null })}
                  aria-label="Vehículo"
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
                >
                  <option value="">Sin vehículo</option>
                  {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                </select>
                <div className="ml-auto flex overflow-hidden rounded border border-slate-300 text-xs">
                  <button type="button" onClick={() => cambiar(g.id, { aprobar: true })} className={`px-2 py-0.5 ${d.aprobar ? "bg-exito-600 text-white" : "bg-white text-slate-600"}`}>Aprobar</button>
                  <button type="button" onClick={() => cambiar(g.id, { aprobar: false })} className={`px-2 py-0.5 ${!d.aprobar ? "bg-error-600 text-white" : "bg-white text-slate-600"}`}>Rechazar</button>
                </div>
              </div>
              {!d.aprobar && (
                <input
                  value={d.motivo || ""}
                  onChange={(e) => cambiar(g.id, { motivo: e.target.value })}
                  placeholder="Motivo del rechazo (lo ve el chofer; el importe vuelve a figurar en su cuenta)"
                  className="mt-1 w-full rounded border border-error-300 bg-white px-2 py-1 text-xs outline-none"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
