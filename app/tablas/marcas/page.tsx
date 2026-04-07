"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Plus, Pencil, Trash2, Upload, Download, Check, X, AlertCircle } from "lucide-react"
import * as XLSX from "xlsx"

type Marca = {
  id: string
  codigo: string
  descripcion: string
  activo: boolean
}

type ImportRow = { codigo: string; descripcion: string; accion: "nuevo" | "actualizar" | "sin_cambios" }

export default function MarcasPage() {
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editando, setEditando] = useState<Marca | null>(null)
  const [formData, setFormData] = useState({ codigo: "", descripcion: "" })
  const [guardando, setGuardando] = useState(false)

  // Import
  const [importDialog, setImportDialog] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [importando, setImportando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const supabase = createClient()

  useEffect(() => { loadMarcas() }, [])

  const loadMarcas = async () => {
    const { data } = await supabase.from("marcas").select("*").order("codigo")
    setMarcas(data || [])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setGuardando(true)
    const payload = { codigo: formData.codigo.trim().toUpperCase(), descripcion: formData.descripcion.trim() }
    if (editando) {
      const { error } = await supabase.from("marcas").update(payload).eq("id", editando.id)
      if (error) { alert(`Error: ${error.message}`); setGuardando(false); return }
    } else {
      const { error } = await supabase.from("marcas").insert([payload])
      if (error) { alert(`Error: ${error.message}`); setGuardando(false); return }
    }
    setGuardando(false)
    setDialogOpen(false)
    resetForm()
    loadMarcas()
  }

  const handleEdit = (m: Marca) => {
    setEditando(m)
    setFormData({ codigo: m.codigo, descripcion: m.descripcion })
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar esta marca? Los artículos que la usen quedarán sin marca asignada.")) return
    const { error } = await supabase.from("marcas").delete().eq("id", id)
    if (error) { alert(`Error: ${error.message}`); return }
    loadMarcas()
  }

  const resetForm = () => {
    setEditando(null)
    setFormData({ codigo: "", descripcion: "" })
  }

  // ─── Import from Excel ────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const data = new Uint8Array(ev.target?.result as ArrayBuffer)
      const wb = XLSX.read(data, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rawRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" })

      // Normalise column names (case-insensitive)
      const normalize = (row: any) => {
        const out: Record<string, string> = {}
        for (const k of Object.keys(row)) out[k.toLowerCase().trim()] = String(row[k]).trim()
        return out
      }

      const parsed = rawRows.map(normalize).filter(r => r.codigo && r.descripcion)

      // Compare with existing
      const existing = new Map(marcas.map(m => [m.codigo, m]))
      const rows: ImportRow[] = parsed.map(r => {
        const codigo = r.codigo.toUpperCase()
        const ex = existing.get(codigo)
        if (!ex) return { codigo, descripcion: r.descripcion, accion: "nuevo" }
        if (ex.descripcion !== r.descripcion) return { codigo, descripcion: r.descripcion, accion: "actualizar" }
        return { codigo, descripcion: r.descripcion, accion: "sin_cambios" }
      })

      setImportRows(rows)
      setImportDialog(true)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ""
  }

  const confirmImport = async () => {
    const toProcess = importRows.filter(r => r.accion !== "sin_cambios")
    if (toProcess.length === 0) { setImportDialog(false); return }

    setImportando(true)
    const nuevos = toProcess.filter(r => r.accion === "nuevo")
    const actualizar = toProcess.filter(r => r.accion === "actualizar")

    if (nuevos.length > 0) {
      const { error } = await supabase.from("marcas").insert(
        nuevos.map(r => ({ codigo: r.codigo, descripcion: r.descripcion }))
      )
      if (error) { alert(`Error insertando: ${error.message}`); setImportando(false); return }
    }

    for (const r of actualizar) {
      await supabase.from("marcas").update({ descripcion: r.descripcion }).eq("codigo", r.codigo)
    }

    setImportando(false)
    setImportDialog(false)
    setImportRows([])
    await loadMarcas()
    alert(`Importación completada: ${nuevos.length} nuevas, ${actualizar.length} actualizadas.`)
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{ codigo: "01", descripcion: "COLGATE" }, { codigo: "02", descripcion: "UNILEVER" }])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Marcas")
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const blob = new Blob([out], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = "marcas_template.xlsx"; a.click()
    URL.revokeObjectURL(url)
  }

  const accionBadge = (a: ImportRow["accion"]) => {
    if (a === "nuevo")      return <Badge className="bg-green-100 text-green-700 border-0">Nuevo</Badge>
    if (a === "actualizar") return <Badge className="bg-blue-100 text-blue-700 border-0">Actualizar</Badge>
    return <Badge variant="secondary">Sin cambios</Badge>
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Marcas</h1>
          <p className="text-sm text-muted-foreground">Marcas de artículos — código y descripción</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" /> Plantilla
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Importar Excel
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
          <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Nueva
          </Button>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Código</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-[100px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {marcas.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No hay marcas cargadas</TableCell></TableRow>
            ) : marcas.map(m => (
              <TableRow key={m.id}>
                <TableCell className="font-mono font-semibold">{m.codigo}</TableCell>
                <TableCell>{m.descripcion}</TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(m.id)} className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* CRUD Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Marca" : "Nueva Marca"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Código *</Label>
              <Input
                value={formData.codigo}
                onChange={e => setFormData(p => ({ ...p, codigo: e.target.value }))}
                placeholder="Ej: 01"
                required
                className="font-mono"
              />
            </div>
            <div>
              <Label>Descripción *</Label>
              <Input
                value={formData.descripcion}
                onChange={e => setFormData(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Ej: COLGATE"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Import preview dialog */}
      <Dialog open={importDialog} onOpenChange={setImportDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Preview de importación</DialogTitle>
          </DialogHeader>

          <div className="flex gap-3 text-sm text-muted-foreground mb-2 shrink-0">
            <span className="text-green-600 font-semibold">{importRows.filter(r => r.accion === "nuevo").length} nuevas</span>
            <span className="text-blue-600 font-semibold">{importRows.filter(r => r.accion === "actualizar").length} a actualizar</span>
            <span>{importRows.filter(r => r.accion === "sin_cambios").length} sin cambios</span>
          </div>

          {importRows.filter(r => r.accion !== "sin_cambios").length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <AlertCircle className="h-4 w-4" />
              No hay cambios para aplicar.
            </div>
          )}

          <div className="overflow-auto flex-1 border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importRows.filter(r => r.accion !== "sin_cambios").map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono font-semibold">{r.codigo}</TableCell>
                    <TableCell>{r.descripcion}</TableCell>
                    <TableCell>{accionBadge(r.accion)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end gap-2 pt-3 shrink-0">
            <Button variant="outline" onClick={() => setImportDialog(false)}>
              <X className="h-4 w-4 mr-1" />Cancelar
            </Button>
            <Button
              onClick={confirmImport}
              disabled={importando || importRows.filter(r => r.accion !== "sin_cambios").length === 0}
            >
              {importando ? "Importando..." : <><Check className="h-4 w-4 mr-1" />Confirmar importación</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
