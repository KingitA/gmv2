export const dynamic = 'force-dynamic'
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

type Transporte = {
  id: string
  nombre: string
  cuit: string | null
  telefono: string | null
  email: string | null
  porcentaje_flete: number
  activo: boolean
}

export default function TransportesPage() {
  const [transportes, setTransportes] = useState<Transporte[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editando, setEditando] = useState<Transporte | null>(null)
  const [formData, setFormData] = useState({
    nombre: "",
    cuit: "",
    telefono: "",
    email: "",
    porcentaje_flete: "",
  })

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  useEffect(() => {
    loadTransportes()
  }, [])

  const loadTransportes = async () => {
    const { data, error } = await supabase.from("transportes").select("*").order("nombre")

    if (error) {
      console.error("[v0] Error loading transportes:", error)
      return
    }

    setTransportes(data || [])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const transporteData = {
      nombre: formData.nombre,
      cuit: formData.cuit || null,
      telefono: formData.telefono || null,
      email: formData.email || null,
      porcentaje_flete: Number.parseFloat(formData.porcentaje_flete),
      activo: true,
    }

    if (editando) {
      const { error } = await supabase.from("transportes").update(transporteData).eq("id", editando.id)

      if (error) {
        alert(`Error al actualizar: ${error.message}`)
        return
      }
    } else {
      const { error } = await supabase.from("transportes").insert([transporteData])

      if (error) {
        alert(`Error al crear: ${error.message}`)
        return
      }
    }

    setDialogOpen(false)
    resetForm()
    loadTransportes()
  }

  const handleEdit = (transporte: Transporte) => {
    setEditando(transporte)
    setFormData({
      nombre: transporte.nombre,
      cuit: transporte.cuit || "",
      telefono: transporte.telefono || "",
      email: transporte.email || "",
      porcentaje_flete: transporte.porcentaje_flete.toString(),
    })
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este transporte?")) return

    const { error } = await supabase.from("transportes").delete().eq("id", id)

    if (error) {
      alert(`Error al eliminar: ${error.message}`)
      return
    }

    loadTransportes()
  }

  const resetForm = () => {
    setEditando(null)
    setFormData({
      nombre: "",
      cuit: "",
      telefono: "",
      email: "",
      porcentaje_flete: "",
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
              <h1 className="text-2xl font-bold">Transportes</h1>
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
                  Nuevo Transporte
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editando ? "Editar Transporte" : "Nuevo Transporte"}</DialogTitle>
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
                    <Label htmlFor="cuit">CUIT</Label>
                    <Input
                      id="cuit"
                      value={formData.cuit}
                      onChange={(e) => setFormData({ ...formData, cuit: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="telefono">Teléfono</Label>
                    <Input
                      id="telefono"
                      value={formData.telefono}
                      onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="porcentaje_flete">Porcentaje Flete (%) *</Label>
                    <Input
                      id="porcentaje_flete"
                      type="number"
                      step="0.01"
                      value={formData.porcentaje_flete}
                      onChange={(e) => setFormData({ ...formData, porcentaje_flete: e.target.value })}
                      required
                    />
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
            <CardTitle>Lista de Transportes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>CUIT</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>% Flete</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transportes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No hay transportes registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  transportes.map((transporte) => (
                    <TableRow key={transporte.id}>
                      <TableCell className="font-medium">{transporte.nombre}</TableCell>
                      <TableCell>{transporte.cuit || "-"}</TableCell>
                      <TableCell>{transporte.telefono || "-"}</TableCell>
                      <TableCell>{transporte.email || "-"}</TableCell>
                      <TableCell>{transporte.porcentaje_flete}%</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(transporte)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(transporte.id)}>
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

