"use client"

import { useEffect, useMemo, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChevronLeft, ChevronRight, Plus, Truck, User, Package } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency, formatDateAR, todayArgentina } from "@/lib/utils"
import { ESTADO_VIAJE_LABEL, ESTADO_VIAJE_COLOR } from "@/lib/viajes/estados"

// Calendario de viajes de reparto. Los viajes se PROGRAMAN con anticipación
// (fin del mes anterior): solo fecha + zonas. Chofer, vehículo y pedidos se
// completan desde el detalle, más cerca de la fecha.

type ViajeCal = {
  id: string
  nombre: string
  fecha: string
  estado: string
  tipo_transporte: string | null
  zonas: { id: string; nombre: string }[]
  choferes: { usuario_id: string; rol: string; nombre: string }[]
  vehiculos?: { nombre: string; patente: string | null } | null
  transportes?: { nombre: string } | null
  pedidos_count: number
  clientes_count: number
  bultos: number
  total: number
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`

function ViajesCalendario() {
  const router = useRouter()
  const search = useSearchParams()
  const hoy = todayArgentina()

  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)))
  const [mes, setMes] = useState(Number(hoy.slice(5, 7)) - 1)
  const [viajes, setViajes] = useState<ViajeCal[]>([])
  const [cargando, setCargando] = useState(true)

  const [dialogo, setDialogo] = useState(false)
  const [zonas, setZonas] = useState<{ id: string; nombre: string }[]>([])
  const [fecha, setFecha] = useState("")
  const [zonaIds, setZonaIds] = useState<string[]>([])
  const [porTransporte, setPorTransporte] = useState(false)
  const [nombre, setNombre] = useState("")
  const [guardando, setGuardando] = useState(false)

  const cargar = async (a = anio, m = mes) => {
    setCargando(true)
    try {
      const ultimo = new Date(a, m + 1, 0).getDate()
      const res = await fetch(`/api/viajes?desde=${iso(a, m, 1)}&hasta=${iso(a, m, ultimo)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setViajes(data.viajes || [])
    } catch (e: any) {
      toast.error(e?.message || "No se pudieron cargar los viajes")
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar(anio, mes) }, [anio, mes])

  useEffect(() => {
    createClient().from("zonas").select("id, nombre").order("nombre").then((r: { data: { id: string; nombre: string }[] | null }) => setZonas(r.data || []))
  }, [])

  useEffect(() => {
    if (search.get("programar") === "1") abrirDialogo("")
  }, [search])

  const moverMes = (delta: number) => {
    const d = new Date(anio, mes + delta, 1)
    setAnio(d.getFullYear())
    setMes(d.getMonth())
  }

  const abrirDialogo = (f: string) => {
    setFecha(f)
    setZonaIds([])
    setPorTransporte(false)
    setNombre("")
    setDialogo(true)
  }

  const programar = async () => {
    if (!fecha || !zonaIds.length) {
      toast.error("Elegí la fecha y al menos una zona")
      return
    }
    setGuardando(true)
    try {
      const res = await fetch("/api/viajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha,
          zona_ids: zonaIds,
          nombre,
          tipo_transporte: porTransporte ? "transporte" : "chofer_propio",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success("Viaje programado")
      setDialogo(false)
      // Si el viaje cae en otro mes, saltar a ese mes
      const a = Number(fecha.slice(0, 4))
      const m = Number(fecha.slice(5, 7)) - 1
      if (a === anio && m === mes) cargar(a, m)
      else { setAnio(a); setMes(m) }
    } catch (e: any) {
      toast.error(e?.message || "No se pudo programar el viaje")
    } finally {
      setGuardando(false)
    }
  }

  // Grilla lunes→domingo
  const celdas = useMemo(() => {
    const primero = new Date(anio, mes, 1)
    const offset = (primero.getDay() + 6) % 7
    const dias = new Date(anio, mes + 1, 0).getDate()
    const out: (string | null)[] = Array(offset).fill(null)
    for (let d = 1; d <= dias; d++) out.push(iso(anio, mes, d))
    while (out.length % 7) out.push(null)
    return out
  }, [anio, mes])

  const porDia = useMemo(() => {
    const m = new Map<string, ViajeCal[]>()
    for (const v of viajes) {
      const k = String(v.fecha).slice(0, 10)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(v)
    }
    return m
  }, [viajes])

  // Arrastrar el viaje a otro día = cambiar la fecha (queda quién lo movió)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const moverViaje = async (viajeId: string, nuevaFecha: string) => {
    const v = viajes.find((x) => x.id === viajeId)
    setSobre(null)
    setArrastrando(null)
    if (!v || String(v.fecha).slice(0, 10) === nuevaFecha) return
    if (!["programado", "despachado"].includes(v.estado)) { toast.error("Ese viaje ya salió: no se cambia la fecha"); return }
    setViajes((prev) => prev.map((x) => (x.id === viajeId ? { ...x, fecha: nuevaFecha } : x)))
    try {
      const res = await fetch(`/api/viajes/${viajeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fecha: nuevaFecha }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`${v.nombre} pasa al ${nuevaFecha.slice(8)}/${nuevaFecha.slice(5, 7)}`)
    } catch (e: any) {
      toast.error(e?.message || "No se pudo mover el viaje")
    }
    cargar(anio, mes)
  }

  const quienLleva = (v: ViajeCal) =>
    v.tipo_transporte === "transporte"
      ? v.transportes?.nombre || "Transporte sin definir"
      : v.choferes.find((c) => c.rol === "titular")?.nombre || "Sin chofer"

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Viajes</h1>
          <p className="text-muted-foreground">Calendario de reparto y hojas de ruta</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => moverMes(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="w-44 text-center text-lg font-semibold">{MESES[mes]} {anio}</div>
          <Button variant="outline" size="icon" onClick={() => moverMes(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button className="ml-4" onClick={() => abrirDialogo("")}>
            <Plus className="h-4 w-4 mr-2" /> Programar viaje
          </Button>
        </div>
      </div>

      {/* Calendario */}
      <div className="rounded-lg border overflow-hidden bg-white">
        <div className="grid grid-cols-7 bg-slate-50 border-b text-xs font-semibold text-slate-500">
          {DIAS.map((d) => <div key={d} className="px-2 py-2 text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {celdas.map((dia, i) => (
            <div
              key={i}
              className={`group min-h-28 border-b border-r p-1.5 ${dia ? "" : "bg-slate-50/60"} ${dia === hoy ? "bg-blue-50/60" : ""} ${sobre === dia && arrastrando ? "bg-amber-100 ring-2 ring-inset ring-amber-400" : ""}`}
              onDragOver={(e) => { if (dia && arrastrando) { e.preventDefault(); if (sobre !== dia) setSobre(dia) } }}
              onDragLeave={() => { if (sobre === dia) setSobre(null) }}
              onDrop={(e) => { e.preventDefault(); if (dia && arrastrando) moverViaje(arrastrando, dia) }}
            >
              {dia && (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold ${dia === hoy ? "text-blue-700" : "text-slate-500"}`}>
                      {Number(dia.slice(8))}
                    </span>
                    <button
                      onClick={() => abrirDialogo(dia)}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 transition-opacity"
                      title="Programar viaje este día"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {(porDia.get(dia) || []).map((v) => (
                      <button
                        key={v.id}
                        onClick={() => router.push(`/viajes/${v.id}`)}
                        draggable={["programado", "despachado"].includes(v.estado)}
                        onDragStart={(e) => { setArrastrando(v.id); e.dataTransfer.effectAllowed = "move" }}
                        onDragEnd={() => { setArrastrando(null); setSobre(null) }}
                        title={["programado", "despachado"].includes(v.estado) ? "Arrastrá a otro día para cambiar la fecha" : undefined}
                        className={`w-full text-left rounded-md border bg-white hover:bg-slate-50 px-1.5 py-1 shadow-sm ${["programado", "despachado"].includes(v.estado) ? "cursor-grab active:cursor-grabbing" : ""} ${arrastrando === v.id ? "opacity-40" : ""}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${ESTADO_VIAJE_COLOR[v.estado] || "bg-slate-400"}`} />
                          <span className="truncate text-xs font-semibold">
                            {v.zonas.map((z) => z.nombre).join(" + ") || v.nombre}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {v.tipo_transporte === "transporte" ? "🚛 " : ""}{quienLleva(v)}
                          {v.pedidos_count > 0 && ` · ${v.pedidos_count} ped · ${v.bultos} bu`}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Lista del mes */}
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Viaje</TableHead>
              <TableHead>Lleva</TableHead>
              <TableHead>Vehículo</TableHead>
              <TableHead className="text-right">Clientes</TableHead>
              <TableHead className="text-right">Pedidos</TableHead>
              <TableHead className="text-right">Bultos</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando ? (
              <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Cargando…</TableCell></TableRow>
            ) : viajes.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No hay viajes programados en {MESES[mes]}</TableCell></TableRow>
            ) : (
              viajes.map((v) => (
                <TableRow key={v.id} className="cursor-pointer" onClick={() => router.push(`/viajes/${v.id}`)}>
                  <TableCell className="whitespace-nowrap">{formatDateAR(v.fecha)}</TableCell>
                  <TableCell className="font-medium">{v.nombre}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      {v.tipo_transporte === "transporte" ? <Truck className="h-3.5 w-3.5 text-slate-400" /> : <User className="h-3.5 w-3.5 text-slate-400" />}
                      {quienLleva(v)}
                      {v.choferes.filter((c) => c.rol !== "titular").length > 0 && (
                        <span className="text-xs text-slate-400">+{v.choferes.filter((c) => c.rol !== "titular").length}</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>{v.vehiculos?.nombre || "—"}</TableCell>
                  <TableCell className="text-right">{v.clientes_count}</TableCell>
                  <TableCell className="text-right">{v.pedidos_count}</TableCell>
                  <TableCell className="text-right"><span className="inline-flex items-center gap-1"><Package className="h-3 w-3 text-slate-400" />{v.bultos}</span></TableCell>
                  <TableCell className="text-right">{formatCurrency(v.total)}</TableCell>
                  <TableCell>
                    <Badge className={`${ESTADO_VIAJE_COLOR[v.estado] || "bg-slate-400"} text-white`}>
                      {ESTADO_VIAJE_LABEL[v.estado] || v.estado}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Programar viaje */}
      <Dialog open={dialogo} onOpenChange={setDialogo}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Programar viaje</DialogTitle>
            <DialogDescription>
              Solo fecha y zonas. Chofer, vehículo y pedidos se completan después desde el viaje.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Fecha *</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div>
              <Label>Zonas *</Label>
              <div className="mt-1 grid max-h-56 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border p-3">
                {zonas.map((z) => (
                  <label key={z.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={zonaIds.includes(z.id)}
                      onCheckedChange={(c) => setZonaIds((prev) => (c ? [...prev, z.id] : prev.filter((x) => x !== z.id)))}
                    />
                    {z.nombre}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={porTransporte} onCheckedChange={(c) => setPorTransporte(Boolean(c))} />
              Sale por transporte tercerizado (sin chofer propio ni rendición)
            </label>
            <div>
              <Label>Nombre (opcional)</Label>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Si lo dejás vacío: ZONAS · día/mes" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogo(false)}>Cancelar</Button>
              <Button onClick={programar} disabled={guardando}>{guardando ? "Guardando…" : "Programar"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function ViajesPage() {
  return (
    <Suspense fallback={null}>
      <ViajesCalendario />
    </Suspense>
  )
}
