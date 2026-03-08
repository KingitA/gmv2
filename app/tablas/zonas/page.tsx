"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Pencil, Trash2, ArrowLeft, Truck, Package } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"

interface Zona {
  id: string
  nombre: string
  descripcion: string | null
  tipo_flete: string
  porcentaje_flete: number
  dias_visita: string | null
  transporte_id: string | null
  transportes?: {
    nombre: string
    porcentaje_flete: number
  }
}

interface Transporte {
  id: string
  nombre: string
  porcentaje_flete: number
}

export default function ZonasPage() {
  const [zonas, setZonas] = useState<Zona[]>([])
  const [transportes, setTransportes] = useState<Transporte[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingZona, setEditingZona] = useState<Zona | null>(null)
  const [formData, setFormData] = useState({
    nombre: "",
    descripcion: "",
    tipo_flete: "propio",
    porcentaje_flete: 0,
    dias_visita: "",
    transporte_id: "",
  })

  useEffect(() => {
    loadZonas()
    loadTransportes()
  }, [])

  async function loadTransportes() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("transportes")
      .select("id, nombre, porcentaje_flete")
      .eq("activo", true)
      .order("nombre")

    if (error) {
      console.error("[v0] Error loading transportes:", error)
      return
    }

    setTransportes(data || [])
  }

  async function loadZonas() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("zonas")
      .select(`
        *,
        transportes (
          nombre,
          porcentaje_flete
        )
      `)
      .order("nombre")

    if (error) {
      console.error("[v0] Error loading zonas:", error)
      return
    }

    setZonas(data || [])
  }

  function handleTransporteChange(transporteId: string) {
    const transporte = transportes.find((t) => t.id === transporteId)
    if (transporte) {
      setFormData({
        ...formData,
        transporte_id: transporteId,
        porcentaje_flete: transporte.porcentaje_flete,
      })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()

    if (formData.tipo_flete === "transporte" && !formData.transporte_id) {
      alert("Debe seleccionar un transporte")
      return
    }

    const dataToSave = {
      ...formData,
      transporte_id: formData.tipo_flete === "transporte" ? formData.transporte_id : null,
    }

    if (editingZona) {
      const { error } = await supabase.from("zonas").update(dataToSave).eq("id", editingZona.id)

      if (error) {
        alert(`Error al actualizar: ${error.message}`)
        return
      }
    } else {
      const { error } = await supabase.from("zonas").insert([dataToSave])

      if (error) {
        alert(`Error al crear: ${error.message}`)
        return
      }
    }

    setIsDialogOpen(false)
    resetForm()
    loadZonas()
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta zona?")) return

    const supabase = createClient()
    const { error } = await supabase.from("zonas").delete().eq("id", id)

    if (error) {
      alert(`Error al eliminar: ${error.message}`)
      return
    }

    loadZonas()
  }

  function resetForm() {
    setFormData({
      nombre: "",
      descripcion: "",
      tipo_flete: "propio",
      porcentaje_flete: 0,
      dias_visita: "",
      transporte_id: "",
    })
    setEditingZona(null)
  }

  function openEditDialog(zona: Zona) {
    setEditingZona(zona)
    setFormData({
      nombre: zona.nombre,
      descripcion: zona.descripcion || "",
      tipo_flete: zona.tipo_flete || "propio",
      porcentaje_flete: zona.porcentaje_flete || 0,
      dias_visita: zona.dias_visita || "",
      transporte_id: zona.transporte_id || "",
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
          <h1 className="text-2xl font-bold">Zonas</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lista de Zonas</CardTitle>
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
                  Nueva Zona
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{editingZona ? "Editar Zona" : "Nueva Zona"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
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
                      <Label htmlFor="dias_visita">Días de Visita</Label>
                      <Input
                        id="dias_visita"
                        value={formData.dias_visita}
                        onChange={(e) => setFormData({ ...formData, dias_visita: e.target.value })}
                        placeholder="Ej: Lunes, Miércoles"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="descripcion">Descripción</Label>
                    <Textarea
                      id="descripcion"
                      value={formData.descripcion}
                      onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                      placeholder="Ej: Incluye Bahía Blanca, Cerri, White"
                    />
                  </div>

                  <div className="border-t pt-4 space-y-4">
                    <h3 className="font-semibold">Configuración de Flete de Venta</h3>

                    <div>
                      <Label htmlFor="tipo_flete">Tipo de Flete *</Label>
                      <Select
                        value={formData.tipo_flete}
                        onValueChange={(value) =>
                          setFormData({ ...formData, tipo_flete: value, transporte_id: "", porcentaje_flete: 0 })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="propio">
                            <div className="flex items-center gap-2">
                              <Package className="h-4 w-4" />
                              Flete Propio
                            </div>
                          </SelectItem>
                          <SelectItem value="transporte">
                            <div className="flex items-center gap-2">
                              <Truck className="h-4 w-4" />
                              Transporte Externo
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-sm text-muted-foreground mt-1">
                        {formData.tipo_flete === "propio"
                          ? "Ingresá el porcentaje de flete manualmente"
                          : "El porcentaje se toma automáticamente del transporte seleccionado"}
                      </p>
                    </div>

                    {formData.tipo_flete === "transporte" && (
                      <div>
                        <Label htmlFor="transporte_id">Transporte *</Label>
                        <Select value={formData.transporte_id} onValueChange={handleTransporteChange}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar transporte..." />
                          </SelectTrigger>
                          <SelectContent>
                            {transportes.map((transporte) => (
                              <SelectItem key={transporte.id} value={transporte.id}>
                                {transporte.nombre} - {transporte.porcentaje_flete}%
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="porcentaje_flete">% Flete de Venta *</Label>
                      <Input
                        id="porcentaje_flete"
                        type="number"
                        step="0.01"
                        value={formData.porcentaje_flete}
                        onChange={(e) =>
                          setFormData({ ...formData, porcentaje_flete: Number.parseFloat(e.target.value) || 0 })
                        }
                        disabled={formData.tipo_flete === "transporte"}
                        required
                      />
                      <p className="text-sm text-muted-foreground mt-1">
                        Este porcentaje se aplicará al precio base para calcular el flete de venta
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit">{editingZona ? "Actualizar" : "Crear"}</Button>
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
                  <TableHead>Descripción</TableHead>
                  <TableHead>Tipo Flete</TableHead>
                  <TableHead>Transporte</TableHead>
                  <TableHead>% Flete</TableHead>
                  <TableHead>Días Visita</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zonas.map((zona) => (
                  <TableRow key={zona.id}>
                    <TableCell className="font-medium">{zona.nombre}</TableCell>
                    <TableCell>{zona.descripcion || "-"}</TableCell>
                    <TableCell>
                      {zona.tipo_flete === "transporte" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Truck className="h-3 w-3" />
                          Transporte
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Package className="h-3 w-3" />
                          Propio
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{zona.transportes?.nombre || "-"}</TableCell>
                    <TableCell className="font-semibold">{zona.porcentaje_flete}%</TableCell>
                    <TableCell>{zona.dias_visita || "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(zona)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(zona.id)}>
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


