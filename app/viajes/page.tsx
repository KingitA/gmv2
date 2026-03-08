"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Search, Eye, Truck, Plus, MapPin, Pencil } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"

type Viaje = {
  id: string
  nombre: string
  fecha: string
  estado: string
  zona_id: string
  transporte_id: string | null
  tipo_transporte: string
  chofer_id: string | null
  chofer?: {
    nombre: string
    email: string
  }
  vehiculo: string | null
  porcentaje_flete: number
  dinero_nafta: number
  gastos_peon: number
  gastos_hotel: number
  gastos_adicionales: number
  observaciones: string | null
  created_at: string
  zonas?: {
    nombre: string
    costo_nafta: number
    costo_pernoctada: number
    costo_sueldo: number
    costo_otros: number
  }
  transportes?: {
    nombre: string
    porcentaje_flete: number
  }
}

type PedidoEnViaje = {
  id: string
  numero_pedido: string
  total: number
  estado: string
  clientes?: {
    nombre_razon_social: string
    localidades?: {
      nombre: string
    }
  }
}

type Chofer = {
  id: string
  nombre: string
  email: string
}

const ESTADOS_VIAJE = [
  { value: "pendiente", label: "Pendiente", color: "bg-yellow-500" },
  { value: "en_curso", label: "En Curso", color: "bg-blue-500" },
  { value: "completado", label: "Completado", color: "bg-green-500" },
  { value: "cancelado", label: "Cancelado", color: "bg-red-500" },
]

export default function ViajesPage() {
  const router = useRouter()

  const [viajes, setViajes] = useState<Viaje[]>([])
  const [viajeSeleccionado, setViajeSeleccionado] = useState<Viaje | null>(null)
  const [pedidosViaje, setPedidosViaje] = useState<PedidoEnViaje[]>([])
  const [busqueda, setBusqueda] = useState("")
  const [cargando, setCargando] = useState(true)
  const [viajeEditando, setViajeEditando] = useState<Viaje | null>(null)
  const [mostrarDialogEditar, setMostrarDialogEditar] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    cargarViajes()
  }, [])

  const cargarViajes = async () => {
    try {
      setCargando(true)
      const { data: viajesData, error } = await supabase
        .from("viajes")
        .select(`
          *,
          zonas (nombre, costo_nafta, costo_pernoctada, costo_sueldo, costo_otros),
          transportes (nombre, porcentaje_flete)
        `)
        .order("fecha", { ascending: false })

      if (error) throw error

      if (!viajesData || viajesData.length === 0) {
        setViajes([])
        return
      }

      // Obtener IDs únicos de choferes
      const choferIds = (viajesData as any[]).map((v) => v.chofer_id).filter((id): id is string => id !== null && id !== undefined)

      // Si hay choferes, obtenerlos de la tabla usuarios
      let choferesMap: Record<string, { nombre: string; email: string }> = {}

      if (choferIds.length > 0) {
        const { data: choferesData, error: choferesError } = await supabase
          .from("usuarios")
          .select("id, nombre, email")
          .in("id", choferIds)

        if (!choferesError && choferesData) {
          choferesMap = (choferesData as any[]).reduce(
            (acc, chofer) => {
              acc[chofer.id] = { nombre: chofer.nombre, email: chofer.email }
              return acc
            },
            {} as Record<string, { nombre: string; email: string }>,
          )
        }
      }

      // Mapear los viajes con la info del chofer
      const viajesConChoferes = (viajesData as any[]).map((viaje) => ({
        ...viaje,
        chofer: viaje.chofer_id && choferesMap[viaje.chofer_id] ? choferesMap[viaje.chofer_id] : undefined,
      }))

      setViajes(viajesConChoferes)
    } catch (error) {
      console.error("Error cargando viajes:", error)
    } finally {
      setCargando(false)
    }
  }

  const cargarPedidosViaje = async (viajeId: string) => {
    try {
      const { data, error } = await supabase
        .from("pedidos")
        .select(`
          *,
          clientes (
            nombre_razon_social,
            localidades (nombre)
          )
        `)
        .eq("viaje_id", viajeId)
        .order("numero_pedido", { ascending: true })

      if (error) throw error
      setPedidosViaje(data || [])
    } catch (error) {
      console.error("Error cargando pedidos del viaje:", error)
    }
  }

  const abrirEdicion = (viaje: Viaje) => {
    setViajeEditando(viaje)
    setMostrarDialogEditar(true)
  }

  const viajesFiltrados = viajes.filter(
    (viaje) =>
      viaje.nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
      viaje.zonas?.nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
      viaje.chofer?.nombre?.toLowerCase().includes(busqueda.toLowerCase()),
  )

  const getEstadoBadge = (estado: string) => {
    const estadoConfig = ESTADOS_VIAJE.find((e) => e.value === estado)
    return <Badge className={`${estadoConfig?.color} text-white`}>{estadoConfig?.label || estado}</Badge>
  }

  const calcularTotalPedidos = () => {
    return pedidosViaje.reduce((sum, p) => sum + (p.total || 0), 0)
  }

  const calcularCostoFlete = (viaje: Viaje) => {
    const totalPedidos = pedidosViaje.reduce((sum, p) => sum + (p.total || 0), 0)
    return totalPedidos * (viaje.porcentaje_flete / 100)
  }

  const calcularGastosTotales = (viaje: Viaje) => {
    const costoFlete = calcularCostoFlete(viaje)
    const gastosZona =
      (viaje.zonas?.costo_nafta || 0) +
      (viaje.zonas?.costo_pernoctada || 0) +
      (viaje.zonas?.costo_sueldo || 0) +
      (viaje.zonas?.costo_otros || 0)

    return (
      costoFlete +
      gastosZona +
      (viaje.dinero_nafta || 0) +
      (viaje.gastos_peon || 0) +
      (viaje.gastos_hotel || 0) +
      (viaje.gastos_adicionales || 0)
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestión de Viajes</h1>
          <p className="text-muted-foreground">Administra los viajes de entrega por zona</p>
        </div>
        <Button asChild>
          <a href="/viajes/nuevo">
            <Plus className="h-4 w-4 mr-2" />
            Crear Viaje
          </a>
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Buscar por nombre, zona o chofer..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-10"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Zona</TableHead>
                <TableHead>Transporte/Chofer</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Cargando viajes...
                  </TableCell>
                </TableRow>
              ) : viajesFiltrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    No se encontraron viajes
                  </TableCell>
                </TableRow>
              ) : (
                viajesFiltrados.map((viaje) => (
                  <TableRow
                    key={viaje.id}
                    onDoubleClick={() => router.push(`/viajes/${viaje.id}`)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell className="font-medium">{viaje.nombre}</TableCell>
                    <TableCell>{new Date(viaje.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {viaje.zonas?.nombre || "Sin zona"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {viaje.tipo_transporte === "transporte" ? (
                        <div>
                          <div className="font-medium">{viaje.transportes?.nombre || "Sin asignar"}</div>
                          <div className="text-sm text-muted-foreground">Transporte</div>
                        </div>
                      ) : (
                        <div>
                          <div className="font-medium">{viaje.chofer?.nombre || "Sin asignar"}</div>
                          <div className="text-sm text-muted-foreground">
                            Chofer Propio {viaje.vehiculo && `- ${viaje.vehiculo}`}
                          </div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{getEstadoBadge(viaje.estado)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline">{viaje.id ? "Ver" : "0"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => abrirEdicion(viaje)}>
                          <Pencil className="h-4 w-4" />
                        </Button>

                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setViajeSeleccionado(viaje)
                                cargarPedidosViaje(viaje.id)
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>
                                <div className="flex items-center gap-3">
                                  <Truck className="h-6 w-6" />
                                  {viaje.nombre}
                                </div>
                              </DialogTitle>
                              <DialogDescription>
                                Detalles del viaje, pedidos asignados y análisis de costos
                              </DialogDescription>
                            </DialogHeader>

                            {viajeSeleccionado && (
                              <div className="space-y-6">
                                {/* Información General */}
                                <div className="grid grid-cols-3 gap-4">
                                  <Card>
                                    <CardHeader>
                                      <CardTitle className="text-sm">Información General</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                      <div>
                                        <Label className="text-muted-foreground">Fecha</Label>
                                        <p className="font-medium">
                                          {new Date(viajeSeleccionado.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-muted-foreground">Zona</Label>
                                        <p>{viajeSeleccionado.zonas?.nombre}</p>
                                      </div>
                                      <div>
                                        <Label className="text-muted-foreground">Estado</Label>
                                        <div className="mt-1">{getEstadoBadge(viajeSeleccionado.estado)}</div>
                                      </div>
                                    </CardContent>
                                  </Card>

                                  <Card>
                                    <CardHeader>
                                      <CardTitle className="text-sm">Transporte</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                      {viajeSeleccionado.tipo_transporte === "transporte" ? (
                                        <>
                                          <div>
                                            <Label className="text-muted-foreground">Empresa</Label>
                                            <p className="font-medium">{viajeSeleccionado.transportes?.nombre}</p>
                                          </div>
                                          <div>
                                            <Label className="text-muted-foreground">% Flete</Label>
                                            <p>{viajeSeleccionado.porcentaje_flete}%</p>
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div>
                                            <Label className="text-muted-foreground">Chofer</Label>
                                            <p className="font-medium">
                                              {viajeSeleccionado.chofer?.nombre || "Sin asignar"}
                                            </p>
                                          </div>
                                          {viajeSeleccionado.chofer?.email && (
                                            <div>
                                              <Label className="text-muted-foreground">Email</Label>
                                              <p className="text-sm">{viajeSeleccionado.chofer.email}</p>
                                            </div>
                                          )}
                                          <div>
                                            <Label className="text-muted-foreground">Vehículo</Label>
                                            <p>{viajeSeleccionado.vehiculo}</p>
                                          </div>
                                        </>
                                      )}
                                    </CardContent>
                                  </Card>

                                  <Card>
                                    <CardHeader>
                                      <CardTitle className="text-sm">Resumen Financiero</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                      <div>
                                        <Label className="text-muted-foreground">Total Facturado</Label>
                                        <p className="font-bold text-lg text-green-600">
                                          ${calcularTotalPedidos().toFixed(2)}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-muted-foreground">Costo Total</Label>
                                        <p className="font-bold text-lg text-red-600">
                                          ${calcularGastosTotales(viajeSeleccionado).toFixed(2)}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-muted-foreground">Ganancia</Label>
                                        <p className="font-bold text-lg text-blue-600">
                                          $
                                          {(calcularTotalPedidos() - calcularGastosTotales(viajeSeleccionado)).toFixed(
                                            2,
                                          )}
                                        </p>
                                      </div>
                                    </CardContent>
                                  </Card>
                                </div>

                                {/* Pedidos del Viaje */}
                                <Card>
                                  <CardHeader>
                                    <CardTitle className="text-sm">Pedidos Asignados ({pedidosViaje.length})</CardTitle>
                                  </CardHeader>
                                  <CardContent>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Nº Pedido</TableHead>
                                          <TableHead>Cliente</TableHead>
                                          <TableHead>Localidad</TableHead>
                                          <TableHead>Estado</TableHead>
                                          <TableHead className="text-right">Total</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {pedidosViaje.length === 0 ? (
                                          <TableRow>
                                            <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                                              No hay pedidos asignados a este viaje
                                            </TableCell>
                                          </TableRow>
                                        ) : (
                                          pedidosViaje.map((pedido) => (
                                            <TableRow key={pedido.id}>
                                              <TableCell className="font-medium">{pedido.numero_pedido}</TableCell>
                                              <TableCell>{pedido.clientes?.nombre_razon_social}</TableCell>
                                              <TableCell>{pedido.clientes?.localidades?.nombre}</TableCell>
                                              <TableCell>
                                                <Badge
                                                  variant={pedido.estado === "entregado" ? "default" : "secondary"}
                                                >
                                                  {pedido.estado}
                                                </Badge>
                                              </TableCell>
                                              <TableCell className="text-right font-medium">
                                                ${pedido.total?.toFixed(2)}
                                              </TableCell>
                                            </TableRow>
                                          ))
                                        )}
                                      </TableBody>
                                    </Table>
                                  </CardContent>
                                </Card>

                                {/* Detalle de Gastos */}
                                <Card>
                                  <CardHeader>
                                    <CardTitle className="text-sm">Detalle de Gastos</CardTitle>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="grid grid-cols-2 gap-6">
                                      <div className="space-y-2">
                                        <h4 className="font-medium">Costos de la Zona</h4>
                                        <div className="space-y-1 text-sm">
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Nafta</span>
                                            <span>${(viajeSeleccionado.zonas?.costo_nafta || 0).toFixed(2)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Pernoctada</span>
                                            <span>${(viajeSeleccionado.zonas?.costo_pernoctada || 0).toFixed(2)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Sueldo</span>
                                            <span>${(viajeSeleccionado.zonas?.costo_sueldo || 0).toFixed(2)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Otros</span>
                                            <span>${(viajeSeleccionado.zonas?.costo_otros || 0).toFixed(2)}</span>
                                          </div>
                                        </div>
                                      </div>

                                      <div className="space-y-2">
                                        <h4 className="font-medium">Gastos del Viaje</h4>
                                        <div className="space-y-1 text-sm">
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Costo Flete</span>
                                            <span>${calcularCostoFlete(viajeSeleccionado).toFixed(2)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Dinero Nafta</span>
                                            <span>${(viajeSeleccionado.dinero_nafta || 0).toFixed(2)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Gastos Peón</span>
                                            <span>${(viajeSeleccionado.gastos_peon || 0).toFixed(2)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Gastos Hotel</span>
                                            <span>${(viajeSeleccionado.gastos_hotel || 0).toFixed(2)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Gastos Adicionales</span>
                                            <span>${(viajeSeleccionado.gastos_adicionales || 0).toFixed(2)}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex justify-between pt-4 border-t mt-4">
                                      <span className="font-bold">TOTAL GASTOS</span>
                                      <span className="font-bold text-lg">
                                        ${calcularGastosTotales(viajeSeleccionado).toFixed(2)}
                                      </span>
                                    </div>
                                  </CardContent>
                                </Card>

                                {viajeSeleccionado.observaciones && (
                                  <Card>
                                    <CardHeader>
                                      <CardTitle className="text-sm">Observaciones</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                      <p className="text-sm">{viajeSeleccionado.observaciones}</p>
                                    </CardContent>
                                  </Card>
                                )}
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {viajeEditando && (
        <Dialog open={mostrarDialogEditar} onOpenChange={setMostrarDialogEditar}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar Viaje</DialogTitle>
              <DialogDescription>Modificá los datos del viaje {viajeEditando.nombre}</DialogDescription>
            </DialogHeader>

            <EditarViajeForm
              viaje={viajeEditando}
              onSuccess={() => {
                setMostrarDialogEditar(false)
                cargarViajes()
              }}
              onCancel={() => setMostrarDialogEditar(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function EditarViajeForm({
  viaje,
  onSuccess,
  onCancel,
}: {
  viaje: Viaje
  onSuccess: () => void
  onCancel: () => void
}) {
  const supabase = createClient()
  const [guardando, setGuardando] = useState(false)

  const [formData, setFormData] = useState({
    nombre: viaje.nombre,
    fecha: viaje.fecha,
    estado: viaje.estado,
    tipo_transporte: viaje.tipo_transporte,
    transporte_id: viaje.transporte_id || "",
    chofer_id: viaje.chofer_id || "",
    vehiculo: viaje.vehiculo || "",
    porcentaje_flete: viaje.porcentaje_flete,
    dinero_nafta: viaje.dinero_nafta,
    gastos_peon: viaje.gastos_peon,
    gastos_hotel: viaje.gastos_hotel,
    gastos_adicionales: viaje.gastos_adicionales,
    observaciones: viaje.observaciones || "",
  })

  const [transportes, setTransportes] = useState<any[]>([])
  const [choferes, setChoferes] = useState<Chofer[]>([])

  useEffect(() => {
    cargarTransportes()
    cargarChoferes()
  }, [])

  const cargarTransportes = async () => {
    const { data } = await supabase.from("transportes").select("*").eq("activo", true).order("nombre")

    if (data) setTransportes(data)
  }

  const cargarChoferes = async () => {
    const { data, error } = await supabase
      .from("usuarios")
      .select(`
        id,
        nombre,
        email,
        usuarios_roles!inner(
          roles!inner(nombre)
        )
      `)
      .eq("usuarios_roles.roles.nombre", "chofer")
      .eq("estado", "activo")
      .order("nombre")

    if (error) {
      console.error("Error cargando choferes:", error)
      return
    }

    setChoferes(data || [])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setGuardando(true)

      const updateData: any = {
        nombre: formData.nombre,
        fecha: formData.fecha,
        estado: formData.estado,
        tipo_transporte: formData.tipo_transporte,
        dinero_nafta: Number.parseFloat(formData.dinero_nafta.toString()) || 0,
        gastos_peon: Number.parseFloat(formData.gastos_peon.toString()) || 0,
        gastos_hotel: Number.parseFloat(formData.gastos_hotel.toString()) || 0,
        gastos_adicionales: Number.parseFloat(formData.gastos_adicionales.toString()) || 0,
        observaciones: formData.observaciones,
      }

      if (formData.tipo_transporte === "transporte") {
        updateData.transporte_id = formData.transporte_id
        updateData.chofer_id = null
        updateData.vehiculo = null

        const transporteSeleccionado = transportes.find((t) => t.id === formData.transporte_id)
        updateData.porcentaje_flete = transporteSeleccionado?.porcentaje_flete || 0
      } else {
        updateData.transporte_id = null
        updateData.chofer_id = formData.chofer_id
        updateData.vehiculo = formData.vehiculo
        updateData.porcentaje_flete = 0
      }

      const { error } = await supabase.from("viajes").update(updateData).eq("id", viaje.id)

      if (error) throw error

      onSuccess()
    } catch (error) {
      console.error("Error actualizando viaje:", error)
      alert("Error al actualizar el viaje")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="nombre">Nombre del Viaje</Label>
          <Input
            id="nombre"
            value={formData.nombre}
            onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="fecha">Fecha</Label>
          <Input
            id="fecha"
            type="date"
            value={formData.fecha}
            onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="estado">Estado</Label>
          <select
            id="estado"
            value={formData.estado}
            onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
            className="w-full border rounded-md px-3 py-2"
            required
          >
            {ESTADOS_VIAJE.map((estado) => (
              <option key={estado.value} value={estado.value}>
                {estado.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tipo_transporte">Tipo de Transporte</Label>
          <select
            id="tipo_transporte"
            value={formData.tipo_transporte}
            onChange={(e) => setFormData({ ...formData, tipo_transporte: e.target.value })}
            className="w-full border rounded-md px-3 py-2"
            required
          >
            <option value="transporte">Transporte Externo</option>
            <option value="chofer">Chofer Propio</option>
          </select>
        </div>
      </div>

      {formData.tipo_transporte === "transporte" ? (
        <div className="space-y-2">
          <Label htmlFor="transporte_id">Transporte</Label>
          <select
            id="transporte_id"
            value={formData.transporte_id}
            onChange={(e) => setFormData({ ...formData, transporte_id: e.target.value })}
            className="w-full border rounded-md px-3 py-2"
            required
          >
            <option value="">Seleccionar transporte...</option>
            {transportes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre} - {t.porcentaje_flete}% flete
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="chofer_id">Chofer</Label>
            <select
              id="chofer_id"
              value={formData.chofer_id}
              onChange={(e) => setFormData({ ...formData, chofer_id: e.target.value })}
              className="w-full border rounded-md px-3 py-2"
              required
            >
              <option value="">Seleccionar chofer...</option>
              {choferes.map((chofer) => (
                <option key={chofer.id} value={chofer.id}>
                  {chofer.nombre} ({chofer.email})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehiculo">Vehículo</Label>
            <Input
              id="vehiculo"
              value={formData.vehiculo}
              onChange={(e) => setFormData({ ...formData, vehiculo: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="font-semibold">Gastos del Viaje</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="dinero_nafta">Dinero para Nafta</Label>
            <Input
              id="dinero_nafta"
              type="number"
              step="0.01"
              value={formData.dinero_nafta}
              onChange={(e) => setFormData({ ...formData, dinero_nafta: Number.parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gastos_peon">Gastos Peón</Label>
            <Input
              id="gastos_peon"
              type="number"
              step="0.01"
              value={formData.gastos_peon}
              onChange={(e) => setFormData({ ...formData, gastos_peon: Number.parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gastos_hotel">Gastos Hotel</Label>
            <Input
              id="gastos_hotel"
              type="number"
              step="0.01"
              value={formData.gastos_hotel}
              onChange={(e) => setFormData({ ...formData, gastos_hotel: Number.parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gastos_adicionales">Gastos Adicionales</Label>
            <Input
              id="gastos_adicionales"
              type="number"
              step="0.01"
              value={formData.gastos_adicionales}
              onChange={(e) => setFormData({ ...formData, gastos_adicionales: Number.parseFloat(e.target.value) || 0 })}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="observaciones">Observaciones</Label>
        <textarea
          id="observaciones"
          value={formData.observaciones}
          onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
          className="w-full border rounded-md px-3 py-2 min-h-[80px]"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar Cambios"}
        </Button>
      </div>
    </form>
  )
}


