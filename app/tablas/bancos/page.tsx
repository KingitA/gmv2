"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Plus, Pencil, Trash2, Building2 } from "lucide-react"
import { toast } from "sonner"

interface Banco {
  id: string
  banco: string
  nombre: string
  alias: string | null
  cbu: string | null
  cvu: string | null
  cuenta: string | null
  activo: boolean
}

const emptyForm = { banco: "", nombre: "", alias: "", cbu: "", cvu: "", cuenta: "" }

export default function BancosPage() {
  const [bancos, setBancos] = useState<Banco[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editando, setEditando] = useState<Banco | null>(null)
  const [formData, setFormData] = useState(emptyForm)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    const res = await fetch("/api/tablas/bancos")
    const data = await res.json()
    setBancos(data || [])
  }

  const openNew = () => {
    setEditando(null)
    setFormData(emptyForm)
    setDialogOpen(true)
  }

  const openEdit = (b: Banco) => {
    setEditando(b)
    setFormData({ banco: b.banco, nombre: b.nombre, alias: b.alias || "", cbu: b.cbu || "", cvu: b.cvu || "", cuenta: b.cuenta || "" })
    setDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setGuardando(true)
    try {
      const method = editando ? "PUT" : "POST"
      const body = editando ? { id: editando.id, ...formData, activo: editando.activo } : formData
      const res = await fetch("/api/tablas/bancos", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(editando ? "Banco actualizado" : "Banco creado")
      setDialogOpen(false)
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setGuardando(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este banco?")) return
    const res = await fetch(`/api/tablas/bancos?id=${id}`, { method: "DELETE" })
    if (res.ok) { toast.success("Banco eliminado"); load() }
    else toast.error("Error eliminando")
  }

  const toggleActivo = async (b: Banco) => {
    await fetch("/api/tablas/bancos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...b, activo: !b.activo }),
    })
    load()
  }

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData((p) => ({ ...p, [k]: e.target.value }))

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" /> Bancos Propios
          </h1>
          <p className="text-sm text-muted-foreground">Cuentas bancarias de la empresa. El CBU/CVU se usa para identificar transferencias y depósitos automáticamente.</p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo banco
        </Button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Banco</TableHead>
              <TableHead>Nombre / Alias</TableHead>
              <TableHead>CBU</TableHead>
              <TableHead>CVU</TableHead>
              <TableHead>Cuenta</TableHead>
              <TableHead className="text-center">Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bancos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No hay bancos cargados. Agregá las cuentas bancarias de la empresa.
                </TableCell>
              </TableRow>
            ) : bancos.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.banco}</TableCell>
                <TableCell>
                  {b.nombre}
                  {b.alias && <span className="text-xs text-muted-foreground ml-2">({b.alias})</span>}
                </TableCell>
                <TableCell className="font-mono text-xs">{b.cbu || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="font-mono text-xs">{b.cvu || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="font-mono text-xs">{b.cuenta || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-center">
                  <button onClick={() => toggleActivo(b)}>
                    <Badge className={b.activo ? "bg-green-100 text-green-700 border-0" : "bg-gray-100 text-gray-500 border-0"}>
                      {b.activo ? "Activo" : "Inactivo"}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(b)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(b.id)} className="text-red-500 hover:text-red-700">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar banco" : "Nuevo banco"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Nombre del banco *</Label>
                <Input placeholder="Ej: Banco Credicoop Cooperativo Ltdo." value={formData.banco} onChange={set("banco")} required />
              </div>
              <div>
                <Label>Nombre corto *</Label>
                <Input placeholder="Ej: Credicoop" value={formData.nombre} onChange={set("nombre")} required />
              </div>
              <div>
                <Label>Alias</Label>
                <Input placeholder="Ej: credicoop.mp" value={formData.alias} onChange={set("alias")} />
              </div>
              <div>
                <Label>CBU (22 dígitos)</Label>
                <Input placeholder="0000000000000000000000" value={formData.cbu} onChange={set("cbu")} maxLength={22} className="font-mono" />
              </div>
              <div>
                <Label>CVU (22 dígitos)</Label>
                <Input placeholder="0000000000000000000000" value={formData.cvu} onChange={set("cvu")} maxLength={22} className="font-mono" />
              </div>
              <div className="col-span-2">
                <Label>Número de cuenta</Label>
                <Input placeholder="Ej: 191-123456/7" value={formData.cuenta} onChange={set("cuenta")} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
