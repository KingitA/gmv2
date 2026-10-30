"use client"

// Caja de ajustes (P2-03): todos los ajustes de plata en un solo lugar — redondeos de
// cobros, sobrantes ajustados, "Ajustar saldo" y deuda asumida al eliminar un cliente.
// No es una caja operativa: no tiene arqueo ni suma al disponible. Solo admin.
// + = a favor de la empresa · − = en contra.

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { fecha, hoyISO, moneda } from "@/lib/formato"

interface Renglon {
  id: string
  fecha: string
  origen: string
  origen_label: string
  monto: number
  motivo: string | null
  cliente: { id: string; codigo: string | null; nombre: string } | null
  usuario: string | null
  comprobante: { tipo: string; numero: string } | null
}
interface Respuesta {
  saldo: number
  saldo_filtrado: number
  renglones: Renglon[]
  usuarios: { id: string; nombre: string }[]
  origenes: { key: string; label: string }[]
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
/** Los últimos 12 meses como "aaaa-mm" (el actual primero) */
function ultimosMeses(): { key: string; label: string }[] {
  const [y, m] = hoyISO().split("-").map(Number)
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
  })
}

const sel = "rounded-lg border border-neutro-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-azul-500"

export function CajaAjustesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const meses = useMemo(ultimosMeses, [])
  const [mes, setMes] = useState("")
  const [origen, setOrigen] = useState("")
  const [usuario, setUsuario] = useState("")
  const [data, setData] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const p = new URLSearchParams()
    if (mes) p.set("mes", mes)
    if (origen) p.set("origen", origen)
    if (usuario) p.set("usuario_id", usuario)
    setCargando(true)
    setError(null)
    fetch(`/api/finanzas/caja-ajustes?${p}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || "No se pudo leer la caja de ajustes")
        setData(d)
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false))
  }, [open, mes, origen, usuario])

  const filtrado = Boolean(mes || origen || usuario)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Caja de ajustes</DialogTitle>
          <DialogDescription>
            Todos los ajustes de plata: redondeos de cobros, sobrantes ajustados, "Ajustar saldo" y deuda asumida al eliminar un cliente.
            No es una caja operativa: no suma al disponible. <b>+</b> a favor de la empresa · <b>−</b> en contra.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <select value={mes} onChange={(e) => setMes(e.target.value)} className={sel} aria-label="Mes">
            <option value="">Todos los meses</option>
            {meses.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} className={sel} aria-label="Tipo">
            <option value="">Todos los tipos</option>
            {(data?.origenes || []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select value={usuario} onChange={(e) => setUsuario(e.target.value)} className={sel} aria-label="Usuario">
            <option value="">Todos los usuarios</option>
            {(data?.usuarios || []).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <div className="ml-auto text-right text-sm">
            {filtrado && data && (
              <div className="text-neutro-500">Filtrado: <b className={cn("tabular-nums", data.saldo_filtrado < 0 ? "text-error-600" : "text-exito-600")}>{moneda(data.saldo_filtrado)}</b></div>
            )}
            <div className="text-neutro-500">Saldo de la caja: <b className={cn("tabular-nums", (data?.saldo ?? 0) < 0 ? "text-error-600" : "text-exito-600")}>{data ? moneda(data.saldo) : "—"}</b></div>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-lg border border-neutro-200">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-neutro-50 text-left text-xs font-semibold text-neutro-500">
              <tr>
                <th className="px-2.5 py-2">Fecha</th>
                <th className="px-2.5 py-2">Tipo</th>
                <th className="px-2.5 py-2">Cliente</th>
                <th className="px-2.5 py-2">Motivo</th>
                <th className="px-2.5 py-2">Quién</th>
                <th className="px-2.5 py-2 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {error && <tr><td colSpan={6} className="px-2.5 py-6 text-center text-error-600">{error}</td></tr>}
              {!error && cargando && <tr><td colSpan={6} className="px-2.5 py-6 text-center text-neutro-400">Cargando…</td></tr>}
              {!error && !cargando && !data?.renglones.length && <tr><td colSpan={6} className="px-2.5 py-6 text-center text-neutro-400">No hay ajustes.</td></tr>}
              {!error && !cargando && data?.renglones.map((r) => (
                <tr key={r.id} className="border-t border-neutro-100">
                  <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-neutro-600">{fecha(r.fecha)}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">{r.origen_label}</td>
                  <td className="px-2.5 py-1.5">{r.cliente ? `${r.cliente.codigo ? `${r.cliente.codigo} · ` : ""}${r.cliente.nombre}` : "—"}</td>
                  <td className="px-2.5 py-1.5 text-neutro-600">
                    {r.motivo || "—"}
                    {r.comprobante && <span className="text-neutro-400"> · {r.comprobante.tipo} {r.comprobante.numero}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-neutro-600">{r.usuario || "—"}</td>
                  <td className={cn("whitespace-nowrap px-2.5 py-1.5 text-right font-semibold tabular-nums", r.monto < 0 ? "text-error-600" : "text-exito-600")}>{moneda(r.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
