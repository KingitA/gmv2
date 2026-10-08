"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChevronLeft, ChevronRight, Plus, Truck, User, Package } from "lucide-react"
import { formatCurrency, formatDateAR, todayArgentina } from "@/lib/utils"
import { ESTADO_VIAJE_LABEL, ESTADO_VIAJE_COLOR } from "@/lib/viajes/estados"
import { useUrlParams } from "@/lib/hooks/use-url-state"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { quienLleva, sumarDias, useViajesRango } from "@/lib/viajes/use-viajes-rango"
import { CalendarioViajes, celdasMes } from "@/components/viajes/calendario-viajes"
import { ProgramarViajeDialog } from "@/components/viajes/programar-viaje-dialog"

// Calendario de viajes de reparto. Los viajes se PROGRAMAN con anticipación
// (fin del mes anterior): solo fecha + zonas. Chofer, vehículo y pedidos se
// completan desde el detalle, más cerca de la fecha.
// El calendario y "Programar viaje" son piezas compartidas con CLIENTES
// (components/viajes/calendario-viajes.tsx y programar-viaje-dialog.tsx).

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`

function ViajesCalendario() {
  const router = useRouter()
  const search = useSearchParams()
  const hoy = todayArgentina()

  // El mes que se mira queda en la URL (?mes=2026-10): atrás/adelante y links lo respetan
  const url = useUrlParams()
  const mesParam = /^\d{4}-\d{2}$/.test(url.get("mes")) ? url.get("mes") : hoy.slice(0, 7)
  const anio = Number(mesParam.slice(0, 4))
  const mes = Number(mesParam.slice(5, 7)) - 1
  const setAnioMes = (a: number, m: number) =>
    url.set({ mes: `${a}-${String(m + 1).padStart(2, "0")}` }, "push", { mes: hoy.slice(0, 7) })

  const { viajes, cargando, moverViaje, recargar } = useViajesRango(iso(anio, mes, 1), iso(anio, mes, new Date(anio, mes + 1, 0).getDate()))
  const celdas = useMemo(() => celdasMes(anio, mes), [anio, mes])

  const [dialogo, setDialogo] = useState(false)
  const [fechaDialogo, setFechaDialogo] = useState("")
  const abrirDialogo = (f: string) => { setFechaDialogo(f); setDialogo(true) }

  useEffect(() => {
    if (search.get("programar") === "1") abrirDialogo("")
  }, [search])

  const moverMes = (delta: number) => {
    const d = new Date(anio, mes + delta, 1)
    setAnioMes(d.getFullYear(), d.getMonth())
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azul-900 sm:text-3xl">Viajes</h1>
          <p className="text-muted-foreground">Calendario de reparto y hojas de ruta</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => moverMes(-1)} aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="w-40 text-center text-lg font-semibold">{MESES[mes]} {anio}</div>
          <Button variant="outline" size="icon" onClick={() => moverMes(1)} aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></Button>
          <Button className="ml-2" onClick={() => abrirDialogo("")}>
            <Plus className="h-4 w-4" /> Programar viaje
          </Button>
        </div>
      </div>

      <CalendarioViajes
        modo="mes"
        celdas={celdas}
        viajes={viajes}
        hoy={hoy}
        onAbrirViaje={(id) => router.push(`/viajes/${id}`)}
        onProgramar={abrirDialogo}
        onMoverViaje={moverViaje}
      />

      {/* Lista del mes */}
      <div className="rounded-xl border bg-white">
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
              <TableRow><TableCell colSpan={9}><CargaProgreso compacto mensajes={MENSAJES.viajes} className="mx-auto max-w-sm py-6" /></TableCell></TableRow>
            ) : viajes.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground normal-case">No hay viajes programados en {MESES[mes]}</TableCell></TableRow>
            ) : (
              viajes.map((v) => (
                <TableRow key={v.id} className="cursor-pointer" onClick={() => router.push(`/viajes/${v.id}`)}>
                  <TableCell className="whitespace-nowrap">{formatDateAR(v.fecha)}{v.dias > 1 && <span className="text-xs text-muted-foreground"> → {formatDateAR(sumarDias(String(v.fecha).slice(0, 10), v.dias - 1))}</span>}</TableCell>
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

      <ProgramarViajeDialog
        open={dialogo}
        onOpenChange={setDialogo}
        fechaInicial={fechaDialogo}
        onProgramado={(v) => {
          // Si el viaje cae en otro mes, saltar a ese mes
          const a = Number(v.fecha.slice(0, 4))
          const m = Number(v.fecha.slice(5, 7)) - 1
          if (a !== anio || m !== mes) setAnioMes(a, m)
          else recargar(true)
        }}
      />
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
