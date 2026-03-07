"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { approveChange } from "@/lib/actions/admin"
import { Check } from "lucide-react"
import { useRouter } from "next/navigation"

export function ApproveChangeButton({ solicitudId }: { solicitudId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleApprove = async () => {
    setLoading(true)
    try {
      await approveChange(solicitudId)
      router.refresh()
    } catch (error) {
      console.error("Error approving change:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button onClick={handleApprove} disabled={loading} className="flex-1">
      <Check className="h-4 w-4 mr-2" />
      {loading ? "Aprobando..." : "Aprobar"}
    </Button>
  )
}
