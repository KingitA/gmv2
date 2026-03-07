"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Eye } from "lucide-react"

interface Movimiento {
  id: string
  fecha: string
  tipo: string
  numero: string
  descripcion: string
  debe: number
  haber: number
  saldo: number
  estado?: string
}

interface CuentaCorrienteTableProps {
  movimientos: Movimiento[]
}

export function CuentaCorrienteTable({ movimientos }: CuentaCorrienteTableProps) {
  const [selectedMovimiento, setSelectedMovimiento] = useState<Movimiento | null>(null)

  const getTipoBadge = (tipo: string) => {
    switch (tipo) {
      case "pedido":
        return <Badge variant="default">Pedido</Badge>
      case "pago":
        return (
          <Badge variant="secondary" className="bg-green-500">
            Pago
          </Badge>
        )
      case "devolucion":
        return <Badge variant="outline">Devolución</Badge>
      default:
        return <Badge variant="outline">{tipo}</Badge>
    }
  }

  const getEstadoBadge = (estado?: string) => {
    if (!estado) return null

    switch (estado) {
      case "confirmado":
        return (
          <Badge variant="default" className="bg-green-500">
            Confirmado
          </Badge>
        )
      case "pendiente":
        return <Badge variant="secondary">Pendiente</Badge>
      case "rechazado":
        return <Badge variant="destructive">Rechazado</Badge>
      default:
        return <Badge variant="outline">{estado}</Badge>
    }
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Número</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead className="text-right">Debe</TableHead>
            <TableHead className="text-right">Haber</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movimientos.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                No hay movimientos registrados
              </TableCell>
            </TableRow>
          ) : (
            movimientos.map((mov) => (
              <TableRow key={mov.id}>
                <TableCell>{new Date(mov.fecha).toLocaleDateString("es-AR")}</TableCell>
                <TableCell>{getTipoBadge(mov.tipo)}</TableCell>
                <TableCell className="font-mono text-sm">{mov.numero}</TableCell>
                <TableCell>{mov.descripcion}</TableCell>
                <TableCell className="text-right font-medium">
                  {mov.debe > 0 ? `$${mov.debe.toLocaleString("es-AR", { minimumFractionDigits: 2 })}` : "-"}
                </TableCell>
                <TableCell className="text-right font-medium text-green-600">
                  {mov.haber > 0 ? `$${mov.haber.toLocaleString("es-AR", { minimumFractionDigits: 2 })}` : "-"}
                </TableCell>
                <TableCell className="text-right font-bold">
                  ${Math.abs(mov.saldo).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell>{getEstadoBadge(mov.estado)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedMovimiento(mov)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
