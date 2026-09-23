"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Check, X } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency, formatDateTimeAR } from "@/lib/utils"
import type { HojaRuta } from "@/lib/viajes/hoja-ruta"

// Arqueo del viaje (al pie de la hoja de ruta): plata entregada, gastos
// detallados con aprobar/rechazar, y el efectivo que debería traer el chofer.
// La rendición (contar la plata e imputar los cobros) se hace en /caja.

export function ViajeArqueo({ hoja, onCambio }: { hoja: HojaRuta; onCambio: () => void }) {
  const { viaje, dinero } = hoja
  const [ocupado, setOcupado] = useState(false)
  // Reintegro: la billetera del titular quedó negativa = puso plata de su bolsillo
  const aFavor = Math.max(0, -dinero.saldo_billetera_titular)
  const [cuentas, setCuentas] = useState<{ cuenta_tipo: string; cuenta_id: string; nombre: string }[]>([])
  const [origen, setOrigen] = useState("")
  const [montoReint, setMontoReint] = useState("")
  useEffect(() => {
    if (aFavor < 0.01) return
    setMontoReint(String(aFavor))
    fetch("/api/finanzas/cajas").then((r) => r.json()).then((d) => {
      const m = (d.cuentas || []).filter((c: any) => c.cuenta_tipo === "CAJA" || c.cuenta_tipo === "BANCO")
      setCuentas(m)
      const chica = m.find((c: any) => c.nombre.toLowerCase().includes("chica")) || m[0]
      if (chica) setOrigen(`${chica.cuenta_tipo}:${chica.cuenta_id}`)
    }).catch(() => {})
  }, [aFavor])
  const reintegrar = async () => {
    const monto = Number(String(montoReint).replace(",", "."))
    if (!origen || !monto) { toast.error("Elegí la caja y el monto"); return }
    const [origen_tipo, origen_id] = origen.split(":")
    if (!confirm(`¿Reintegrar ${formatCurrency(monto)} al chofer desde ${cuentas.find((c) => `${c.cuenta_tipo}:${c.cuenta_id}` === origen)?.nombre}?`)) return
    setOcupado(true)
    try {
      const res = await fetch(`/api/viajes/${viaje.id}/reintegro`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origen_tipo, origen_id, monto }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success("Reintegro asentado: salió de la caja y la billetera del chofer quedó saldada")
      onCambio()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo reintegrar")
    } finally {
      setOcupado(false)
    }
  }

  const resolverGasto = async (gastoId: string, aprobar: boolean) => {
    let motivo: string | null = null
    if (!aprobar) {
      motivo = prompt("¿Por qué se rechaza el gasto? (el importe vuelve a figurar en la billetera del chofer)")
      if (!motivo?.trim()) return
    }
    setOcupado(true)
    try {
      const res = await fetch(`/api/viajes/${viaje.id}/gastos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gasto_id: gastoId, aprobar, motivo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(aprobar ? "Gasto aprobado" : "Gasto rechazado")
      onCambio()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo resolver el gasto")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="rounded-lg border bg-white">
        <div className="border-b px-3 py-2 text-sm font-semibold">Plata del viaje</div>
        <table className="w-full text-sm">
          <tbody>
            {dinero.fondos.map((f) => (
              <tr key={f.id} className="border-b">
                <td className="px-3 py-1.5">
                  A cuenta viaje desde <b>{f.origen}</b> — retiró <b>{f.retirado_por || "—"}</b>
                  <span className="ml-2 text-xs text-muted-foreground">{formatDateTimeAR(f.fecha)}{f.entregado_por && ` · entregó ${f.entregado_por}`}</span>
                </td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-blue-700">+{formatCurrency(f.monto)}</td>
                <td className="w-40" />
              </tr>
            ))}
            {dinero.gastos.map((g) => (
              <tr key={g.id} className={`border-b ${g.estado === "rechazado" ? "opacity-50" : ""}`}>
                <td className="px-3 py-1.5">
                  <span className="capitalize">{g.categoria}</span>
                  {g.observaciones && <span className="text-muted-foreground"> — {g.observaciones}</span>}
                  <span className="ml-2 text-xs text-muted-foreground">{g.cargado_por} · {formatDateTimeAR(g.fecha)}</span>
                  {g.foto_url && <a className="ml-2 text-xs text-blue-600 underline" href={g.foto_url} target="_blank" rel="noreferrer">ticket</a>}
                </td>
                <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${g.estado === "rechazado" ? "line-through" : "text-red-700"}`}>−{formatCurrency(g.monto)}</td>
                <td className="w-40 px-2 py-1 text-right">
                  {g.estado === "declarado" ? (
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={ocupado} onClick={() => resolverGasto(g.id, true)}><Check className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600" disabled={ocupado} onClick={() => resolverGasto(g.id, false)}><X className="h-3.5 w-3.5" /></Button>
                    </span>
                  ) : (
                    <Badge className={`px-1.5 py-0 text-[10px] ${g.estado === "aprobado" ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
                      {g.estado === "aprobado" ? "Aprobado" : "Rechazado"}
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
            {dinero.fondos.length === 0 && dinero.gastos.length === 0 && (
              <tr><td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={3}>Todavía no hay plata entregada ni gastos.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border bg-white p-3 text-sm">
        <p className="mb-2 font-semibold">Arqueo</p>
        <Linea etiqueta="Plata a cuenta del viaje" valor={dinero.fondo_entregado} />
        <Linea etiqueta="+ Cobrado en efectivo" valor={dinero.cobrado_efectivo} />
        <Linea etiqueta="− Gastos" valor={-dinero.gastos_total} />
        <div className="mt-1 border-t pt-1"><Linea etiqueta="= Efectivo que debería traer" valor={dinero.efectivo_en_mano} fuerte /></div>
        <div className="mt-2 text-muted-foreground">
          <div className="flex justify-between py-0.5"><span>Cheques</span><span>{dinero.cheques_cantidad} {dinero.cheques_cantidad === 1 ? "cheque" : "cheques"}</span></div>
          <Linea etiqueta="Transferencias / depósitos" valor={dinero.cobrado_transferencias} />
        </div>
        {dinero.efectivo_en_mano < -0.01 && (
          <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
            El chofer gastó más que el fondo + lo cobrado: puso {formatCurrency(-dinero.efectivo_en_mano)} de su bolsillo.
          </p>
        )}
        {aFavor >= 0.01 && (
          <div className="mt-2 space-y-2 rounded border border-green-200 bg-green-50 p-2">
            <p className="text-xs font-semibold text-green-800">Billetera del chofer a favor: {formatCurrency(aFavor)}</p>
            <div className="flex gap-2">
              <Select value={origen} onValueChange={setOrigen}>
                <SelectTrigger className="h-8 bg-white text-xs"><SelectValue placeholder="Sale de…" /></SelectTrigger>
                <SelectContent>
                  {cuentas.map((c) => <SelectItem key={c.cuenta_id} value={`${c.cuenta_tipo}:${c.cuenta_id}`}>{c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="h-8 w-28 bg-white text-xs" type="number" value={montoReint} onChange={(e) => setMontoReint(e.target.value)} />
            </div>
            <Button size="sm" className="h-8 w-full" disabled={ocupado} onClick={reintegrar}>Reintegrar al chofer</Button>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Al rendir, el chofer declara cuánto efectivo entrega; se coteja en Caja.</p>
      </div>
    </div>
  )
}

function Linea({ etiqueta, valor, fuerte }: { etiqueta: string; valor: number; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${fuerte ? "text-base font-semibold" : ""}`}>
      <span>{etiqueta}</span>
      <span className="tabular-nums">{formatCurrency(valor)}</span>
    </div>
  )
}
