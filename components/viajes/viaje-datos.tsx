"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"

// Datos del viaje: se completan de a poco mientras está 'programado'
// (primero fecha + zonas; más cerca de la fecha, quién lleva y en qué).

type Opcion = { id: string; nombre: string }
const NINGUNO = "__ninguno__"

export function ViajeDatos({ viajeId, editable, onGuardado }: { viajeId: string; editable: boolean; onGuardado: () => void }) {
  const supabase = createClient()
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  const [zonas, setZonas] = useState<Opcion[]>([])
  const [choferes, setChoferes] = useState<Opcion[]>([])
  const [vehiculos, setVehiculos] = useState<Opcion[]>([])
  const [transportes, setTransportes] = useState<Opcion[]>([])

  const [nombre, setNombre] = useState("")
  const [fecha, setFecha] = useState("")
  const [zonaIds, setZonaIds] = useState<string[]>([])
  const [porTransporte, setPorTransporte] = useState(false)
  const [transporteId, setTransporteId] = useState("")
  const [titularId, setTitularId] = useState("")
  const [acompananteIds, setAcompananteIds] = useState<string[]>([])
  const [vehiculoId, setVehiculoId] = useState("")
  const [presupuesto, setPresupuesto] = useState({ dinero_nafta: "", gastos_peon: "", gastos_hotel: "", gastos_adicionales: "" })
  const [observaciones, setObservaciones] = useState("")

  useEffect(() => {
    const cargar = async () => {
      const [v, z, ch, ve, tr] = await Promise.all([
        supabase
          .from("viajes")
          .select("nombre, fecha, tipo_transporte, transporte_id, vehiculo_id, chofer_id, dinero_nafta, gastos_peon, gastos_hotel, gastos_adicionales, observaciones, viaje_zonas(zona_id), viajes_choferes(usuario_id, rol)")
          .eq("id", viajeId)
          .single(),
        supabase.from("zonas").select("id, nombre").order("nombre"),
        supabase
          .from("usuarios")
          .select("id, nombre, usuarios_roles!inner(roles!inner(nombre))")
          .eq("usuarios_roles.roles.nombre", "chofer")
          .eq("estado", "activo")
          .order("nombre"),
        supabase.from("vehiculos").select("id, nombre, patente").eq("activo", true).order("nombre"),
        supabase.from("transportes").select("id, nombre").eq("activo", true).order("nombre"),
      ])
      const d: any = v.data
      if (d) {
        setNombre(d.nombre || "")
        setFecha(String(d.fecha).slice(0, 10))
        setZonaIds((d.viaje_zonas || []).map((x: any) => x.zona_id))
        setPorTransporte(d.tipo_transporte === "transporte")
        setTransporteId(d.transporte_id || "")
        setTitularId(d.chofer_id || "")
        setAcompananteIds((d.viajes_choferes || []).filter((c: any) => c.rol !== "titular").map((c: any) => c.usuario_id))
        setVehiculoId(d.vehiculo_id || "")
        setPresupuesto({
          dinero_nafta: String(Number(d.dinero_nafta) || ""),
          gastos_peon: String(Number(d.gastos_peon) || ""),
          gastos_hotel: String(Number(d.gastos_hotel) || ""),
          gastos_adicionales: String(Number(d.gastos_adicionales) || ""),
        })
        setObservaciones(d.observaciones || "")
      }
      setZonas(z.data || [])
      setChoferes((ch.data || []).map((c: any) => ({ id: c.id, nombre: c.nombre })))
      setVehiculos((ve.data || []).map((x: any) => ({ id: x.id, nombre: x.patente ? `${x.nombre} · ${x.patente}` : x.nombre })))
      setTransportes(tr.data || [])
      setCargando(false)
    }
    cargar()
  }, [viajeId])

  const guardar = async () => {
    setGuardando(true)
    try {
      const res = await fetch(`/api/viajes/${viajeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editable
            ? {
                nombre,
                fecha,
                zona_ids: zonaIds,
                tipo_transporte: porTransporte ? "transporte" : "chofer_propio",
                transporte_id: transporteId || null,
                chofer_id: titularId || null,
                acompanante_ids: acompananteIds,
                vehiculo_id: vehiculoId || null,
                ...presupuesto,
                observaciones,
              }
            : { observaciones },
        ),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success("Viaje guardado")
      onGuardado()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar")
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>

  const presupuestoTotal = Object.values(presupuesto).reduce((s, v) => s + (Number(v) || 0), 0)

  return (
    <div className="space-y-6">
      {!editable && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          El viaje ya fue despachado: solo se pueden editar las observaciones.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Nombre</Label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!editable} />
        </div>
        <div>
          <Label>Fecha</Label>
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={!editable} />
        </div>
      </div>

      <div>
        <Label>Zonas</Label>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border p-3 md:grid-cols-4">
          {zonas.map((z) => (
            <label key={z.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                disabled={!editable}
                checked={zonaIds.includes(z.id)}
                onCheckedChange={(c) => setZonaIds((prev) => (c ? [...prev, z.id] : prev.filter((x) => x !== z.id)))}
              />
              {z.nombre}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={porTransporte ? "outline" : "default"} disabled={!editable} onClick={() => setPorTransporte(false)}>
            Chofer propio
          </Button>
          <Button type="button" size="sm" variant={porTransporte ? "default" : "outline"} disabled={!editable} onClick={() => setPorTransporte(true)}>
            Transporte tercerizado
          </Button>
        </div>

        {porTransporte ? (
          <div className="max-w-sm">
            <Label>Transporte</Label>
            <Select value={transporteId || NINGUNO} onValueChange={(v) => setTransporteId(v === NINGUNO ? "" : v)} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NINGUNO}>Sin definir</SelectItem>
                {transportes.map((t) => <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              La hoja de ruta queda como constancia del despacho. No hay app, cobros ni rendición.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Chofer titular</Label>
              <Select
                value={titularId || NINGUNO}
                onValueChange={(v) => {
                  const id = v === NINGUNO ? "" : v
                  setTitularId(id)
                  setAcompananteIds((prev) => prev.filter((x) => x !== id))
                }}
                disabled={!editable}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NINGUNO}>Sin definir</SelectItem>
                  {choferes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Responsable de la plata: su billetera es la del viaje.</p>
            </div>
            <div>
              <Label>Acompañantes</Label>
              <div className="mt-1 space-y-1.5 rounded-md border p-2">
                {choferes.filter((c) => c.id !== titularId).map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      disabled={!editable}
                      checked={acompananteIds.includes(c.id)}
                      onCheckedChange={(ch) => setAcompananteIds((prev) => (ch ? [...prev, c.id] : prev.filter((x) => x !== c.id)))}
                    />
                    {c.nombre}
                  </label>
                ))}
                {choferes.length <= 1 && <p className="text-xs text-muted-foreground">No hay otros usuarios con rol chofer</p>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Abren el viaje en su equipo y cobran contra la billetera del titular.</p>
            </div>
            <div>
              <Label>Vehículo</Label>
              <Select value={vehiculoId || NINGUNO} onValueChange={(v) => setVehiculoId(v === NINGUNO ? "" : v)} disabled={!editable}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NINGUNO}>Sin definir</SelectItem>
                  {vehiculos.map((x) => <SelectItem key={x.id} value={x.id}>{x.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {!porTransporte && (
        <div>
          <Label>Presupuesto de gastos (estimado, informativo)</Label>
          <div className="mt-1 grid grid-cols-2 gap-3 md:grid-cols-5">
            {([
              ["dinero_nafta", "Nafta"],
              ["gastos_peon", "Peón"],
              ["gastos_hotel", "Hotel"],
              ["gastos_adicionales", "Otros"],
            ] as const).map(([campo, etiqueta]) => (
              <div key={campo}>
                <span className="text-xs text-muted-foreground">{etiqueta}</span>
                <Input
                  type="number"
                  min="0"
                  disabled={!editable}
                  value={presupuesto[campo]}
                  onChange={(e) => setPresupuesto((p) => ({ ...p, [campo]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <span className="text-xs text-muted-foreground">Total</span>
              <div className="flex h-9 items-center font-semibold">$ {presupuestoTotal.toLocaleString("es-AR")}</div>
            </div>
          </div>
        </div>
      )}

      <div>
        <Label>Observaciones</Label>
        <Textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} />
      </div>

      <div className="flex justify-end">
        <Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</Button>
      </div>
    </div>
  )
}
