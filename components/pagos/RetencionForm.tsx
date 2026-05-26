"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Plus, Upload, Loader2 } from "lucide-react"
import { toast } from "sonner"

export interface Retencion {
  id: string
  tipo: "IIBB" | "IVA" | "GANANCIAS" | "SUSS"
  fecha: string
  numero_comprobante: string
  monto: number
  origen: "manual" | "ocr"
  archivo_url?: string
}

function genId() { return Math.random().toString(36).slice(2) }

interface Props {
  retenciones: Retencion[]
  onChange: (retenciones: Retencion[]) => void
}

const tiposRetencion = ["IIBB", "IVA", "GANANCIAS", "SUSS"] as const

export function RetencionForm({ retenciones, onChange }: Props) {
  const [procesandoOcr, setProcesandoOcr] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const addManual = () => {
    onChange([...retenciones, {
      id: genId(),
      tipo: "IIBB",
      fecha: new Date().toISOString().slice(0, 10),
      numero_comprobante: "",
      monto: 0,
      origen: "manual",
    }])
  }

  const remove = (id: string) => onChange(retenciones.filter((r) => r.id !== id))

  const update = (id: string, patch: Partial<Retencion>) =>
    onChange(retenciones.map((r) => r.id === id ? { ...r, ...patch } : r))

  const handleOcrFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setProcesandoOcr(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      // Por ahora extraemos manualmente — OCR de retenciones requiere prompt específico
      // Se agrega la retención vacía para que el usuario complete
      toast.info("Archivo cargado. Complete los campos manualmente o espere el procesamiento OCR.")
      onChange([...retenciones, {
        id: genId(),
        tipo: "IIBB",
        fecha: new Date().toISOString().slice(0, 10),
        numero_comprobante: "",
        monto: 0,
        origen: "ocr",
        archivo_url: URL.createObjectURL(file),
      }])
    } finally {
      setProcesandoOcr(false)
      e.target.value = ""
    }
  }

  return (
    <div className="space-y-3">
      {retenciones.map((r) => (
        <div key={r.id} className="border rounded-lg p-3 bg-white">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo retención</Label>
              <Select value={r.tipo} onValueChange={(v) => update(r.id, { tipo: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {tiposRetencion.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Fecha</Label>
              <Input type="date" value={r.fecha} onChange={(e) => update(r.id, { fecha: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Nro. comprobante retención</Label>
              <Input placeholder="Nro. retención" value={r.numero_comprobante} onChange={(e) => update(r.id, { numero_comprobante: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Monto</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={r.monto || ""}
                onChange={(e) => update(r.id, { monto: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>
          <div className="flex justify-end mt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(r.id)} className="text-red-500 hover:text-red-700 h-7">
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Eliminar
            </Button>
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addManual}>
          <Plus className="h-4 w-4 mr-1" /> Agregar retención manual
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={procesandoOcr}
        >
          {procesandoOcr ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
          Cargar archivo retención
        </Button>
        <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleOcrFile} />
      </div>
    </div>
  )
}
