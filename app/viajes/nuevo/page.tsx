"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

type Zona = {
  id: string
  nombre: string
}

type Transporte = {
  id: string
  nombre: string
  porcentaje_flete: number
}

type Pedido = {
  id: string
  numero_pedido: string
  fecha: string
  total: number
  clientes?: {
    nombre_razon_social: string
  }
}

type Chofer = {
  id: string
  nombre: string
  email: string
}

export default function NuevoViajePage() {
  const router = useRouter()
  const supabase = createClient()

  const [nombre, setNombre] = useState("")
  const [fecha, setFecha] = useState("")
  const [zonaId, setZonaId] = useState("")
  const [tipoTransporte, setTipoTransporte] = useState<"transporte" | "chofer_propio">("transporte")
  const [transporteId, setTransporteId] = useState("")
  const [choferId, setChoferId] = useState("")
  const [vehiculo, setVehiculo] = useState("")
  const [porcentajeFlete, setPorcentajeFlete] = useState("")
  const [dineroNafta, setDineroNafta] = useState("")
  const [gastosPeon, setGastosPeon] = useState("")
  const [gastosHotel, setGastosHotel] = useState("")
  const [gastosAdicionales, setGastosAdicionales] = useState("")
  const [observaciones, setObservaciones] = useState("")

  const [zonas, setZonas] = useState<Zona[]>([])
  const [transportes, setTransportes] = useState<Transporte[]>([])
  const [choferes, setChoferes] = useState<Chofer[]>([])
  const [pedidosDisponibles, setPedidosDisponibles] = useState<Pedido[]>([])
  const [pedidosSeleccionados, setPedidosSeleccionados] = useState<string[]>([])

  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    cargarZonas()
    cargarTransportes()
    cargarChoferes()
    cargarPedidosDisponibles()
  }, [])

  const cargarZonas = async () => {
    const { data } = await supabase.from("zonas").select("id, nombre").order("nombre")
    setZonas(data || [])
  }

  const cargarTransportes = async () => {
    const { data } = await supabase
      .from("transportes")
      .select("id, nombre, porcentaje_flete")
      .eq("activo", true)
      .order("nombre")
    setTransportes(data || [])
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

  const cargarPedidosDisponibles = async () => {
    const { data } = await supabase
      .from("pedidos")
      .select(`
        id,
        numero_pedido,
        fecha,
        total,
        clientes (nombre_razon_social)
      `)
      .eq("estado", "pendiente")
      .is("viaje_id", null)
      .order("fecha", { ascending: true })
    setPedidosDisponibles(data || [])
  }

  const togglePedido = (pedidoId: string) => {
    setPedidosSeleccionados((prev) =>
      prev.includes(pedidoId) ? prev.filter((id) => id !== pedidoId) : [...prev, pedidoId],
    )
  }

  const guardarViaje = async () => {
    try {
      setGuardando(true)

      // Validaciones
      if (!nombre || !fecha || !zonaId) {
        alert("Por favor completa todos los campos obligatorios")
        return
      }

      if (tipoTransporte === "transporte" && !transporteId) {
        alert("Por favor selecciona un transporte")
        return
      }

      if (tipoTransporte === "chofer_propio" && !choferId) {
        alert("Por favor selecciona un chofer")
        return
      }

      // Crear viaje
      const { data: viaje, error: viajeError } = await supabase
        .from("viajes")
        .insert({
          nombre,
          fecha,
          zona_id: zonaId,
          tipo_transporte: tipoTransporte,
          transporte_id: tipoTransporte === "transporte" ? transporteId : null,
          chofer_id: tipoTransporte === "chofer_propio" ? choferId : null,
          chofer: tipoTransporte === "chofer_propio" ? (choferes.find(c => c.id === choferId)?.nombre ?? null) : null,
          vehiculo: tipoTransporte === "chofer_propio" ? vehiculo : null,
          porcentaje_flete: Number.parseFloat(porcentajeFlete) || 0,
          dinero_nafta: Number.parseFloat(dineroNafta) || 0,
          gastos_peon: Number.parseFloat(gastosPeon) || 0,
          gastos_hotel: Number.parseFloat(gastosHotel) || 0,
          gastos_adicionales: Number.parseFloat(gastosAdicionales) || 0,
          observaciones,
          estado: "pendiente",
        })
        .select()
        .single()

      if (viajeError) throw viajeError

      // Asignar pedidos al viaje
      if (pedidosSeleccionados.length > 0) {
        const { error: pedidosError } = await supabase
          .from("pedidos")
          .update({ viaje_id: viaje.id })
          .in("id", pedidosSeleccionados)

        if (pedidosError) throw pedidosError
      }

      alert("Viaje creado exitosamente")
      router.push("/viajes")
    } catch (error) {
      console.error("Error creando viaje:", error)
      alert("Error al crear el viaje")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Crear Nuevo Viaje</h1>
          <p className="text-muted-foreground">Configura un nuevo viaje de entrega</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Información General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nombre">
                Nombre del Viaje <span className="text-red-500">*</span>
              </Label>
              <Input
                id="nombre"
                placeholder="ej: Olavarria 13/11"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fecha">
                Fecha <span className="text-red-500">*</span>
              </Label>
              <Input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="zona">
                Zona <span className="text-red-500">*</span>
              </Label>
              <Select value={zonaId} onValueChange={setZonaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar zona" />
                </SelectTrigger>
                <SelectContent>
                  {zonas.map((zona) => (
                    <SelectItem key={zona.id} value={zona.id}>
                      {zona.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Observaciones</Label>
              <Textarea
                placeholder="Notas adicionales sobre el viaje..."
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transporte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de Transporte</Label>
              <Select value={tipoTransporte} onValueChange={(v: any) => setTipoTransporte(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transporte">Transporte Externo</SelectItem>
                  <SelectItem value="chofer_propio">Chofer Propio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {tipoTransporte === "transporte" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="transporte">Empresa de Transporte</Label>
                  <Select value={transporteId} onValueChange={setTransporteId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar transporte" />
                    </SelectTrigger>
                    <SelectContent>
                      {transportes.map((transporte) => (
                        <SelectItem key={transporte.id} value={transporte.id}>
                          {transporte.nombre} ({transporte.porcentaje_flete}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="porcentaje_flete">% Flete</Label>
                  <Input
                    id="porcentaje_flete"
                    type="number"
                    step="0.01"
                    value={porcentajeFlete}
                    onChange={(e) => setPorcentajeFlete(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="chofer">Seleccionar Chofer <span className="text-red-500">*</span></Label>
                  <Select value={choferId} onValueChange={setChoferId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar chofer" />
                    </SelectTrigger>
                    <SelectContent>
                      {choferes.length === 0 ? (
                        <SelectItem value="_no_choferes" disabled>
                          No hay choferes disponibles
                        </SelectItem>
                      ) : (
                        choferes.map((chofer) => (
                          <SelectItem key={chofer.id} value={chofer.id}>
                            {chofer.nombre} ({chofer.email})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vehiculo">Vehículo</Label>
                  <Input
                    id="vehiculo"
                    placeholder="ej: Camión Ford F-350"
                    value={vehiculo}
                    onChange={(e) => setVehiculo(e.target.value)}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gastos del Viaje</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dinero_nafta">Dinero Nafta</Label>
              <Input
                id="dinero_nafta"
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={dineroNafta}
                onChange={(e) => setDineroNafta(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gastos_peon">Gastos Peón</Label>
              <Input
                id="gastos_peon"
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={gastosPeon}
                onChange={(e) => setGastosPeon(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gastos_hotel">Gastos Hotel</Label>
              <Input
                id="gastos_hotel"
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={gastosHotel}
                onChange={(e) => setGastosHotel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gastos_adicionales">Gastos Adicionales</Label>
              <Input
                id="gastos_adicionales"
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={gastosAdicionales}
                onChange={(e) => setGastosAdicionales(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Asignar Pedidos al Viaje</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={pedidosSeleccionados.length === pedidosDisponibles.length}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setPedidosSeleccionados(pedidosDisponibles.map((p) => p.id))
                      } else {
                        setPedidosSeleccionados([])
                      }
                    }}
                  />
                </TableHead>
                <TableHead>Nº Pedido</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidosDisponibles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No hay pedidos pendientes disponibles
                  </TableCell>
                </TableRow>
              ) : (
                pedidosDisponibles.map((pedido) => (
                  <TableRow key={pedido.id}>
                    <TableCell>
                      <Checkbox
                        checked={pedidosSeleccionados.includes(pedido.id)}
                        onCheckedChange={() => togglePedido(pedido.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{pedido.numero_pedido}</TableCell>
                    <TableCell>{new Date(pedido.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                    <TableCell>{pedido.clientes?.nombre_razon_social}</TableCell>
                    <TableCell className="text-right">${pedido.total?.toFixed(2)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {pedidosSeleccionados.length > 0 && (
            <div className="mt-4 p-3 bg-muted rounded-md">
              <p className="text-sm font-medium">
                {pedidosSeleccionados.length} pedido(s) seleccionado(s) - Total: $
                {pedidosDisponibles
                  .filter((p) => pedidosSeleccionados.includes(p.id))
                  .reduce((sum, p) => sum + p.total, 0)
                  .toFixed(2)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-4">
        <Button variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button onClick={guardarViaje} disabled={guardando}>
          {guardando ? "Guardando..." : "Crear Viaje"}
        </Button>
      </div>
    </div>
  )
}


