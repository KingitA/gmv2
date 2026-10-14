"use client"

// Materias primas y precios de afuera (dentro de "Jarvis: reglas y decisiones").
// - Precios de afuera: dólar, inflación (fuente pública) y materias primas (búsqueda de Jarvis), con fuente.
// - Clasificación de artículos por materia prima: cuánto falta, botón para seguir, y las DUDAS
//   para que una persona las confirme o corrija (queda a su nombre; Jarvis no lo vuelve a cambiar).

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { fecha as fmtFecha, numero } from "@/lib/formato"

interface Indicador { clave: string; nombre: string; unidad: string; valor: number | null; fecha: string | null; variacion_30d: number | null; fuente: string | null; fuente_url: string | null }
interface Duda { articulo_id: string; articulo: string; proveedor: string | null; categoria: string | null; propuesta: string; confianza: number; motivo: string | null }
interface Datos {
  indicadores: Indicador[]
  cobertura: { activos: number; clasificados: number; por_persona: number; dudas: number; sin_clasificar: number }
  dudas: Duda[]
  insumos: { insumo: string; nombre: string }[]
}

export function JarvisExterior({ onMensaje }: { onMensaje: (m: { ok: boolean; t: string }) => void }) {
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = () => fetch("/api/playroom/jarvis/exterior").then(async r => { const j = await r.json(); if (!r.ok) setError(j.error); else { setD(j); setError(null) } }).catch(() => setError("No se pudo leer."))
  useEffect(() => { cargar() }, [])

  async function accion(cuerpo: Record<string, unknown>, etiqueta: string) {
    setOcupado(etiqueta)
    try {
      const r = await fetch("/api/playroom/jarvis/exterior", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) })
      const j = await r.json().catch(() => ({}))
      onMensaje({ ok: r.ok, t: r.ok ? j.detalle : j.error || "No se pudo." })
      cargar()
    } finally { setOcupado(null) }
  }

  if (error) return <p className="text-sm text-alerta-600">{error}</p>
  if (!d) return <p className="text-sm text-neutro-500">Cargando…</p>
  const c = d.cobertura
  const pct = c.activos ? Math.round((c.clasificados / c.activos) * 100) : 0

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-azul-900">Precios de afuera</p>
          <button type="button" disabled={!!ocupado} onClick={() => accion({ accion: "actualizar_precios" }, "precios")}
            className="inline-flex items-center gap-1 rounded-full border border-neutro-200 bg-white px-2.5 py-1 text-xs font-semibold text-azul-600 hover:bg-azul-50 disabled:text-neutro-400">
            <RefreshCw className={cn("h-3 w-3", ocupado === "precios" && "animate-spin")} />{ocupado === "precios" ? "Buscando… (puede tardar un minuto)" : "Actualizar ahora"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutro-500"><th className="py-1.5 pr-3 font-semibold">Indicador</th><th className="pr-3 text-right font-semibold">Valor</th><th className="pr-3 font-semibold">Fecha</th><th className="pr-3 text-right font-semibold">30 días</th><th className="font-semibold">Fuente</th></tr></thead>
            <tbody className="divide-y divide-neutro-100">
              {d.indicadores.map(i => (
                <tr key={i.clave}>
                  <td className="py-1.5 pr-3"><span className="font-semibold text-azul-900">{i.nombre}</span> <span className="text-xs text-neutro-400">{i.unidad}</span></td>
                  <td className="pr-3 text-right">{i.valor == null ? "—" : numero(i.valor, i.valor < 100 ? 2 : 0)}</td>
                  <td className="pr-3 text-neutro-500">{i.fecha ? fmtFecha(i.fecha) : "—"}</td>
                  <td className={cn("pr-3 text-right font-semibold", (i.variacion_30d ?? 0) >= 5 ? "text-alerta-600" : (i.variacion_30d ?? 0) <= -5 ? "text-exito-600" : "text-neutro-600")}>
                    {i.variacion_30d == null ? "—" : `${i.variacion_30d > 0 ? "▲" : i.variacion_30d < 0 ? "▼" : ""} ${numero(Math.abs(i.variacion_30d), 1)} %`}
                  </td>
                  <td className="text-xs text-neutro-500">{i.fuente_url ? <a href={i.fuente_url} target="_blank" rel="noreferrer" className="underline">{i.fuente ?? "ver"}</a> : i.fuente ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-neutro-400">Dólar e inflación: fuente pública, todos los días. Materias primas: Jarvis las busca en internet una vez por semana (solo las que usan tus artículos).</p>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-azul-900">De qué depende el costo de cada artículo</p>
          {c.sin_clasificar > 0 && (
            <button type="button" disabled={!!ocupado} onClick={() => accion({ accion: "clasificar" }, "clasificar")}
              className="inline-flex items-center gap-1 rounded-full border border-neutro-200 bg-white px-2.5 py-1 text-xs font-semibold text-azul-600 hover:bg-azul-50 disabled:text-neutro-400">
              <RefreshCw className={cn("h-3 w-3", ocupado === "clasificar" && "animate-spin")} />{ocupado === "clasificar" ? "Clasificando 400…" : "Clasificar los que faltan"}
            </button>
          )}
        </div>
        <div className="mb-1 h-2 w-full overflow-hidden rounded-full bg-neutro-100"><div className="h-full rounded-full bg-cian-500" style={{ width: `${pct}%` }} /></div>
        <p className="text-xs text-neutro-500">
          {numero(c.activos, 0)} artículos: <b>{numero(c.clasificados, 0)} clasificados</b> · {numero(c.dudas, 0)} con duda · {numero(c.sin_clasificar, 0)} sin clasificar · {numero(c.por_persona, 0)} revisados por una persona.
          {c.sin_clasificar > 0 && " Los nuevos se clasifican solos cada mañana (400 por día)."}
        </p>

        {d.dudas.length > 0 && (
          <>
            <p className="mb-1 mt-3 text-xs font-semibold text-neutro-600">Jarvis no está seguro de estos. Confirmá o corregí (queda a tu nombre):</p>
            <ul className="divide-y divide-neutro-100">
              {d.dudas.map(x => <FilaDuda key={x.articulo_id} duda={x} insumos={d.insumos} ocupado={!!ocupado} onGuardar={insumo => accion({ accion: "revisar", articulo_id: x.articulo_id, insumo }, "revisar")} />)}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function FilaDuda({ duda, insumos, ocupado, onGuardar }: { duda: Duda; insumos: { insumo: string; nombre: string }[]; ocupado: boolean; onGuardar: (insumo: string) => void }) {
  const [v, setV] = useState(duda.propuesta)
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <div className="min-w-[220px] flex-1">
        <p className="text-sm text-neutro-800">{duda.articulo}</p>
        <p className="text-xs text-neutro-400">{[duda.proveedor, duda.categoria].filter(Boolean).join(" · ")}{duda.motivo ? ` · Jarvis: “${duda.motivo}”` : ""}</p>
      </div>
      <select value={v} onChange={e => setV(e.target.value)} className="rounded-lg border border-neutro-200 px-2 py-1.5 text-sm">
        {insumos.map(i => <option key={i.insumo} value={i.insumo}>{i.nombre}</option>)}
      </select>
      <button type="button" disabled={ocupado} onClick={() => onGuardar(v)} className="rounded-lg bg-azul-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-neutro-200">
        {v === duda.propuesta ? "Confirmar" : "Corregir"}
      </button>
    </li>
  )
}
