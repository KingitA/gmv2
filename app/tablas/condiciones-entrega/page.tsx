"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Trash2, Plus, Pencil } from "lucide-react"

export default function CondicionesEntregaPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [nombre, setNombre] = useState("")
  const [codigo, setCodigo] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const supabase = createClient()

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data } = await supabase.from("condiciones_entrega").select("*").order("nombre")
    setItems(data || [])
    setLoading(false)
  }

  const save = async () => {
    if (!nombre.trim() || !codigo.trim()) return
    const payload = {
      nombre: nombre.trim(),
      codigo: codigo.trim().toLowerCase().replace(/\s+/g, '_'),
      descripcion: descripcion.trim() || null,
    }
    if (editing) {
      const { error } = await supabase.from("condiciones_entrega").update(payload).eq("id", editing.id)
      if (error) { alert(`Error: ${error.message}`); return }
    } else {
      const { error } = await supabase.from("condiciones_entrega").insert(payload)
      if (error) { alert(`Error: ${error.message}`); return }
    }
    setDialogOpen(false)
    setEditing(null)
    setNombre("")
    setCodigo("")
    setDescripcion("")
    load()
  }

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar esta condición de entrega?")) return
    const { error } = await supabase.from("condiciones_entrega").delete().eq("id", id)
    if (error) { alert(`Error: ${error.message}`); return }
    load()
  }

  const openEdit = (item: any) => {
    setEditing(item)
    setNombre(item.nombre)
    setCodigo(item.codigo)
    setDescripcion(item.descripcion || "")
    setDialogOpen(true)
  }

  const openNew = () => {
    setEditing(null)
    setNombre("")
    setCodigo("")
    setDescripcion("")
    setDialogOpen(true)
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Condiciones de Entrega</h1>
          <p className="text-sm text-muted-foreground">Retira, Transporte, Entregamos nosotros, etc.</p>
        </div>
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1" /> Nueva</Button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Código</TableHead>
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
                <TableCell className="font-mono text-sm text-muted-foreground">{item.codigo}</TableCell>
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
            <DialogTitle>{editing ? "Editar" : "Nueva"} Condición de Entrega</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Nombre *</Label>
              <Input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Retira Sucursal" />
            </div>
            <div>
              <Label>Código *</Label>
              <Input value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Ej: retira_sucursal" />
              <p className="text-xs text-muted-foreground mt-1">Identificador interno, sin espacios</p>
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
