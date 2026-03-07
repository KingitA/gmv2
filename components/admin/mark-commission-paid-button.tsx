"use client"

import { useState } from "react"
import { marcarComisionPagada } from "@/lib/actions/pagos"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { CheckCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

export function MarkCommissionPaidButton({ comisionId }: { comisionId: string }) {
  const [isProcessing, setIsProcessing] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const handleMarkPaid = async () => {
    setIsProcessing(true)
    try {
      await marcarComisionPagada(comisionId)
      toast({
        title: "Comisión pagada",
        description: "La comisión ha sido marcada como pagada",
      })
      router.refresh()
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo marcar la comisión como pagada",
        variant: "destructive",
      })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Button onClick={handleMarkPaid} disabled={isProcessing} className="bg-green-600 hover:bg-green-700">
      {isProcessing ? <Spinner className="mr-2 h-4 w-4" /> : <CheckCircle className="mr-2 h-4 w-4" />}
      Marcar Pagada
    </Button>
  )
}
