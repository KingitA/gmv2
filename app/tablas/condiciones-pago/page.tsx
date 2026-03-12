"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Trash2, Plus, Pencil } from "lucide-react"

export default function CondicionesPagoPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [nombre, setNombre] = useState("")
  const [diasPlazo, setDiasPlazo] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const supabase = createClient()

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data } = await supabase.from("condiciones_pago").select("*").order("dias_plazo").order("nombre")
    setItems(data || [])
    setLoading(false)
  }

  const save = async () => {
    if (!nombre.trim()) return
    const payload = {
      nombre: nombre.trim(),
      dias_plazo: diasPlazo ? parseInt(diasPlazo) : 0,
      descripcion: descripcion.trim() || null,
    }
    if (editing) {
      const { error } = await supabase.from("condiciones_pago").update(payload).eq("id", editing.id)
      if (error) { alert(`Error: ${error.message}`); return }
    } else {
      const { error } = await supabase.from("condiciones_pago").insert(payload)
      if (error) { alert(`Error: ${error.message}`); return }
    }
    setDialogOpen(false)
    setEditing(null)
    setNombre("")
    setDiasPlazo("")
    setDescripcion("")
    load()
  }

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar esta condición de pago?")) return
    const { error } = await supabase.from("condiciones_pago").delete().eq("id", id)
    if (error) { alert(`Error: ${error.message}`); return }
    load()
  }

  const openEdit = (item: any) => {
    setEditing(item)
    setNombre(item.nombre)
    setDiasPlazo(String(item.dias_plazo || ""))
    setDescripcion(item.descripcion || "")
    setDialogOpen(true)
  }

  const openNew = () => {
    setEditing(null)
    setNombre("")
    setDiasPlazo("")
    setDescripcion("")
    setDialogOpen(true)
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Condiciones de Pago</h1>
          <p className="text-sm text-muted-foreground">Efectivo, Cheque 30 días, Transferencia, etc.</p>
        </div>
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1" /> Nueva</Button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Días Plazo</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-[100px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8">Cargando...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No hay condiciones cargadas</TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.nombre}</TableCell>
                <TableCell>{item.dias_plazo || 0} días</TableCell>
                <TableCell className="text-muted-foreground text-sm">{item.descripcion || "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(item.id)} className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar" : "Nueva"} Condición de Pago</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Nombre *</Label>
              <Input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Cheque 60 días" />
            </div>
            <div>
              <Label>Días de Plazo</Label>
              <Input type="number" value={diasPlazo} onChange={e => setDiasPlazo(e.target.value)} placeholder="0 = contado" />
            </div>
            <div>
              <Label>Descripción</Label>
              <Input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={save}>{editing ? "Actualizar" : "Crear"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
