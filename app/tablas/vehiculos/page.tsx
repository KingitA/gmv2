"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Plus, Pencil } from "lucide-react"

export default function VehiculosPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [nombre, setNombre] = useState("")
  const [patente, setPatente] = useState("")
  const supabase = createClient()

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data } = await supabase.from("vehiculos").select("*").order("nombre")
    setItems(data || [])
    setLoading(false)
  }

  const save = async () => {
    if (!nombre.trim()) return
    const payload = {
      nombre: nombre.trim().toUpperCase(),
      patente: patente.trim().toUpperCase().replace(/\s+/g, "") || null,
    }
    const { error } = editing
      ? await supabase.from("vehiculos").update(payload).eq("id", editing.id)
      : await supabase.from("vehiculos").insert(payload)
    if (error) {
      alert(error.code === "23505" ? "Ya hay un vehículo con esa patente" : `Error: ${error.message}`)
      return
    }
    setDialogOpen(false)
    load()
  }

  // Los vehículos no se borran (quedan en el historial de viajes): se desactivan
  const toggleActivo = async (item: any) => {
    const { error } = await supabase.from("vehiculos").update({ activo: !item.activo }).eq("id", item.id)
    if (error) { alert(`Error: ${error.message}`); return }
    load()
  }

  const open = (item: any | null) => {
    setEditing(item)
    setNombre(item?.nombre || "")
    setPatente(item?.patente || "")
    setDialogOpen(true)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vehículos</h1>
          <p className="text-muted-foreground">Camiones y utilitarios propios para los viajes de reparto</p>
        </div>
        <Button onClick={() => open(null)}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo vehículo
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Patente</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-40" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
          ) : items.length === 0 ? (
            <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Todavía no hay vehículos</TableCell></TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.id} className={item.activo ? "" : "opacity-50"}>
                <TableCell className="font-medium">{item.nombre}</TableCell>
                <TableCell>{item.patente || "—"}</TableCell>
                <TableCell>
                  <Badge variant={item.activo ? "default" : "secondary"}>{item.activo ? "Activo" : "Inactivo"}</Badge>
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="ghost" size="sm" onClick={() => open(item)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => toggleActivo(item)}>
                    {item.activo ? "Desactivar" : "Activar"}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar vehículo" : "Nuevo vehículo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nombre *</Label>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: BOXER" autoFocus />
            </div>
            <div>
              <Label>Patente</Label>
              <Input value={patente} onChange={(e) => setPatente(e.target.value)} placeholder="Ej: AB123CD" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={!nombre.trim()}>Guardar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
