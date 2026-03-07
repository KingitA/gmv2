"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { updateUserRole } from "@/lib/actions/admin"
import { Shield, UserCheck, Users } from "lucide-react"
import { useRouter } from "next/navigation"

export function UpdateUserRoleButton({
  userId,
  currentRole,
}: {
  userId: string
  currentRole: string
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleRoleChange = async (newRole: string) => {
    setLoading(true)
    try {
      await updateUserRole(userId, newRole)
      router.refresh()
    } catch (error) {
      console.error("Error updating role:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="w-full bg-transparent" disabled={loading}>
          {loading ? "Actualizando..." : "Cambiar Rol"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-full">
        <DropdownMenuItem onClick={() => handleRoleChange("admin")}>
          <Shield className="h-4 w-4 mr-2 text-purple-600" />
          Admin
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleRoleChange("viajante")}>
          <UserCheck className="h-4 w-4 mr-2 text-blue-600" />
          Viajante
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleRoleChange("cliente")}>
          <Users className="h-4 w-4 mr-2 text-green-600" />
          Cliente
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
