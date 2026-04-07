"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Plus, Pencil, Trash2, X, Search } from "lucide-react"

type Transporte = {
  id: string
  nombre: string
  cuit: string | null
  telefono: string | null
  email: string | null
  porcentaje_flete: number
  precio_bulto: number | null
  precio_pallet: number | null
  porcentaje_seguro: number | null
  notas: string | null
  activo: boolean
}

type Localidad = {
  id: string
  nombre: string
  provincia: string | null
}

type DestinoAsignado = {
  id: string          // DB id when editing; temp uuid when creating
  localidad_id: string
  localidad_nombre: string
  localidad_provincia: string | null
  _pending?: boolean  // true = not yet saved to DB
}

export default function TransportesPage() {
  const [transportes, setTransportes] = useState<Transporte[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editando, setEditando] = useState<Transporte | null>(null)
  const [formData, setFormData] = useState({
    nombre: "", cuit: "", telefono: "", email: "",
    porcentaje_flete: "", precio_bulto: "", precio_pallet: "",
    porcentaje_seguro: "", notas: "",
  })

  // Destinos — unificado para create y edit
  const [destinos, setDestinos] = useState<DestinoAsignado[]>([])
  const [busquedaLoc, setBusquedaLoc] = useState("")
  const [locResults, setLocResults] = useState<Localidad[]>([])

  const supabase = createClient()

  useEffect(() => { loadTransportes() }, [])

  const loadTransportes = async () => {
    const { data } = await supabase.from("transportes").select("*").order("nombre")
    setTransportes(data || [])
  }

  const loadDestinos = async (transporteId: string) => {
    const { data } = await supabase
      .from("transportes_destinos")
      .select("id, localidad_id, localidades(nombre, provincia)")
      .eq("transporte_id", transporteId)
      .order("created_at")

    const mapped: DestinoAsignado[] = (data || []).map((d: any) => ({
      id: d.id,
      localidad_id: d.localidad_id,
      localidad_nombre: d.localidades?.nombre || "?",
      localidad_provincia: d.localidades?.provincia || null,
    }))
    setDestinos(mapped)
  }

  const searchLocalidades = async (term: string) => {
    setBusquedaLoc(term)
    if (term.length < 2) { setLocResults([]); return }
    const { data } = await supabase
      .from("localidades")
      .select("id, nombre, provincia")
      .ilike("nombre", `%${term}%`)
      .limit(10)
    const assignedIds = new Set(destinos.map(d => d.localidad_id))
    setLocResults((data || []).filter((l: Localidad) => !assignedIds.has(l.id)))
  }

  const addDestino = async (localidad: Localidad) => {
    setBusquedaLoc("")
    setLocResults([])

    if (editando) {
      // Edit mode: insert to DB immediately
      const { data, error } = await supabase.from("transportes_destinos").insert({
        transporte_id: editando.id,
        localidad_id: localidad.id,
      }).select("id").single()
      if (error) { alert(`Error: ${error.message}`); return }
      setDestinos(prev => [...prev, {
        id: data.id,
        localidad_id: localidad.id,
        localidad_nombre: localidad.nombre,
        localidad_provincia: localidad.provincia,
      }])
    } else {
      // Create mode: add to local state with temp id
      setDestinos(prev => [...prev, {
        id: crypto.randomUUID(),
        localidad_id: localidad.id,
        localidad_nombre: localidad.nombre,
        localidad_provincia: localidad.provincia,
        _pending: true,
      }])
    }
  }

  const removeDestino = async (destino: DestinoAsignado) => {
    if (destino._pending) {
      // Not in DB yet — remove from local state only
      setDestinos(prev => prev.filter(d => d.id !== destino.id))
      return
    }
    const { error } = await supabase.from("transportes_destinos").delete().eq("id", destino.id)
    if (error) { alert(`Error: ${error.message}`); return }
    setDestinos(prev => prev.filter(d => d.id !== destino.id))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      nombre: formData.nombre,
      cuit: formData.cuit || null,
      telefono: formData.telefono || null,
      email: formData.email || null,
      porcentaje_flete: parseFloat(formData.porcentaje_flete) || 0,
      precio_bulto: formData.precio_bulto ? parseFloat(formData.precio_bulto) : null,
      precio_pallet: formData.precio_pallet ? parseFloat(formData.precio_pallet) : null,
      porcentaje_seguro: formData.porcentaje_seguro ? parseFloat(formData.porcentaje_seguro) : null,
      notas: formData.notas || null,
      activo: true,
    }

    if (editando) {
      const { error } = await supabase.from("transportes").update(payload).eq("id", editando.id)
      if (error) { alert(`Error: ${error.message}`); return }
    } else {
      const { data: nuevo, error } = await supabase
        .from("transportes")
        .insert([payload])
        .select("id")
        .single()
      if (error) { alert(`Error: ${error.message}`); return }

      // Insert any pending destinos now that we have the ID
      const pendientes = destinos.filter(d => d._pending)
      if (pendientes.length > 0 && nuevo?.id) {
        const { error: destError } = await supabase.from("transportes_destinos").insert(
          pendientes.map(d => ({ transporte_id: nuevo.id, localidad_id: d.localidad_id }))
        )
        if (destError) alert(`Transporte creado pero error en destinos: ${destError.message}`)
      }
    }

    setDialogOpen(false)
    resetForm()
    loadTransportes()
  }

  const handleEdit = async (t: Transporte) => {
    setEditando(t)
    setFormData({
      nombre: t.nombre, cuit: t.cuit || "", telefono: t.telefono || "",
      email: t.email || "", porcentaje_flete: t.porcentaje_flete.toString(),
      precio_bulto: t.precio_bulto?.toString() || "",
      precio_pallet: t.precio_pallet?.toString() || "",
      porcentaje_seguro: t.porcentaje_seguro?.toString() || "",
      notas: t.notas || "",
    })
    await loadDestinos(t.id)
    setDialogOpen(true)
  }

  const handleNew = () => {
    resetForm()
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este transporte?")) return
    const { error } = await supabase.from("transportes").delete().eq("id", id)
    if (error) { alert(`Error: ${error.message}`); return }
    loadTransportes()
  }

  const resetForm = () => {
    setEditando(null)
    setFormData({ nombre: "", cuit: "", telefono: "", email: "", porcentaje_flete: "", precio_bulto: "", precio_pallet: "", porcentaje_seguro: "", notas: "" })
    setDestinos([])
    setBusquedaLoc("")
    setLocResults([])
  }

  const fmt = (v: number | null, suffix = "") => v !== null && v !== undefined ? `${v}${suffix}` : "—"

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Transportes</h1>
          <p className="text-sm text-muted-foreground">Empresas de transporte, tarifas y destinos</p>
        </div>
        <Button onClick={handleNew} size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo</Button>
      </div>

      {/* Tabla */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>CUIT</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>% Flete</TableHead>
              <TableHead>$/Bulto</TableHead>
              <TableHead>$/Pallet</TableHead>
              <TableHead>% Seguro</TableHead>
              <TableHead className="w-[80px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transportes.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No hay transportes</TableCell></TableRow>
            ) : transportes.map(t => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.nombre}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.cuit || "—"}</TableCell>
                <TableCell className="text-sm">{t.telefono || "—"}</TableCell>
                <TableCell>{fmt(t.porcentaje_flete, "%")}</TableCell>
                <TableCell>{t.precio_bulto ? `$${t.precio_bulto}` : "—"}</TableCell>
                <TableCell>{t.precio_pallet ? `$${t.precio_pallet}` : "—"}</TableCell>
                <TableCell>{fmt(t.porcentaje_seguro, "%")}</TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(t.id)} className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Transporte" : "Nuevo Transporte"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Datos básicos */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nombre *</Label>
                <Input value={formData.nombre} onChange={e => setFormData({...formData, nombre: e.target.value})} required />
              </div>
              <div>
                <Label>CUIT</Label>
                <Input value={formData.cuit} onChange={e => setFormData({...formData, cuit: e.target.value})} />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input value={formData.telefono} onChange={e => setFormData({...formData, telefono: e.target.value})} />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              </div>
            </div>

            {/* Tarifas */}
            <div>
              <h3 className="font-semibold text-sm mb-3 text-neutral-700 uppercase tracking-wide">Tarifas</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label>% Flete (valor declarado)</Label>
                  <Input type="number" step="0.01" value={formData.porcentaje_flete} onChange={e => setFormData({...formData, porcentaje_flete: e.target.value})} placeholder="0" />
                </div>
                <div>
                  <Label>$ por Bulto</Label>
                  <Input type="number" step="0.01" value={formData.precio_bulto} onChange={e => setFormData({...formData, precio_bulto: e.target.value})} placeholder="—" />
                </div>
                <div>
                  <Label>$ por Pallet</Label>
                  <Input type="number" step="0.01" value={formData.precio_pallet} onChange={e => setFormData({...formData, precio_pallet: e.target.value})} placeholder="—" />
                </div>
                <div>
                  <Label>% Seguro</Label>
                  <Input type="number" step="0.01" value={formData.porcentaje_seguro} onChange={e => setFormData({...formData, porcentaje_seguro: e.target.value})} placeholder="—" />
                </div>
              </div>
            </div>

            {/* Notas */}
            <div>
              <Label>Notas</Label>
              <Textarea
                value={formData.notas}
                onChange={e => setFormData({...formData, notas: e.target.value})}
                placeholder="Anotaciones, horarios de retiro, condiciones especiales..."
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Destinos — visible siempre (crear y editar) */}
            <div>
              <h3 className="font-semibold text-sm mb-3 text-neutral-700 uppercase tracking-wide">
                Destinos ({destinos.length} localidades)
                {!editando && destinos.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-blue-600 normal-case">se guardarán al crear</span>
                )}
              </h3>

              {/* Buscador */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <Input
                  value={busquedaLoc}
                  onChange={e => searchLocalidades(e.target.value)}
                  placeholder="Buscar localidad para agregar..."
                  className="pl-9"
                />
                {locResults.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {locResults.map(loc => (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => addDestino(loc)}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-blue-50 flex justify-between items-center"
                      >
                        <span className="font-medium">{loc.nombre}</span>
                        <span className="text-xs text-neutral-400">{loc.provincia}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Lista de destinos asignados */}
              {destinos.length === 0 ? (
                <p className="text-sm text-neutral-400 py-3">No hay destinos asignados. Buscá localidades arriba para agregar.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {destinos.map(d => (
                    <Badge
                      key={d.id}
                      variant="secondary"
                      className={`pl-3 pr-1 py-1.5 gap-1 text-sm ${d._pending ? "border-blue-200 bg-blue-50 text-blue-700" : ""}`}
                    >
                      {d.localidad_nombre}
                      {d.localidad_provincia && <span className="text-neutral-400 text-xs ml-1">({d.localidad_provincia})</span>}
                      <button
                        type="button"
                        onClick={() => removeDestino(d)}
                        className="ml-1 p-0.5 rounded-full hover:bg-neutral-300 transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit">Guardar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
