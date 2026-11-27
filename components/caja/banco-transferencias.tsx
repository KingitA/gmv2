"use client"

// Créditos del banco en /caja (Tanda 3 del plan de bancos, 27/11/2026):
//  · transferencias confirmadas por el banco (solas o vinculadas a mano), últimos 7 días;
//  · créditos sin identificar: quién transfirió, monto, banco, fecha y "Vincular" (cliente sugerido por
//    pagadores / CUIT, búsqueda, o una transferencia ya informada). Hasta vincular, no toca ninguna cuenta;
//  · en modo propuesta: "se confirmaría con…" + Confirmar a mano;
//  · transferencias informadas que no aparecieron en el banco a los 2 días hábiles.
// Fuente: /api/bancos/transferencias (lib/bancos/transferencias/servidor.ts).

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { fecha, moneda } from "@/lib/formato"
import type { PanelTransferencias } from "@/lib/bancos/transferencias/servidor"

const NUM = { fontVariantNumeric: "tabular-nums" } as const
type Credito = PanelTransferencias["sin_identificar"][number]

export function BancoTransferencias({ recarga, onCambio }: { recarga: number; onCambio: () => void }) {
  const [panel, setPanel] = useState<PanelTransferencias | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [verConfirmadas, setVerConfirmadas] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const revisado = useRef(false)
  const { toast } = useToast()

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/bancos/transferencias")
      const d = await r.json()
      if (r.ok) setPanel(d)
    } catch { /* el resto de la caja sigue andando */ }
  }, [])

  // Al abrir la caja: cruza lo que haya (en modo propuesta no confirma nada)
  useEffect(() => {
    if (revisado.current) return
    revisado.current = true
    fetch("/api/bancos/transferencias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "revisar" }) })
      .then((r) => r.json())
      .then((d) => { if (d?.confirmadas > 0) onCambio() })
      .catch(() => {})
      .finally(cargar)
  }, [cargar, onCambio])

  useEffect(() => { if (revisado.current) cargar() }, [recarga, cargar])

  const post = async (clave: string, body: Record<string, unknown>, ok: string) => {
    setOcupado(clave)
    try {
      const r = await fetch("/api/bancos/transferencias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "No se pudo")
      toast({ title: ok, description: d.numero_recibo ? `Recibo ${d.numero_recibo}` : d.bonificacion_error ?? undefined })
      setAbierto(null)
      await cargar()
      onCambio()
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se vinculó", description: e.message })
    } finally {
      setOcupado(null)
    }
  }

  const cambiarModo = async () => {
    if (!panel) return
    const propuesta = !panel.modo_propuesta
    if (!propuesta && !window.confirm("Desde ahora las transferencias con UNA coincidencia exacta se confirman solas, a tu nombre. ¿Seguir?")) return
    await post("modo", { accion: "modo", propuesta }, propuesta ? "Modo propuesta encendido" : "Confirmación automática encendida")
  }

  if (!panel?.disponible) return null
  const { sin_identificar, confirmadas, no_aparecieron } = panel

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-azul-900">🏦 Banco · transferencias</span>
        <button
          onClick={cambiarModo}
          disabled={ocupado === "modo"}
          title="Modo propuesta: el sistema solo dice con qué cobro confirmaría. Apagado: confirma solo cuando hay una única coincidencia exacta."
          className={`rounded-full px-3 py-0.5 text-[11px] font-semibold ${panel.modo_propuesta ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"}`}
        >
          {panel.modo_propuesta ? "Modo propuesta · no confirma solo" : "Confirma solo"}
        </button>
      </div>

      {no_aparecieron.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-bold text-red-700">No apareció en el banco ({no_aparecieron.length})</div>
          {no_aparecieron.map((n) => (
            <div key={n.pago_id + n.fecha} className="flex items-center gap-3 rounded-lg bg-red-50 px-3 py-1 text-[12px]">
              <span className="w-[72px] flex-none text-slate-500" style={NUM}>{fecha(n.fecha)}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{n.cliente}</span>
              <span className="flex-none text-slate-500">{n.banco}</span>
              <span className="w-[110px] flex-none text-right font-bold" style={NUM}>{moneda(n.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {sin_identificar.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-bold text-amber-700">Créditos sin identificar ({sin_identificar.length}) · no se acreditan hasta vincularlos</div>
          <div className="flex flex-col gap-1">
            {sin_identificar.map((c) => (
              <div key={c.movimiento_id} className="rounded-lg border border-amber-200 bg-amber-50/60">
                <div className="flex items-center gap-3 px-3 py-1.5 text-[12px]">
                  <span className="w-[72px] flex-none text-slate-500" style={NUM}>{fecha(c.fecha)}{c.hora ? ` ${c.hora.slice(0, 5)}` : ""}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-slate-800">{c.nombre || c.concepto || "Sin nombre"}</span>
                    {c.cuit && <span className="text-slate-500"> · {c.cuit}</span>}
                    <span className="text-slate-400"> · {c.banco}</span>
                    {c.propuesta && <span className="text-green-700"> · se confirmaría con {c.propuesta.cliente} ({c.propuesta.por})</span>}
                    {!c.propuesta && c.motivo && <span className="text-slate-500"> · {c.motivo}</span>}
                  </span>
                  <span className="w-[110px] flex-none text-right font-bold text-green-700" style={NUM}>+ {moneda(c.monto)}</span>
                  {c.propuesta && (
                    <button
                      onClick={() => post(c.movimiento_id, { accion: "vincular", movimiento_id: c.movimiento_id, pago_id: c.propuesta!.pago_id, detalle_id: c.propuesta!.detalle_id }, `Confirmada: ${c.propuesta!.cliente}`)}
                      disabled={!!ocupado}
                      className="flex-none rounded-full bg-green-600 px-3 py-0.5 text-[11px] font-bold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      Confirmar
                    </button>
                  )}
                  <button
                    onClick={() => setAbierto(abierto === c.movimiento_id ? null : c.movimiento_id)}
                    className="flex-none rounded-full bg-blue-600 px-3 py-0.5 text-[11px] font-bold text-white hover:bg-blue-700"
                  >
                    Vincular
                  </button>
                </div>
                {abierto === c.movimiento_id && <Vincular c={c} ocupado={ocupado === c.movimiento_id} onElegir={(body, ok) => post(c.movimiento_id, { accion: "vincular", movimiento_id: c.movimiento_id, ...body }, ok)} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmadas.length > 0 && (
        <div>
          <button onClick={() => setVerConfirmadas((v) => !v)} className="text-[11px] font-bold text-green-700 hover:underline">
            ✓ Confirmadas por el banco, últimos 7 días ({confirmadas.length}) {verConfirmadas ? "▲" : "▼"}
          </button>
          {verConfirmadas && confirmadas.map((c) => (
            <div key={c.movimiento_id} className="mt-1 flex items-center gap-3 rounded-lg bg-green-50 px-3 py-1 text-[12px]">
              <span className="w-[72px] flex-none text-slate-500" style={NUM}>{fecha(c.fecha)}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{c.cliente}</span>
              <span className="flex-none text-slate-500">{c.banco} · {c.origen === "auto" ? "sola" : "a mano"}</span>
              <span className="w-[110px] flex-none text-right font-bold" style={NUM}>{moneda(c.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {!sin_identificar.length && !no_aparecieron.length && !confirmadas.length && (
        <div className="text-[11px] text-slate-400">Sin créditos del banco por revisar.</div>
      )}
    </div>
  )
}

function Vincular({ c, ocupado, onElegir }: { c: Credito; ocupado: boolean; onElegir: (body: Record<string, unknown>, ok: string) => void }) {
  const [q, setQ] = useState("")
  const [resultados, setResultados] = useState<{ id: string; nombre: string; localidad: string | null; cuit: string | null }[]>([])

  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setResultados([]); return }
    const h = setTimeout(() => {
      fetch(`/api/clientes/buscar?q=${encodeURIComponent(t)}&limit=8`).then((r) => r.json()).then((d) => setResultados(Array.isArray(d) ? d : [])).catch(() => {})
    }, 250)
    return () => clearTimeout(h)
  }, [q])

  const elegirCliente = (id: string, nombre: string) => {
    if (!window.confirm(`Se crea el cobro de ${nombre} por ${moneda(c.monto)} con esta transferencia y se confirma. ¿Seguir?`)) return
    onElegir({ cliente_id: id }, `Cobro de ${nombre} confirmado`)
  }

  return (
    <div className="border-t border-amber-200 px-3 py-2 text-[12px]">
      {ocupado && <Loader2 className="mb-1 h-4 w-4 animate-spin text-slate-400" />}
      {c.informadas.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-500">Transferencias informadas con ese monto</div>
          <div className="flex flex-wrap gap-1.5">
            {c.informadas.map((i) => (
              <button
                key={i.detalle_id}
                disabled={ocupado}
                onClick={() => window.confirm(`¿Es la transferencia de ${i.cliente} del ${fecha(i.fecha)}? Se confirma ese cobro.`) && onElegir({ pago_id: i.pago_id, detalle_id: i.detalle_id }, `Confirmada: ${i.cliente}`)}
                className="rounded-full border border-green-300 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-green-800 hover:bg-green-50"
              >
                {i.cliente} · {fecha(i.fecha)} · {i.banco}
              </button>
            ))}
          </div>
        </div>
      )}
      {c.sugerencias.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-500">Clientes de este pagador</div>
          <div className="flex flex-wrap gap-1.5">
            {c.sugerencias.map((s) => (
              <button
                key={s.cliente_id}
                disabled={ocupado}
                onClick={() => elegirCliente(s.cliente_id, s.nombre)}
                className="rounded-full border border-blue-300 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-blue-800 hover:bg-blue-50"
              >
                {s.nombre}{s.localidad ? ` (${s.localidad})` : ""} · {s.por}
              </button>
            ))}
          </div>
        </div>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar cliente…"
        className="w-64 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[12px] outline-none focus:border-blue-500"
      />
      {resultados.length > 0 && (
        <div className="mt-1 flex flex-col">
          {resultados.map((r) => (
            <button
              key={r.id}
              disabled={ocupado}
              onClick={() => elegirCliente(r.id, r.nombre)}
              className="rounded px-2 py-0.5 text-left text-[12px] hover:bg-slate-100"
            >
              <span className="font-semibold">{r.nombre}</span>
              <span className="text-slate-500">{r.localidad ? ` · ${r.localidad}` : ""}{r.cuit ? ` · ${r.cuit}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
