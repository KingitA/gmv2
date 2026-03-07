"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClienteSelectorDevolucion } from "./cliente-selector-devolucion"
import { ArticulosFacturadosTable } from "./articulos-facturados-table"
import { DevolucionCarrito } from "./devolucion-carrito"

interface DevolucionesManagerProps {
  vendedorId: string
}

export function DevolucionesManager({ vendedorId }: DevolucionesManagerProps) {
  const [clienteSeleccionado, setClienteSeleccionado] = useState<any>(null)
  const [carrito, setCarrito] = useState<any[]>([])

  const handleAgregarArticulo = (articulo: any) => {
    setCarrito((prev) => [...prev, articulo])
  }

  const handleRemoverArticulo = (index: number) => {
    setCarrito((prev) => prev.filter((_, i) => i !== index))
  }

  const handleLimpiarCarrito = () => {
    setCarrito([])
  }

  return (
    <div className="space-y-6">
      {/* Selector de Cliente */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1. Seleccionar Cliente</CardTitle>
          <CardDescription>Busca el cliente para el cual deseas generar una devolución</CardDescription>
        </CardHeader>
        <CardContent>
          <ClienteSelectorDevolucion vendedorId={vendedorId} onClienteSelect={setClienteSeleccionado} />
          {clienteSeleccionado && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <p className="font-medium">{clienteSeleccionado.razon_social}</p>
              <p className="text-sm text-muted-foreground">
                {clienteSeleccionado.direccion} - {clienteSeleccionado.localidad}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Artículos Facturados */}
      {clienteSeleccionado && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. Buscar Artículos Facturados</CardTitle>
            <CardDescription>Selecciona los artículos que deseas devolver de las facturas anteriores</CardDescription>
          </CardHeader>
          <CardContent>
            <ArticulosFacturadosTable clienteId={clienteSeleccionado.id} onAgregarArticulo={handleAgregarArticulo} />
          </CardContent>
        </Card>
      )}

      {/* Carrito de Devolución */}
      {carrito.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">3. Confirmar Devolución</CardTitle>
            <CardDescription>Revisa los artículos a devolver y confirma la orden</CardDescription>
          </CardHeader>
          <CardContent>
            <DevolucionCarrito
              items={carrito}
              clienteId={clienteSeleccionado?.id}
              onRemoverItem={handleRemoverArticulo}
              onLimpiar={handleLimpiarCarrito}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
