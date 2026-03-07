"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { updateOrderStatus } from "@/lib/actions/admin"
import { Check, X, Truck, Package } from "lucide-react"
import { useRouter } from "next/navigation"

export function UpdateOrderStatusButton({
  pedidoId,
  currentStatus,
}: {
  pedidoId: string
  currentStatus: string
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleStatusChange = async (newStatus: string) => {
    setLoading(true)
    try {
      await updateOrderStatus(pedidoId, newStatus)
      router.refresh()
    } catch (error) {
      console.error("Error updating status:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={loading}>
          {loading ? "Actualizando..." : "Cambiar Estado"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => handleStatusChange("aprobado")}>
          <Check className="h-4 w-4 mr-2 text-green-600" />
          Aprobar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleStatusChange("rechazado")}>
          <X className="h-4 w-4 mr-2 text-red-600" />
          Rechazar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleStatusChange("enviado")}>
          <Truck className="h-4 w-4 mr-2 text-blue-600" />
          Marcar como Enviado
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleStatusChange("entregado")}>
          <Package className="h-4 w-4 mr-2 text-emerald-600" />
          Marcar como Entregado
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
