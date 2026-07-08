"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { createBrowserClient } from "@supabase/ssr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus, Pencil, Trash2, ArrowLeft, UserCheck } from "lucide-react"
import Link from "next/link"

type Vendedor = {
  id: string
  nombre: string
  email: string | null
  emails_alternativos: string | null
  telefono: string | null
  comision_limpieza_bazar: number | null
  comision_perfumeria_0: number | null
  comision_perfumeria_plus: number | null
  usuario_id: string | null
  activo: boolean
}

type UsuarioOpcion = {
  id: string
  nombre: string
  email: string
  esVendedor: boolean
}

export default function ViajantesPage() {
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [usuarios, setUsuarios] = useState<UsuarioOpcion[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editando, setEditando] = useState<Vendedor | null>(null)
  const [formData, setFormData] = useState({
    nombre: "",
    email: "",
    telefono: "",
    comision_limpieza_bazar: "6.00",
    comision_perfumeria_0: "3.00",
    comision_perfumeria_plus: "3.00",
    usuario_id: "",
  })

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  useEffect(() => {
    loadVendedores()
    loadUsuarios()
  }, [])

  const loadVendedores = async () => {
    const { data, error } = await supabase.from("vendedores").select("*").order("nombre")

    if (error) {
      console.error("[v0] Error loading vendedores:", error)
      return
    }

    setVendedores(data || [])
  }

  const loadUsuarios = async () => {
    const [{ data: users, error }, { data: rolesData }] = await Promise.all([
      supabase.from("usuarios").select("id, nombre, email").eq("estado", "activo").order("nombre"),
      supabase.from("usuarios_roles").select("usuario_id, roles(nombre)"),
    ])

    if (error) {
      console.error("[v0] Error loading usuarios:", error)
      return
    }

    const conRolVendedor = new Set(
      (rolesData || []).filter((r: any) => r.roles?.nombre === "vendedor").map((r: any) => r.usuario_id),
    )
    setUsuarios(
      (users || []).map((u: any) => ({
        id: u.id,
        nombre: u.nombre,
        email: u.email,
        esVendedor: conRolVendedor.has(u.id),
      })),
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const vendedorData = {
      nombre: formData.nombre,
      email: null as string | null,
      emails_alternativos: null as string | null,
      telefono: formData.telefono || null,
      comision_limpieza_bazar: Number.parseFloat(formData.comision_limpieza_bazar) || 0,
      comision_perfumeria_0: Number.parseFloat(formData.comision_perfumeria_0) || 0,
      comision_perfumeria_plus: Number.parseFloat(formData.comision_perfumeria_plus) || 0,
      usuario_id: formData.usuario_id || null,
      activo: true,
    }

    // Split email field: first email = primary, rest = alternativos
    const emailParts = formData.email.trim().split(/\s+/).filter(Boolean)
    if (emailParts.length > 0) {
      vendedorData.email = emailParts[0]
      if (emailParts.length > 1) {
        vendedorData.emails_alternativos = emailParts.slice(1).join(' ')
      }
    }

    if (editando) {
      const { error } = await supabase.from("vendedores").update(vendedorData).eq("id", editando.id)

      if (error) {
        alert(`Error al actualizar: ${error.message}`)
        return
      }
    } else {
      const { error } = await supabase.from("vendedores").insert([vendedorData])

      if (error) {
        alert(`Error al crear: ${error.message}`)
        return
      }
    }

    setDialogOpen(false)
    resetForm()
    loadVendedores()
  }

  const handleEdit = (vendedor: Vendedor) => {
    setEditando(vendedor)
    // Combine primary + alternative emails into one field for display
    const allEmails = [vendedor.email, vendedor.emails_alternativos].filter(Boolean).join(' ')
    setFormData({
      nombre: vendedor.nombre,
      email: allEmails,
      telefono: vendedor.telefono || "",
      comision_limpieza_bazar: (vendedor.comision_limpieza_bazar ?? 0).toString(),
      comision_perfumeria_0: (vendedor.comision_perfumeria_0 ?? 0).toString(),
      comision_perfumeria_plus: (vendedor.comision_perfumeria_plus ?? 0).toString(),
      usuario_id: vendedor.usuario_id || "",
    })
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este viajante?")) return

    const { error } = await supabase.from("vendedores").delete().eq("id", id)

    if (error) {
      alert(`Error al eliminar: ${error.message}`)
      return
    }

    loadVendedores()
  }

  const resetForm = () => {
    setEditando(null)
    setFormData({
      nombre: "",
      email: "",
      telefono: "",
      comision_limpieza_bazar: "6.00",
      comision_perfumeria_0: "3.00",
      comision_perfumeria_plus: "3.00",
      usuario_id: "",
    })
  }

  const usuarioDe = (usuarioId: string | null) => usuarios.find((u) => u.id === usuarioId) || null

  const fmtPct = (n: number | null) => `${Number(n ?? 0)}%`

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/tablas">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <h1 className="text-2xl font-bold">Viajantes</h1>
            </div>
            <Dialog
              open={dialogOpen}
              onOpenChange={(open) => {
                setDialogOpen(open)
                if (!open) resetForm()
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nuevo Viajante
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editando ? "Editar Viajante" : "Nuevo Viajante"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="nombre">Nombre *</Label>
                    <Input
                      id="nombre"
                      value={formData.nombre}
                      onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email(s)</Label>
                    <Input
                      id="email"
                      type="text"
                      placeholder="principal@mail.com alternativo@mail.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Separar múltiples emails con espacio</p>
                  </div>
                  <div>
                    <Label htmlFor="telefono">Teléfono</Label>
                    <Input
                      id="telefono"
                      value={formData.telefono}
                      onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="comision_lb">Com. Limpieza/Bazar (%)</Label>
                      <Input
                        id="comision_lb"
                        type="number"
                        step="0.01"
                        value={formData.comision_limpieza_bazar}
                        onChange={(e) => setFormData({ ...formData, comision_limpieza_bazar: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="comision_p0">Com. Perfumería negro (%)</Label>
                      <Input
                        id="comision_p0"
                        type="number"
                        step="0.01"
                        value={formData.comision_perfumeria_0}
                        onChange={(e) => setFormData({ ...formData, comision_perfumeria_0: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="comision_pp">Com. Perfumería c/factura (%)</Label>
                      <Input
                        id="comision_pp"
                        type="number"
                        step="0.01"
                        value={formData.comision_perfumeria_plus}
                        onChange={(e) => setFormData({ ...formData, comision_perfumeria_plus: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="usuario">Usuario vinculado (app vendedor)</Label>
                    <select
                      id="usuario"
                      value={formData.usuario_id}
                      onChange={(e) => setFormData({ ...formData, usuario_id: e.target.value })}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Sin usuario</option>
                      {usuarios.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre} ({u.email}){u.esVendedor ? "" : " — sin rol vendedor"}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Con qué cuenta ingresa este viajante al módulo vendedor. Un mismo usuario puede estar en
                      varios viajantes (ve la unión de sus carteras). Si dice “sin rol vendedor”, asignale el rol
                      desde Usuarios del Sistema.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit">Guardar</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Lista de Viajantes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Com. Limp/Bazar</TableHead>
                  <TableHead>Com. Perf. negro</TableHead>
                  <TableHead>Com. Perf. c/fact</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendedores.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No hay viajantes registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  vendedores.map((vendedor) => {
                    const usuario = usuarioDe(vendedor.usuario_id)
                    return (
                      <TableRow key={vendedor.id}>
                        <TableCell className="font-medium">{vendedor.nombre}</TableCell>
                        <TableCell>{[vendedor.email, vendedor.emails_alternativos].filter(Boolean).join(' ') || "-"}</TableCell>
                        <TableCell>{vendedor.telefono || "-"}</TableCell>
                        <TableCell>{fmtPct(vendedor.comision_limpieza_bazar)}</TableCell>
                        <TableCell>{fmtPct(vendedor.comision_perfumeria_0)}</TableCell>
                        <TableCell>{fmtPct(vendedor.comision_perfumeria_plus)}</TableCell>
                        <TableCell>
                          {usuario ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 text-sm">
                              <UserCheck className="h-3.5 w-3.5" />
                              {usuario.nombre}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">Sin usuario</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(vendedor)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(vendedor.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
