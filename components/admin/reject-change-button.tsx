"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { rejectChange } from "@/lib/actions/admin"
import { X } from "lucide-react"
import { useRouter } from "next/navigation"

export function RejectChangeButton({ solicitudId }: { solicitudId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleReject = async () => {
    setLoading(true)
    try {
      await rejectChange(solicitudId)
      router.refresh()
    } catch (error) {
      console.error("Error rejecting change:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button onClick={handleReject} disabled={loading} variant="destructive" className="flex-1">
      <X className="h-4 w-4 mr-2" />
      {loading ? "Rechazando..." : "Rechazar"}
    </Button>
  )
}
