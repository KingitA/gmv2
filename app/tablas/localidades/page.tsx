"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Plus, Pencil, Trash2, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { getSupabase } from "@/lib/supabase"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Localidad {
  id: string
  nombre: string
  provincia: string
  zona_id: string | null
  codigo_postal: string | null
  zonas?: { nombre: string }
}

interface Zona {
  id: string
  nombre: string
}

export default function LocalidadesPage() {
  const [localidades, setLocalidades] = useState<Localidad[]>([])
  const [zonas, setZonas] = useState<Zona[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingLocalidad, setEditingLocalidad] = useState<Localidad | null>(null)
  const [formData, setFormData] = useState({
    nombre: "",
    provincia: "",
    zona_id: "default", // Updated default value to be a non-empty string
    codigo_postal: "",
  })

  useEffect(() => {
    loadLocalidades()
    loadZonas()
  }, [])

  async function loadLocalidades() {
    const supabase = getSupabase()
    const { data, error } = await supabase.from("localidades").select("*, zonas(nombre)").order("provincia, nombre")

    if (error) {
      console.error("[v0] Error loading localidades:", error)
      return
    }

    setLocalidades(data || [])
  }

  async function loadZonas() {
    const supabase = getSupabase()
    const { data, error } = await supabase.from("zonas").select("id, nombre").order("nombre")

    if (error) {
      console.error("[v0] Error loading zonas:", error)
      return
    }

    setZonas(data || [])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = getSupabase()

    const dataToSave = {
      ...formData,
      zona_id: formData.zona_id === "default" ? null : formData.zona_id, // Handle default value
    }

    if (editingLocalidad) {
      const { error } = await supabase.from("localidades").update(dataToSave).eq("id", editingLocalidad.id)

      if (error) {
        alert(`Error al actualizar: ${error.message}`)
        return
      }
    } else {
      const { error } = await supabase.from("localidades").insert([dataToSave])

      if (error) {
        alert(`Error al crear: ${error.message}`)
        return
      }
    }

    setIsDialogOpen(false)
    resetForm()
    loadLocalidades()
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta localidad?")) return

    const supabase = getSupabase()
    const { error } = await supabase.from("localidades").delete().eq("id", id)

    if (error) {
      alert(`Error al eliminar: ${error.message}`)
      return
    }

    loadLocalidades()
  }

  function resetForm() {
    setFormData({
      nombre: "",
      provincia: "",
      zona_id: "default", // Reset to default value
      codigo_postal: "",
    })
    setEditingLocalidad(null)
  }

  function openEditDialog(localidad: Localidad) {
    setEditingLocalidad(localidad)
    setFormData({
      nombre: localidad.nombre,
      provincia: localidad.provincia,
      zona_id: localidad.zona_id || "default", // Use default value if zona_id is null
      codigo_postal: localidad.codigo_postal || "",
    })
    setIsDialogOpen(true)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/tablas">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Localidades</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lista de Localidades</CardTitle>
            <Dialog
              open={isDialogOpen}
              onOpenChange={(open) => {
                setIsDialogOpen(open)
                if (!open) resetForm()
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nueva Localidad
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingLocalidad ? "Editar Localidad" : "Nueva Localidad"}</DialogTitle>
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
                    <Label htmlFor="provincia">Provincia *</Label>
                    <Input
                      id="provincia"
                      value={formData.provincia}
                      onChange={(e) => setFormData({ ...formData, provincia: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="codigo_postal">Código Postal</Label>
                    <Input
                      id="codigo_postal"
                      value={formData.codigo_postal}
                      onChange={(e) => setFormData({ ...formData, codigo_postal: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="zona_id">Zona</Label>
                    <Select
                      value={formData.zona_id}
                      onValueChange={(value) => setFormData({ ...formData, zona_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar zona" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Sin zona</SelectItem> {/* Updated value prop */}
                        {zonas.map((zona) => (
                          <SelectItem key={zona.id} value={zona.id}>
                            {zona.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit">{editingLocalidad ? "Actualizar" : "Crear"}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Provincia</TableHead>
                  <TableHead>Código Postal</TableHead>
                  <TableHead>Zona</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localidades.map((localidad) => (
                  <TableRow key={localidad.id}>
                    <TableCell className="font-medium">{localidad.nombre}</TableCell>
                    <TableCell>{localidad.provincia}</TableCell>
                    <TableCell>{localidad.codigo_postal || "-"}</TableCell>
                    <TableCell>{localidad.zonas?.nombre || "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(localidad)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(localidad.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}


