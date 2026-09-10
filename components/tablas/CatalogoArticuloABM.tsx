"use client"

// ABM genérico para los catálogos de artículo (tipos_bulto / tipos_fraccion).
// Cada fila muestra cuántos artículos la usan; renombrar propaga a los artículos
// por FK ON UPDATE CASCADE, y borrar está bloqueado mientras haya artículos que
// la usen (ON DELETE RESTRICT) — en ese caso se ofrece desactivar.

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Trash2, Plus, Pencil, Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"
import type { TipoCatalogo } from "@/lib/catalogos/tipos-articulo"

interface Props {
  tabla: "tipos_bulto" | "tipos_fraccion"
  /** Columna de articulos que referencia a `nombre` */
  columnaArticulo: "unidad_de_medida" | "tipo_fraccion"
  titulo: string
  subtitulo: string
  singular: string   // "tipo de bulto" / "tipo de fracción"
  placeholderNombre: string
}

export function CatalogoArticuloABM({ tabla, columnaArticulo, titulo, subtitulo, singular, placeholderNombre }: Props) {
  const [items, setItems] = useState<TipoCatalogo[]>([])
  const [usos, setUsos] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TipoCatalogo | null>(null)
  const [nombre, setNombre] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const [orden, setOrden] = useState("0")
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data, error } = await supabase.from(tabla).select("*").order("orden").order("nombre")
    if (error) { toast.error(`No se pudo cargar ${tabla}: ${error.message}`); setLoading(false); return }
    const lista = (data || []) as TipoCatalogo[]
    setItems(lista)
    // Cantidad de artículos que usan cada valor
    const counts = await Promise.all(lista.map(async t => {
      const { count } = await supabase.from("articulos").select("id", { count: "exact", head: true }).eq(columnaArticulo, t.nombre)
      return [t.nombre, count || 0] as const
    }))
    setUsos(Object.fromEntries(counts))
    setLoading(false)
  }

  const save = async () => {
    const nom = nombre.trim().toUpperCase()
    if (!nom) return
    setSaving(true)
    const payload = { nombre: nom, descripcion: descripcion.trim() || null, orden: parseInt(orden) || 0 }
    const { error } = editing
      ? await supabase.from(tabla).update(payload).eq("id", editing.id)
      : await supabase.from(tabla).insert(payload)
    setSaving(false)
    if (error) {
      toast.error(error.code === "23505" ? `Ya existe un ${singular} "${nom}"` : `Error: ${error.message}`)
      return
    }
    if (editing && editing.nombre !== nom && (usos[editing.nombre] || 0) > 0) {
      toast.success(`Renombrado. ${usos[editing.nombre]} artículos pasaron de ${editing.nombre} a ${nom}.`)
    } else {
      toast.success(editing ? "Actualizado" : "Creado")
    }
    setDialogOpen(false); setEditing(null)
    load()
  }

  const toggleActivo = async (item: TipoCatalogo) => {
    const { error } = await supabase.from(tabla).update({ activo: !item.activo }).eq("id", item.id)
    if (error) { toast.error(`Error: ${error.message}`); return }
    load()
  }

  const remove = async (item: TipoCatalogo) => {
    const n = usos[item.nombre] || 0
    if (n > 0) {
      toast.error(`No se puede eliminar: ${n} artículos usan "${item.nombre}". Renombralo o desactivalo.`)
      return
    }
    if (!confirm(`¿Eliminar el ${singular} "${item.nombre}"?`)) return
    const { error } = await supabase.from(tabla).delete().eq("id", item.id)
    if (error) { toast.error(`Error: ${error.message}`); return }
    load()
  }

  const openEdit = (item: TipoCatalogo) => {
    setEditing(item); setNombre(item.nombre); setDescripcion(item.descripcion || ""); setOrden(String(item.orden ?? 0)); setDialogOpen(true)
  }
  const openNew = () => {
    setEditing(null); setNombre(""); setDescripcion(""); setOrden(String((items.length + 1) * 10)); setDialogOpen(true)
  }

  const nuevoNombre = nombre.trim().toUpperCase()
  const avisoRename = editing && editing.nombre !== nuevoNombre && (usos[editing.nombre] || 0) > 0

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{titulo}</h1>
          <p className="text-sm text-muted-foreground">{subtitulo}</p>
        </div>
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo</Button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">Orden</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-[90px] text-right">Artículos</TableHead>
              <TableHead className="w-[80px]">Estado</TableHead>
              <TableHead className="w-[130px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Cargando...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No hay {singular}s cargados</TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item.id} className={!item.activo ? "opacity-50" : ""}>
                <TableCell className="text-muted-foreground text-sm">{item.orden}</TableCell>
                <TableCell className="font-medium font-mono">{item.nombre}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{item.descripcion || "—"}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{usos[item.nombre] ?? "…"}</TableCell>
                <TableCell>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${item.activo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {item.activo ? "Activo" : "Inactivo"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" title={item.activo ? "Desactivar (deja de aparecer en los selects)" : "Activar"} onClick={() => toggleActivo(item)}>
                      {item.activo ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" title="Eliminar" onClick={() => remove(item)} className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Renombrar un {singular} actualiza automáticamente todos los artículos que lo usan. Un {singular} en uso no se puede eliminar: desactivalo para que deje de ofrecerse en las fichas.
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar" : "Nuevo"} {singular}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Nombre *</Label>
              <Input value={nombre} onChange={e => setNombre(e.target.value.toUpperCase())} placeholder={placeholderNombre} className="font-mono uppercase" />
              {avisoRename && (
                <p className="text-xs text-amber-600 mt-1">Se actualizarán {usos[editing!.nombre]} artículos de {editing!.nombre} a {nuevoNombre || "…"}.</p>
              )}
            </div>
            <div>
              <Label>Descripción</Label>
              <Input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <Label>Orden</Label>
              <Input type="number" value={orden} onChange={e => setOrden(e.target.value)} className="w-32" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving || !nombre.trim()}>{editing ? "Actualizar" : "Crear"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
