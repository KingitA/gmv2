"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { Loader2, Upload, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

/**
 * Ficha fiscal del proveedor (R6): régimen RG 830 y condición ante Ganancias,
 * certificados de exclusión, y carga de legajo/constancia con OCR — el sistema
 * propone los cambios y el usuario confirma antes de aplicar nada.
 */
export function FichaFiscalDialog({
  proveedorId,
  proveedorNombre,
  open,
  onOpenChange,
}: {
  proveedorId: string | null
  proveedorNombre: string
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [data, setData] = useState<any>(null)
  const [regimen, setRegimen] = useState("bienes")
  const [condicion, setCondicion] = useState("inscripto")
  const [nuevaExclusion, setNuevaExclusion] = useState<{ desde: string; hasta: string; pct: string; nro: string } | null>(null)
  const [desactivar, setDesactivar] = useState<Set<string>>(new Set())
  const [propuesta, setPropuesta] = useState<any>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !proveedorId) return
    setPropuesta(null)
    setNuevaExclusion(null)
    setDesactivar(new Set())
    fetch(`/api/proveedores/${proveedorId}/fiscal`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { toast.error(d.error); return }
        setData(d)
        setRegimen(d.proveedor.regimen_ganancias || "bienes")
        setCondicion(d.proveedor.condicion_ganancias || "inscripto")
      })
      .catch(e => toast.error(e.message))
  }, [open, proveedorId])

  const leerLegajo = async (file: File) => {
    if (!proveedorId) return
    setLeyendo(true)
    setPropuesta(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/proveedores/${proveedorId}/legajo`, { method: "POST", body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setPropuesta(d.propuesta)
      // Pre-aplicar la propuesta a los controles (el usuario confirma con Guardar)
      for (const c of d.propuesta.cambios ?? []) {
        if (c.campo === "condicion_ganancias") setCondicion(c.nuevo)
      }
      const ex = (d.propuesta.exclusiones_detectadas ?? [])[0]
      if (ex) {
        setNuevaExclusion({
          desde: ex.fecha_desde ?? "",
          hasta: ex.fecha_hasta ?? "",
          pct: String(ex.porcentaje ?? 100),
          nro: ex.numero_certificado ?? "",
        })
      }
      if (!d.propuesta.cuit_coincide) {
        toast.error(`⚠ El CUIT del documento (${d.propuesta.cuit_documento}) NO coincide con el del proveedor — revisá antes de guardar`)
      } else {
        toast.success("Documento leído — revisá la propuesta y guardá")
      }
    } catch (e: any) {
      toast.error(`No se pudo leer el documento: ${e.message}`)
    } finally {
      setLeyendo(false)
    }
  }

  const guardar = async () => {
    if (!proveedorId) return
    setSaving(true)
    try {
      const body: any = {
        regimen_ganancias: regimen,
        condicion_ganancias: condicion,
        desactivar_exclusiones: [...desactivar],
      }
      if (nuevaExclusion && nuevaExclusion.desde && Number(nuevaExclusion.pct) > 0) {
        body.exclusiones_nuevas = [{
          tipo: "retencion_ganancias",
          fecha_desde: nuevaExclusion.desde,
          fecha_hasta: nuevaExclusion.hasta || null,
          porcentaje: Number(nuevaExclusion.pct),
          numero_certificado: nuevaExclusion.nro || null,
        }]
      }
      const res = await fetch(`/api/proveedores/${proveedorId}/fiscal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success("Ficha fiscal actualizada")
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const exclusionesActivas = (data?.exclusiones ?? []).filter((e: any) => e.activo)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-600" /> Ficha fiscal — {proveedorNombre}
          </DialogTitle>
        </DialogHeader>

        {!data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Cargando…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Régimen RG 830</Label>
                <Select value={regimen} onValueChange={setRegimen}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(data.regimenes ?? []).map((r: any) => (
                      <SelectItem key={r.clave} value={r.clave}>
                        {r.descripcion} ({Number(r.alicuota_inscripto)}%)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Condición ante Ganancias</Label>
                <Select value={condicion} onValueChange={setCondicion}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inscripto">Inscripto</SelectItem>
                    <SelectItem value="no_inscripto">No inscripto (alícuota agravada)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Exclusiones vigentes */}
            <div>
              <Label className="mb-1 block">Certificados de exclusión</Label>
              {!exclusionesActivas.length ? (
                <p className="text-xs text-muted-foreground">Sin certificados activos.</p>
              ) : (
                <div className="space-y-1.5">
                  {exclusionesActivas.map((e: any) => (
                    <label key={e.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm cursor-pointer">
                      <input type="checkbox" className="h-3.5 w-3.5"
                        checked={!desactivar.has(e.id)}
                        onChange={(ev) => setDesactivar(prev => {
                          const n = new Set(prev)
                          ev.target.checked ? n.delete(e.id) : n.add(e.id)
                          return n
                        })} />
                      <span className="flex-1">
                        {e.tipo.replace("_", " ")} · {Number(e.porcentaje_excencion)}%
                        {e.numero_certificado ? ` · N° ${e.numero_certificado}` : ""}
                        <span className="text-xs text-muted-foreground"> ({e.fecha_desde} → {e.fecha_hasta ?? "sin fin"})</span>
                      </span>
                      {desactivar.has(e.id) && <Badge className="bg-red-100 text-red-700">se desactiva</Badge>}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* OCR de legajo */}
            <div className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-3">
              <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
                onChange={e => e.target.files?.[0] && leerLegajo(e.target.files[0])} />
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={leyendo}>
                  {leyendo ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  Cargar constancia / legajo
                </Button>
                <p className="text-xs text-muted-foreground flex-1">
                  {leyendo ? "Leyendo el documento con OCR…" : "PDF o foto: constancia de CUIT, certificado de exclusión, legajo impositivo. El sistema propone los cambios y vos confirmás."}
                </p>
              </div>
              {propuesta && (
                <div className="mt-3 space-y-1.5 text-sm">
                  <p className="text-xs font-semibold text-indigo-800">
                    Documento leído: {String(propuesta.tipo_documento).replace(/_/g, " ")}
                    {propuesta.razon_social_documento ? ` · ${propuesta.razon_social_documento}` : ""}
                    {propuesta.cuit_documento ? ` · CUIT ${propuesta.cuit_documento}` : ""}
                  </p>
                  {!propuesta.cuit_coincide && (
                    <p className="text-xs font-bold text-red-700">⚠ El CUIT del documento no coincide con el del proveedor.</p>
                  )}
                  {(propuesta.cambios ?? []).map((c: any, i: number) => (
                    <p key={i} className="text-xs">→ {c.campo.replace(/_/g, " ")}: <s className="text-muted-foreground">{c.actual}</s> → <b>{c.nuevo}</b> (aplicado en el selector — guardá para confirmar)</p>
                  ))}
                  {(propuesta.exclusiones_detectadas ?? []).length > 0 && (
                    <p className="text-xs">→ Certificado de exclusión detectado — precargado abajo, guardá para registrarlo.</p>
                  )}
                  {!((propuesta.cambios ?? []).length) && !((propuesta.exclusiones_detectadas ?? []).length) && (
                    <p className="text-xs text-muted-foreground">La ficha ya coincide con el documento — no hay cambios para aplicar.</p>
                  )}
                  {propuesta.observaciones && <p className="text-xs text-muted-foreground">Nota: {propuesta.observaciones}</p>}
                </div>
              )}
            </div>

            {/* Alta manual / precargada de exclusión */}
            <div>
              <div className="flex items-center justify-between">
                <Label>Nueva exclusión</Label>
                {!nuevaExclusion && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setNuevaExclusion({ desde: "", hasta: "", pct: "100", nro: "" })}>
                    + Agregar a mano
                  </Button>
                )}
              </div>
              {nuevaExclusion && (
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div><Label className="text-xs">Desde</Label><FechaInput value={nuevaExclusion.desde} onChange={v => setNuevaExclusion(p => p && ({ ...p, desde: v }))} /></div>
                  <div><Label className="text-xs">Hasta</Label><FechaInput value={nuevaExclusion.hasta} onChange={v => setNuevaExclusion(p => p && ({ ...p, hasta: v }))} /></div>
                  <div><Label className="text-xs">% exclusión</Label><Input inputMode="decimal" value={nuevaExclusion.pct} onChange={e => setNuevaExclusion(p => p && ({ ...p, pct: e.target.value }))} /></div>
                  <div><Label className="text-xs">N° certificado</Label><Input value={nuevaExclusion.nro} onChange={e => setNuevaExclusion(p => p && ({ ...p, nro: e.target.value }))} /></div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="button" disabled={saving} onClick={guardar}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Guardar ficha fiscal
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
