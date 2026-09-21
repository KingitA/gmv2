"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Check, X } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency, formatDateTimeAR } from "@/lib/utils"
import type { HojaRuta } from "@/lib/viajes/hoja-ruta"

// Plata del viaje.
//  - "A cuenta viaje": oficina decide el monto a mano; sale de CUALQUIER caja o
//    banco a la billetera del chofer titular y queda asentado de dónde salió y
//    quién la retiró (en /caja figura "A cuenta viaje <NOMBRE> — retiró <QUIEN>").
//  - Gastos que declara el chofer/acompañante: oficina aprueba o rechaza.
//  - Arqueo: fondo + cobrado en efectivo − gastos = efectivo en mano.
// La rendición (contar la plata e imputar los cobros) se hace en /caja.

type Cuenta = { cuenta_tipo: string; cuenta_id: string; nombre: string; grupo: string; saldos?: { BLANCO: number } }

export function ViajePlata({ hoja, onCambio }: { hoja: HojaRuta; onCambio: () => void }) {
  const { viaje, totales, dinero } = hoja
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [origen, setOrigen] = useState("")
  const [monto, setMonto] = useState("")
  const [retira, setRetira] = useState(viaje.titular_id || "")
  const [ocupado, setOcupado] = useState(false)

  const puedeEntregar = !!viaje.titular_id && ["programado", "despachado", "en_curso"].includes(viaje.estado)

  useEffect(() => {
    fetch("/api/finanzas/cajas")
      .then((r) => r.json())
      .then((d) => {
        const movibles: Cuenta[] = (d.cuentas || []).filter((c: Cuenta) => c.cuenta_tipo === "CAJA" || c.cuenta_tipo === "BANCO")
        setCuentas(movibles)
        const chica = movibles.find((c) => c.nombre.toLowerCase().includes("chica")) || movibles.find((c) => c.cuenta_tipo === "CAJA")
        if (chica) setOrigen(`${chica.cuenta_tipo}:${chica.cuenta_id}`)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { setRetira(viaje.titular_id || "") }, [viaje.titular_id])

  const entregar = async () => {
    const montoNum = Number(String(monto).replace(",", "."))
    if (!origen || !montoNum || montoNum <= 0) {
      toast.error("Elegí de dónde sale la plata y un monto mayor a 0")
      return
    }
    const [origen_tipo, origen_id] = origen.split(":")
    const quien = viaje.choferes.find((c) => c.usuario_id === retira)?.nombre || "el chofer"
    if (!confirm(`¿Entregar ${formatCurrency(montoNum)} a cuenta del viaje ${viaje.nombre}?\nRetira: ${quien}`)) return
    setOcupado(true)
    try {
      const res = await fetch(`/api/viajes/${viaje.id}/fondo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origen_tipo, origen_id, monto: montoNum, retirado_por: retira || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success("Plata entregada: quedó asentada en la caja y en la billetera del chofer")
      setMonto("")
      onCambio()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo entregar la plata")
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

  const grupos = [
    { titulo: "Cajas", items: cuentas.filter((c) => c.cuenta_tipo === "CAJA") },
    { titulo: "Bancos", items: cuentas.filter((c) => c.cuenta_tipo === "BANCO") },
  ]

  return (
    <div className="space-y-6">
      {/* Referencias para decidir el monto */}
      <div className="grid grid-cols-3 gap-3">
        <Dato etiqueta="Total del viaje" valor={formatCurrency(totales.total_viaje)} />
        <Dato etiqueta="Referencia 3%" valor={formatCurrency(Math.round(totales.total_viaje * 0.03))} />
        <Dato etiqueta="Billetera del titular hoy" valor={formatCurrency(dinero.saldo_billetera_titular)} />
      </div>

      {/* A cuenta viaje */}
      <div className="rounded-lg border bg-white p-4">
        <h3 className="font-semibold">Plata a cuenta del viaje</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          El monto lo decidís vos. Sale de la caja o banco que elijas y en /caja queda como “A cuenta viaje {viaje.nombre}”.
        </p>

        {dinero.fondos.length > 0 && (
          <div className="mb-4 divide-y rounded-md border">
            {dinero.fondos.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-semibold">{formatCurrency(f.monto)}</span> desde <span className="font-medium">{f.origen}</span>
                  {" — "}retiró <span className="font-medium">{f.retirado_por || "—"}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTimeAR(f.fecha)}{f.entregado_por && ` · entregó ${f.entregado_por}`}
                </span>
              </div>
            ))}
            <div className="flex justify-between bg-slate-50 px-3 py-2 text-sm font-semibold">
              <span>Total entregado</span>
              <span>{formatCurrency(dinero.fondo_entregado)}</span>
            </div>
          </div>
        )}

        {puedeEntregar ? (
          <div className="grid items-end gap-3 md:grid-cols-4">
            <div>
              <Label>Sale de</Label>
              <Select value={origen} onValueChange={setOrigen}>
                <SelectTrigger><SelectValue placeholder="Elegí la caja o banco" /></SelectTrigger>
                <SelectContent>
                  {grupos.filter((g) => g.items.length).map((g) => (
                    <SelectGroup key={g.titulo}>
                      <SelectLabel>{g.titulo}</SelectLabel>
                      {g.items.map((c) => (
                        <SelectItem key={c.cuenta_id} value={`${c.cuenta_tipo}:${c.cuenta_id}`}>
                          {c.nombre} · {formatCurrency(c.saldos?.BLANCO ?? 0)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monto</Label>
              <Input type="number" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej: 300000" />
            </div>
            <div>
              <Label>Quién retira</Label>
              <Select value={retira} onValueChange={setRetira}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {viaje.choferes.map((c) => (
                    <SelectItem key={c.usuario_id} value={c.usuario_id}>
                      {c.nombre}{c.rol === "titular" ? " (titular)" : " (acompañante)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={entregar} disabled={ocupado}>Entregar plata</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {!viaje.titular_id ? "Asigná el chofer titular (pestaña Datos) para poder entregarle plata." : "El viaje ya está en rendición: no se entrega más plata."}
          </p>
        )}
      </div>

      {/* Gastos */}
      <div className="rounded-lg border bg-white p-4">
        <h3 className="mb-3 font-semibold">Gastos del viaje</h3>
        {dinero.gastos.length === 0 ? (
          <p className="text-sm text-muted-foreground">El chofer todavía no cargó gastos.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {dinero.gastos.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-semibold capitalize">{g.categoria}</span> · {formatCurrency(g.monto)}
                  {g.observaciones && <span className="text-muted-foreground"> — {g.observaciones}</span>}
                  <span className="ml-2 text-xs text-muted-foreground">{g.cargado_por} · {formatDateTimeAR(g.fecha)}</span>
                  {g.foto_url && <a className="ml-2 text-xs text-blue-600 underline" href={g.foto_url} target="_blank" rel="noreferrer">ver ticket</a>}
                </span>
                {g.estado === "declarado" ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={ocupado} onClick={() => resolverGasto(g.id, true)}><Check className="mr-1 h-3.5 w-3.5" />Aprobar</Button>
                    <Button size="sm" variant="ghost" className="text-red-600" disabled={ocupado} onClick={() => resolverGasto(g.id, false)}><X className="mr-1 h-3.5 w-3.5" />Rechazar</Button>
                  </span>
                ) : (
                  <Badge className={g.estado === "aprobado" ? "bg-green-600 text-white" : "bg-red-600 text-white"}>
                    {g.estado === "aprobado" ? "Aprobado" : "Rechazado"}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Arqueo */}
      <div className="rounded-lg border bg-white p-4">
        <h3 className="mb-3 font-semibold">Arqueo del viaje</h3>
        <div className="max-w-md space-y-1 text-sm">
          <Linea etiqueta="Plata a cuenta del viaje" valor={dinero.fondo_entregado} />
          <Linea etiqueta="+ Cobrado en efectivo" valor={dinero.cobrado_efectivo} />
          <Linea etiqueta="− Gastos (declarados y aprobados)" valor={-dinero.gastos_total} />
          <div className="border-t pt-1"><Linea etiqueta="= Efectivo que debería traer" valor={dinero.efectivo_en_mano} fuerte /></div>
          <div className="pt-2 text-muted-foreground">
            <Linea etiqueta="Cheques cobrados" valor={dinero.cobrado_cheques} />
            <Linea etiqueta="Transferencias / depósitos" valor={dinero.cobrado_transferencias} />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Al finalizar, el chofer declara cuánto efectivo manda y la rendición aparece en /caja. Si manda todo, el sobrante
          del fondo vuelve a la caja; si manda solo lo cobrado, el sobrante le queda en la billetera para el próximo viaje.
        </p>
      </div>
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="text-lg font-semibold">{valor}</p>
    </div>
  )
}

function Linea({ etiqueta, valor, fuerte }: { etiqueta: string; valor: number; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? "text-base font-semibold" : ""}`}>
      <span>{etiqueta}</span>
      <span>{formatCurrency(valor)}</span>
    </div>
  )
}
