"use client"

import { useState } from "react"
import { updatePagoStatus } from "@/lib/actions/pagos"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { CheckCircle, XCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

export function ApprovePaymentButton({ pagoId }: { pagoId: string }) {
  const [isApproving, setIsApproving] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const handleApprove = async () => {
    setIsApproving(true)
    try {
      await updatePagoStatus(pagoId, "aprobado")
      toast({
        title: "Pago aprobado",
        description: "El pago ha sido aprobado exitosamente",
      })
      router.refresh()
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo aprobar el pago",
        variant: "destructive",
      })
    } finally {
      setIsApproving(false)
    }
  }

  const handleReject = async () => {
    setIsRejecting(true)
    try {
      await updatePagoStatus(pagoId, "rechazado")
      toast({
        title: "Pago rechazado",
        description: "El pago ha sido rechazado",
      })
      router.refresh()
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo rechazar el pago",
        variant: "destructive",
      })
    } finally {
      setIsRejecting(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Button onClick={handleApprove} disabled={isApproving || isRejecting} className="bg-green-600 hover:bg-green-700">
        {isApproving ? <Spinner className="mr-2 h-4 w-4" /> : <CheckCircle className="mr-2 h-4 w-4" />}
        Aprobar
      </Button>
      <Button onClick={handleReject} disabled={isApproving || isRejecting} variant="destructive">
        {isRejecting ? <Spinner className="mr-2 h-4 w-4" /> : <XCircle className="mr-2 h-4 w-4" />}
        Rechazar
      </Button>
    </div>
  )
}
