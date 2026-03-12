"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Trash2, Plus, Pencil } from "lucide-react"
import { toast } from "sonner"

interface TipoCanal {
  id: string
  nombre: string
  descripcion: string | null
  activo: boolean
}

export default function TiposCanalPage() {
  const [items, setItems] = useState<TipoCanal[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TipoCanal | null>(null)
  const [nombre, setNombre] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const supabase = createClient()

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data } = await supabase.from("tipos_canal").select("*").order("nombre")
    setItems(data || [])
    setLoading(false)
  }

  const save = async () => {
    if (!nombre.trim()) return
    if (editing) {
      const { error } = await supabase.from("tipos_canal").update({ nombre: nombre.trim(), descripcion: descripcion.trim() || null }).eq("id", editing.id)
      if (error) { alert(`Error: ${error.message}`); return }
    } else {
      const { error } = await supabase.from("tipos_canal").insert({ nombre: nombre.trim(), descripcion: descripcion.trim() || null })
      if (error) { alert(`Error: ${error.message}`); return }
    }
    setDialogOpen(false)
    setEditing(null)
    setNombre("")
    setDescripcion("")
    load()
  }

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar este tipo de canal?")) return
    const { error } = await supabase.from("tipos_canal").delete().eq("id", id)
    if (error) { alert(`Error: ${error.message}`); return }
    load()
  }

  const openEdit = (item: TipoCanal) => {
    setEditing(item)
    setNombre(item.nombre)
    setDescripcion(item.descripcion || "")
    setDialogOpen(true)
  }

  const openNew = () => {
    setEditing(null)
    setNombre("")
    setDescripcion("")
    setDialogOpen(true)
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tipos de Canal</h1>
          <p className="text-sm text-muted-foreground">Mayorista, Minorista, Consumidor Final, etc.</p>
        </div>
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo</Button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-[100px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8">Cargando...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No hay tipos de canal cargados</TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.nombre}</TableCell>
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
            <DialogTitle>{editing ? "Editar" : "Nuevo"} Tipo de Canal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Nombre *</Label>
              <Input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Supermercado" />
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
