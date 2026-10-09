"use client"

// "Por rendir" en la Caja del Día (dueño 08/10: las rendiciones viven en /caja).
// Muestra lo que la pestaña Rendición/Historial de Cobros mostraba y /caja no:
//  · viajes en curso con cobros sin declarar (y viajes en rendición sin pagos),
//    con link a /viajes/{id}/rendicion;
//  · vendedores con cobros en la calle que todavía no declararon;
//  · rendiciones confirmadas recientes con su detalle (desglose, gastos y
//    fondos uno por uno, retiros de comisión, observaciones).
// Fuente: GET /api/pagos-clientes/rendiciones-resumen (la misma API de la
// pestaña — cero duplicación) + viajes activos por estado.

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

const NUM = { fontVariantNumeric: "tabular-nums" } as const
const fmt = (n: number) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fechaAR = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—")

function Desglose({ d }: { d: any }) {
  if (!d) return null
  const partes: string[] = []
  if (d.efectivo > 0) partes.push(`💵 $ ${fmt(d.efectivo)}`)
  if (d.cheques > 0) partes.push(`📄 ${d.cheques_cantidad ?? ""} cheque${(d.cheques_cantidad ?? 0) === 1 ? "" : "s"} $ ${fmt(d.cheques)}`)
  if (d.transferencias > 0) partes.push(`🏦 $ ${fmt(d.transferencias)}`)
  return <span className="text-[11px] text-slate-500">{partes.join(" · ")}</span>
}

function Movs({ titulo, items }: { titulo: string; items: any[] }) {
  if (!items?.length) return null
  return (
    <div className="mt-1.5">
      <p className="text-xs font-semibold text-neutro-500">{titulo}</p>
      {items.map((m: any, i: number) => (
        <div key={i} className="flex items-center justify-between text-[11px] text-slate-600">
          <span className="truncate">{m.concepto || m.descripcion || "—"}{m.fecha ? ` · ${fechaAR(m.fecha)}` : ""}</span>
          <span style={NUM}>$ {fmt(Math.abs(Number(m.monto)))}</span>
        </div>
      ))}
    </div>
  )
}

export function PorRendir({ recarga }: { recarga: number }) {
  const [viajesPend, setViajesPend] = useState<any[]>([])
  const [vendedoresPend, setVendedoresPend] = useState<any[]>([])
  const [confirmadas, setConfirmadas] = useState<any[]>([])
  const [viajesActivos, setViajesActivos] = useState<any[]>([])
  const [verConfirmadas, setVerConfirmadas] = useState(false)
  const [abierta, setAbierta] = useState<string | null>(null)

  useEffect(() => {
    const cargar = async () => {
      try {
        const [res, viajesRes] = await Promise.all([
          fetch("/api/pagos-clientes/rendiciones-resumen").then((r) => r.json()),
          createClient()
            .from("viajes")
            .select("id, nombre, fecha, estado, chofer")
            .in("estado", ["en_rendicion", "en_curso", "en_viaje"])
            .order("fecha", { ascending: false }),
        ])
        if (!res.error) {
          setViajesPend(res.viajes_pendientes || [])
          setVendedoresPend(res.vendedores_pendientes || [])
          setConfirmadas((res.rendiciones || []).filter((r: any) => r.estado !== "abierta").slice(0, 10))
        }
        setViajesActivos(viajesRes.data || [])
      } catch {
        /* la sección es informativa: sin datos no rompe la planilla */
      }
    }
    cargar()
  }, [recarga])

  const viajesConPagos = new Set(viajesPend.map((v) => v.viaje_id))
  const viajesSinPagos = viajesActivos.filter((v) => !viajesConPagos.has(v.id))
  const nada = !viajesPend.length && !vendedoresPend.length && !viajesSinPagos.length

  if (nada && !confirmadas.length) return null

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold text-violet-700">Por rendir</span>
        {confirmadas.length > 0 && (
          <button onClick={() => setVerConfirmadas((v) => !v)} className="text-[11px] font-semibold text-blue-600 hover:underline">
            {verConfirmadas ? "Ocultar confirmadas" : `Rendiciones confirmadas (${confirmadas.length})`}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {viajesPend.map((v) => (
          <div key={v.viaje_id} className="flex items-center gap-4 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-2.5">
            <span className="w-[280px] flex-none min-w-0">
              <span className="block truncate text-[13px] font-bold text-slate-900">🚚 {v.nombre}</span>
              <span className="block text-[11px] text-slate-500">{v.cantidad_pagos} cobro{v.cantidad_pagos === 1 ? "" : "s"} sin declarar</span>
            </span>
            <span className="flex-1 min-w-0 truncate"><Desglose d={v.desglose} /></span>
            <span className="w-[130px] flex-none text-right text-[13.5px] font-bold text-slate-700" style={NUM}>$ {fmt(v.total)}</span>
            <a
              href={`/viajes/${v.viaje_id}/rendicion`}
              target="_blank"
              rel="noreferrer"
              className="w-[220px] flex-none rounded-full bg-violet-600 px-3 py-0.5 text-center text-[11px] font-semibold text-white hover:bg-violet-700"
            >
              Abrir rendición
            </a>
          </div>
        ))}
        {viajesSinPagos.map((v) => (
          <div key={v.id} className="flex items-center gap-4 rounded-xl border border-violet-200 bg-white px-4 py-2.5">
            <span className="w-[280px] flex-none min-w-0">
              <span className="block truncate text-[13px] font-bold text-slate-900">🚚 {v.nombre}</span>
              <span className="block text-[11px] text-slate-500">{v.chofer ? `${v.chofer} · ` : ""}{fechaAR(v.fecha)} · {v.estado.replace("_", " ")}</span>
            </span>
            <span className="flex-1 min-w-0 text-[11px] text-slate-400">Sin cobros declarables todavía</span>
            <span className="w-[130px] flex-none" />
            <a
              href={`/viajes/${v.id}/rendicion`}
              target="_blank"
              rel="noreferrer"
              className="w-[220px] flex-none rounded-full border border-violet-300 px-3 py-0.5 text-center text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
            >
              Abrir rendición
            </a>
          </div>
        ))}
        {vendedoresPend.map((v) => (
          <div key={v.cobrador_id} className="flex items-center gap-4 rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-2.5">
            <span className="w-[280px] flex-none min-w-0">
              <span className="block truncate text-[13px] font-bold text-slate-900">🧳 {v.titulo}</span>
              <span className="block text-[11px] text-slate-500">{v.cantidad_pagos} cobro{v.cantidad_pagos === 1 ? "" : "s"} en la calle sin declarar</span>
            </span>
            <span className="flex-1 min-w-0 truncate"><Desglose d={v.desglose} /></span>
            <span className="w-[130px] flex-none text-right text-[13.5px] font-bold text-slate-700" style={NUM}>$ {fmt(v.total)}</span>
            <span className="w-[220px] flex-none text-right text-[11px] text-slate-400">Declara el vendedor desde su app</span>
          </div>
        ))}
      </div>

      {verConfirmadas && (
        <div className="mt-2 flex flex-col gap-1.5">
          {confirmadas.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5">
              <button className="flex w-full items-center gap-4 text-left" onClick={() => setAbierta(abierta === r.id ? null : r.id)}>
                <span className="w-[280px] flex-none min-w-0">
                  <span className="block truncate text-[13px] font-bold text-slate-900">✓ {r.titulo}</span>
                  <span className="block text-[11px] text-slate-500">
                    Confirmada {fechaAR(r.confirmado_at)} · {r.cantidad_pagos} cobro{r.cantidad_pagos === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex-1 min-w-0 truncate"><Desglose d={r.desglose} /></span>
                <span className="w-[130px] flex-none text-right text-[13.5px] font-bold text-slate-700" style={NUM}>$ {fmt(r.total)}</span>
                <span className="w-[220px] flex-none text-right text-[11px] text-blue-600">{abierta === r.id ? "Ocultar detalle" : "Ver detalle"}</span>
              </button>
              {abierta === r.id && (
                <div className="mt-2 grid grid-cols-1 gap-3 border-t border-slate-100 pt-2 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-neutro-500">Cobros</p>
                    {(r.pagos || []).map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between text-[11px] text-slate-600">
                        <span className="truncate">{p.cliente_nombre} · {p.metodos}</span>
                        <span style={NUM}>$ {fmt(p.monto)}</span>
                      </div>
                    ))}
                    <div className="mt-1 text-[11px] text-slate-500">
                      Efectivo declarado <b style={NUM}>$ {fmt(r.efectivo_declarado)}</b> · registrado <b style={NUM}>$ {fmt(r.efectivo_registrado)}</b>
                      {Number(r.diferencia) !== 0 && <span className="font-bold text-red-600"> · dif. $ {fmt(r.diferencia)}</span>}
                    </div>
                  </div>
                  <div>
                    <Movs titulo="Fondos del viaje" items={r.fondos} />
                    <Movs titulo="Gastos del viaje" items={r.gastos} />
                    <Movs titulo="Retiros de comisión del período" items={r.retiros} />
                    {r.observaciones && <p className="mt-1.5 text-[11px] text-slate-500">💬 {r.observaciones}</p>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
