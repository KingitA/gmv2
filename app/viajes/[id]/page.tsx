"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from 'next/navigation'
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Truck, Calendar, MapPin, User, Package, DollarSign, CreditCard, Banknote } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Pedido = {
  id: string
  numero_pedido: string
  cliente: {
    nombre_razon_social: string
    direccion: string
  }
  total: number
  estado: string
  bultos_total: number
  saldo_anterior: number
}

type Viaje = {
  id: string
  nombre: string
  fecha: string
  estado: string
  chofer_id: string | null
  chofer?: { nombre: string; email: string } | null
  vehiculo: string
  observaciones: string
  dinero_nafta: number
  gastos_peon: number
  gastos_hotel: number
  gastos_adicionales: number
}

export default function ViajeDetallePage() {
  const router = useRouter()
  const params = useParams()
  const viajeId = params?.id as string

  const [viaje, setViaje] = useState<Viaje | null>(null)
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [cobranzas, setCobranzas] = useState({
    efectivo: 0,
    cheques: 0,
    transferencias: 0,
    total: 0
  })

  const supabase = createClient()

  useEffect(() => {
    loadViajeDetalle()
  }, [viajeId])

  async function loadViajeDetalle() {
    try {
      setLoading(true)

      const { data: viajeData, error: viajeError } = await supabase
        .from("viajes")
        .select(`
          id,
          nombre,
          fecha,
          estado,
          vehiculo,
          observaciones,
          dinero_nafta,
          gastos_peon,
          gastos_hotel,
          gastos_adicionales,
          chofer_id,
          chofer:usuarios!viajes_chofer_id_fkey(nombre, email)
        `)
        .eq("id", viajeId)
        .single()

      if (viajeError) throw viajeError

      if (viajeError) throw viajeError

      // Manejar chofer si viene como array o objeto
      const formattedViaje = {
        ...viajeData,
        chofer: Array.isArray(viajeData.chofer) ? viajeData.chofer[0] : viajeData.chofer
      }

      setViaje(formattedViaje as any)

      const { data: pedidosData, error: pedidosError } = await supabase
        .from("pedidos")
        .select(`
          id,
          numero_pedido,
          total,
          estado,
          clientes!inner(
            nombre_razon_social,
            direccion
          ),
          pedidos_detalle(
            cantidad,
            articulos(unidades_por_bulto)
          )
        `)
        .eq("viaje_id", viajeId)
        .order("numero_pedido", { ascending: true })

      if (pedidosError) throw pedidosError

      const pedidosConDatos = await Promise.all(
        (pedidosData || []).map(async (pedido: any) => {
          // Calcular total de bultos
          const bultos = pedido.pedidos_detalle.reduce((sum: number, item: any) => {
            const unidadesPorBulto = item.articulos?.unidades_por_bulto || 1
            const bultosItem = Math.ceil(item.cantidad / unidadesPorBulto)
            return sum + bultosItem
          }, 0)

          // Obtener saldo anterior del cliente (facturas anteriores a este pedido)
          const { data: saldoData } = await supabase
            .from("comprobantes_venta")
            .select("saldo_pendiente")
            .eq("cliente_id", pedido.clientes.id)
            .lt("created_at", pedido.created_at)

          const saldoAnterior = saldoData?.reduce((sum, comp) => sum + (comp.saldo_pendiente || 0), 0) || 0

          return {
            id: pedido.id,
            numero_pedido: pedido.numero_pedido,
            cliente: {
              nombre_razon_social: pedido.clientes.nombre_razon_social,
              direccion: pedido.clientes.direccion
            },
            total: pedido.total,
            estado: pedido.estado,
            bultos_total: bultos,
            saldo_anterior: saldoAnterior
          }
        })
      )

      setPedidos(pedidosConDatos)

      const { data: pagosData } = await supabase
        .from("viajes_pagos")
        .select("forma_pago, monto")
        .eq("viaje_id", viajeId)

      if (pagosData) {
        const efectivo = pagosData
          .filter(p => p.forma_pago === "efectivo")
          .reduce((sum, p) => sum + p.monto, 0)

        const cheques = pagosData
          .filter(p => p.forma_pago === "cheque")
          .length

        const transferencias = pagosData
          .filter(p => p.forma_pago === "transferencia")
          .length

        const total = pagosData.reduce((sum, p) => sum + p.monto, 0)

        setCobranzas({
          efectivo,
          cheques,
          transferencias,
          total
        })
      }

    } catch (error) {
      console.error("Error cargando viaje:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">Cargando viaje...</div>
      </div>
    )
  }

  if (!viaje) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">Viaje no encontrado</div>
      </div>
    )
  }

  const estadoColor = {
    pendiente: "bg-yellow-500",
    "en viaje": "bg-blue-500",
    finalizado: "bg-green-500"
  }[viaje.estado] || "bg-gray-500"

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/viajes")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{viaje.nombre}</h1>
            <p className="text-muted-foreground">Detalle del viaje</p>
          </div>
        </div>
        <Badge className={estadoColor}>{viaje.estado}</Badge>
      </div>

      {/* Info del viaje */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fecha Entrega</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Date(viaje.fecha).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Chofer</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {viaje.chofer?.nombre || "Sin asignar"}
            </div>
            {viaje.chofer?.email && (
              <p className="text-xs text-muted-foreground">{viaje.chofer.email}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vehículo</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{viaje.vehiculo || "N/A"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pedidos</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pedidos.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Cobranzas */}
      <Card>
        <CardHeader>
          <CardTitle>Cobranzas del Viaje</CardTitle>
          <CardDescription>Resumen de pagos realizados</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium">Efectivo</p>
                <p className="text-2xl font-bold">${cobranzas.efectivo.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium">Cheques</p>
                <p className="text-2xl font-bold">{cobranzas.cheques}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium">Transferencias</p>
                <p className="text-2xl font-bold">{cobranzas.transferencias}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-orange-600" />
              <div>
                <p className="text-sm font-medium">Total Cobrado</p>
                <p className="text-2xl font-bold">${cobranzas.total.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de pedidos */}
      <Card>
        <CardHeader>
          <CardTitle>Pedidos del Viaje</CardTitle>
          <CardDescription>Lista de pedidos asignados a este viaje</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N° Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Dirección</TableHead>
                <TableHead className="text-right">Bultos</TableHead>
                <TableHead className="text-right">Saldo Anterior</TableHead>
                <TableHead className="text-right">Saldo Actual</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidos.map((pedido) => (
                <TableRow key={pedido.id}>
                  <TableCell className="font-medium">{pedido.numero_pedido}</TableCell>
                  <TableCell>{pedido.cliente.nombre_razon_social}</TableCell>
                  <TableCell className="max-w-xs truncate">
                    {pedido.cliente.direccion || "Sin dirección"}
                  </TableCell>
                  <TableCell className="text-right">{pedido.bultos_total}</TableCell>
                  <TableCell className="text-right">
                    ${pedido.saldo_anterior.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    ${pedido.total.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={pedido.estado === "pendiente" ? "secondary" : "default"}>
                      {pedido.estado}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
