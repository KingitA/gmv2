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
import { Plus, Pencil, Trash2, ArrowLeft } from "lucide-react"
import Link from "next/link"

type Vendedor = {
  id: string
  nombre: string
  email: string | null
  emails_alternativos: string | null
  telefono: string | null
  comision_bazar_limpieza: number
  comision_perfumeria: number
  activo: boolean
}

export default function ViajantesPage() {
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editando, setEditando] = useState<Vendedor | null>(null)
  const [formData, setFormData] = useState({
    nombre: "",
    email: "",
    telefono: "",
    comision_bazar_limpieza: "6.00",
    comision_perfumeria: "3.00",
  })

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  useEffect(() => {
    loadVendedores()
  }, [])

  const loadVendedores = async () => {
    const { data, error } = await supabase.from("vendedores").select("*").order("nombre")

    if (error) {
      console.error("[v0] Error loading vendedores:", error)
      return
    }

    setVendedores(data || [])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const vendedorData = {
      nombre: formData.nombre,
      email: null as string | null,
      emails_alternativos: null as string | null,
      telefono: formData.telefono || null,
      comision_bazar_limpieza: Number.parseFloat(formData.comision_bazar_limpieza),
      comision_perfumeria: Number.parseFloat(formData.comision_perfumeria),
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
      comision_bazar_limpieza: vendedor.comision_bazar_limpieza.toString(),
      comision_perfumeria: vendedor.comision_perfumeria.toString(),
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
      comision_bazar_limpieza: "6.00",
      comision_perfumeria: "3.00",
    })
  }

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
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="comision_bazar">Comisión Bazar/Limpieza (%)</Label>
                      <Input
                        id="comision_bazar"
                        type="number"
                        step="0.01"
                        value={formData.comision_bazar_limpieza}
                        onChange={(e) => setFormData({ ...formData, comision_bazar_limpieza: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="comision_perfumeria">Comisión Perfumería (%)</Label>
                      <Input
                        id="comision_perfumeria"
                        type="number"
                        step="0.01"
                        value={formData.comision_perfumeria}
                        onChange={(e) => setFormData({ ...formData, comision_perfumeria: e.target.value })}
                        required
                      />
                    </div>
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
                  <TableHead>Com. Bazar/Limpieza</TableHead>
                  <TableHead>Com. Perfumería</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendedores.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No hay viajantes registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  vendedores.map((vendedor) => (
                    <TableRow key={vendedor.id}>
                      <TableCell className="font-medium">{vendedor.nombre}</TableCell>
                      <TableCell>{[vendedor.email, vendedor.emails_alternativos].filter(Boolean).join(' ') || "-"}</TableCell>
                      <TableCell>{vendedor.telefono || "-"}</TableCell>
                      <TableCell>{vendedor.comision_bazar_limpieza}%</TableCell>
                      <TableCell>{vendedor.comision_perfumeria}%</TableCell>
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
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}


