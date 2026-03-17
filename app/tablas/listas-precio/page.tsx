"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Pencil, Plus } from "lucide-react"

interface ListaPrecio {
  id: string
  nombre: string
  codigo: string
  recargo_limpieza_bazar: number
  recargo_perfumeria_negro: number
  recargo_perfumeria_blanco: number
  descripcion: string | null
  activo: boolean
}

export default function ListasPrecioPage() {
  const [items, setItems] = useState<ListaPrecio[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ListaPrecio | null>(null)
  const [form, setForm] = useState({
    nombre: "", codigo: "", descripcion: "",
    recargo_limpieza_bazar: "", recargo_perfumeria_negro: "", recargo_perfumeria_blanco: "",
  })
  const supabase = createClient()

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data } = await supabase.from("listas_precio").select("*").order("nombre")
    setItems(data || [])
    setLoading(false)
  }

  const save = async () => {
    if (!form.nombre.trim() || !form.codigo.trim()) return
    const payload = {
      nombre: form.nombre.trim(),
      codigo: form.codigo.trim().toLowerCase().replace(/\s+/g, "_"),
      recargo_limpieza_bazar: parseFloat(form.recargo_limpieza_bazar) || 0,
      recargo_perfumeria_negro: parseFloat(form.recargo_perfumeria_negro) || 0,
      recargo_perfumeria_blanco: parseFloat(form.recargo_perfumeria_blanco) || 0,
      descripcion: form.descripcion.trim() || null,
    }
    if (editing) {
      const { error } = await supabase.from("listas_precio").update(payload).eq("id", editing.id)
      if (error) { alert(`Error: ${error.message}`); return }
    } else {
      const { error } = await supabase.from("listas_precio").insert(payload)
      if (error) { alert(`Error: ${error.message}`); return }
    }
    setDialogOpen(false)
    load()
  }

  const openEdit = (item: ListaPrecio) => {
    setEditing(item)
    setForm({
      nombre: item.nombre, codigo: item.codigo, descripcion: item.descripcion || "",
      recargo_limpieza_bazar: String(item.recargo_limpieza_bazar),
      recargo_perfumeria_negro: String(item.recargo_perfumeria_negro),
      recargo_perfumeria_blanco: String(item.recargo_perfumeria_blanco),
    })
    setDialogOpen(true)
  }

  const openNew = () => {
    setEditing(null)
    setForm({ nombre: "", codigo: "", descripcion: "", recargo_limpieza_bazar: "0", recargo_perfumeria_negro: "0", recargo_perfumeria_blanco: "0" })
    setDialogOpen(true)
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Listas de Precio</h1>
          <p className="text-sm text-muted-foreground">Bahía, Neco, Viajante — con recargos por categoría</p>
        </div>
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1" /> Nueva Lista</Button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Código</TableHead>
              <TableHead className="text-center">Limpieza/Bazar</TableHead>
              <TableHead className="text-center">Perfumería Negro</TableHead>
              <TableHead className="text-center">Perfumería Blanco</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Cargando...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No hay listas. Ejecutá el SQL de migración.</TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-bold">{item.nombre}</TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">{item.codigo}</TableCell>
                <TableCell className="text-center font-semibold">{item.recargo_limpieza_bazar}%</TableCell>
                <TableCell className="text-center font-semibold">{item.recargo_perfumeria_negro}%</TableCell>
                <TableCell className="text-center font-semibold">{item.recargo_perfumeria_blanco}%</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{item.descripcion || "—"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Ejemplo visual */}
      {items.length > 0 && (
        <div className="mt-6 bg-white border rounded-xl p-5">
          <h3 className="font-bold text-sm mb-3">Ejemplo: Artículo con precio base $100</h3>
          <div className="grid grid-cols-3 gap-4">
            {items.map(lista => (
              <div key={lista.id} className="border rounded-lg p-4 text-center">
                <div className="font-bold text-lg mb-2">{lista.nombre}</div>
                <div className="space-y-1 text-sm">
                  <div>Limpieza: <span className="font-bold">${(100 * (1 + lista.recargo_limpieza_bazar / 100)).toFixed(2)}</span></div>
                  <div>Perf. Negro: <span className="font-bold">${(100 * (1 + lista.recargo_perfumeria_negro / 100)).toFixed(2)}</span></div>
                  <div>Perf. Blanco: <span className="font-bold">${(100 * (1 + lista.recargo_perfumeria_blanco / 100)).toFixed(2)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar" : "Nueva"} Lista de Precio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nombre *</Label>
                <Input value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} placeholder="Ej: Neco" />
              </div>
              <div>
                <Label>Código *</Label>
                <Input value={form.codigo} onChange={e => setForm({...form, codigo: e.target.value})} placeholder="Ej: neco" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>% Limpieza/Bazar</Label>
                <Input type="number" step="0.01" value={form.recargo_limpieza_bazar} onChange={e => setForm({...form, recargo_limpieza_bazar: e.target.value})} />
              </div>
              <div>
                <Label>% Perf. Negro</Label>
                <Input type="number" step="0.01" value={form.recargo_perfumeria_negro} onChange={e => setForm({...form, recargo_perfumeria_negro: e.target.value})} />
              </div>
              <div>
                <Label>% Perf. Blanco</Label>
                <Input type="number" step="0.01" value={form.recargo_perfumeria_blanco} onChange={e => setForm({...form, recargo_perfumeria_blanco: e.target.value})} />
              </div>
            </div>
            <div>
              <Label>Descripción</Label>
              <Input value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})} placeholder="Opcional" />
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
