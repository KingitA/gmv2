import { getAllUsers } from "@/lib/actions/admin"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { UpdateUserRoleButton } from "@/components/admin/update-user-role-button"
import { Mail, User } from "lucide-react"

// Force dynamic rendering to avoid build-time prerendering
export const dynamic = "force-dynamic"

export default async function AdminUsuariosPage() {
  const users = await getAllUsers()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Gestión de Usuarios</h1>
              <p className="text-muted-foreground mt-1">Administrar usuarios, roles y permisos</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/admin">Volver al Panel</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {users.map((user: any) => (
            <Card key={user.id} className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{user.nombre}</h3>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                      <Mail className="h-3 w-3" />
                      {user.email}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Rol:</span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${user.rol === "admin"
                        ? "bg-purple-100 text-purple-700"
                        : user.rol === "viajante"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-green-100 text-green-700"
                      }`}
                  >
                    {user.rol}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Creado:</span>
                  <span>{new Date(user.created_at).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}</span>
                </div>

                <UpdateUserRoleButton userId={user.id} currentRole={user.rol} />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
