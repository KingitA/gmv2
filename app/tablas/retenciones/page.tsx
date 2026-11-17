"use client"

// Regímenes de retención de Ganancias (RG 830) — E-59. Solo admin.
// Se ven los valores vigentes de cada régimen y se pueden cambiar "desde una fecha":
// el valor viejo se cierra y queda en el historial, así lo ya calculado no cambia.

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { InputMonto } from "@/components/ui/input-monto"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { fecha, moneda, porcentaje } from "@/lib/formato"

interface Regimen {
  id: string
  clave: string
  descripcion: string
  alicuota_inscripto: number
  alicuota_no_inscripto: number
  minimo_no_sujeto: number
  retencion_minima: number
  vigencia_desde: string
  vigencia_hasta: string | null
}
interface Edicion { alicuota_inscripto: number | null; alicuota_no_inscripto: number | null; minimo_no_sujeto: number | null; retencion_minima: number | null; vigencia_desde: string }

export default function RegimenesRetencionPage() {
  const [vigentes, setVigentes] = useState<Regimen[]>([])
  const [futuros, setFuturos] = useState<Regimen[]>([])
  const [historial, setHistorial] = useState<Regimen[]>([])
  const [loading, setLoading] = useState(true)
  const [sinPermiso, setSinPermiso] = useState(false)
  const [edit, setEdit] = useState<Record<string, Edicion>>({})
  const [guardando, setGuardando] = useState<string | null>(null)

  async function cargar() {
    setLoading(true)
    try {
      const res = await fetch("/api/retenciones/regimenes")
      const d = await res.json()
      if (res.status === 403) { setSinPermiso(true); return }
      if (!res.ok) throw new Error(d.error)
      setVigentes(d.vigentes || []); setFuturos(d.futuros || []); setHistorial(d.historial || [])
      const e: Record<string, Edicion> = {}
      for (const r of (d.vigentes || []) as Regimen[]) {
        e[r.clave] = {
          alicuota_inscripto: Number(r.alicuota_inscripto), alicuota_no_inscripto: Number(r.alicuota_no_inscripto),
          minimo_no_sujeto: Number(r.minimo_no_sujeto), retencion_minima: Number(r.retencion_minima), vigencia_desde: r.vigencia_desde,
        }
      }
      setEdit(e)
    } catch (err: any) {
      toast.error(err?.message || "No se pudieron cargar los regímenes")
    } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [])

  const set = (clave: string, campo: keyof Edicion, valor: any) => setEdit(p => ({ ...p, [clave]: { ...p[clave], [campo]: valor } }))

  async function guardar(r: Regimen) {
    const e = edit[r.clave]
    if (!e) return
    setGuardando(r.clave)
    try {
      const res = await fetch("/api/retenciones/regimenes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave: r.clave, ...e }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(d.modo === "nuevo_desde_fecha"
        ? `Valores nuevos de "${r.clave}" desde el ${fecha(e.vigencia_desde)}. Los anteriores quedaron en el historial.`
        : `Valores de "${r.clave}" corregidos.`)
      cargar()
    } catch (err: any) {
      toast.error(err?.message || "No se pudo guardar", { duration: 10000 })
    } finally { setGuardando(null) }
  }

  const cambio = (r: Regimen) => {
    const e = edit[r.clave]
    return !!e && (Number(e.alicuota_inscripto) !== Number(r.alicuota_inscripto) || Number(e.alicuota_no_inscripto) !== Number(r.alicuota_no_inscripto)
      || Number(e.minimo_no_sujeto) !== Number(r.minimo_no_sujeto) || Number(e.retencion_minima) !== Number(r.retencion_minima))
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/tablas"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">Retención de Ganancias</h1>
          <p className="text-sm text-muted-foreground">Alícuotas y mínimos de cada régimen (RG 830). Es lo que usa la orden de pago para calcular cuánto retener.</p>
        </div>
      </div>

      {sinPermiso ? (
        <Card><CardContent className="p-6 text-sm">Solo un administrador puede ver y cambiar estos valores.</CardContent></Card>
      ) : loading ? (
        <CargaProgreso mensajes={MENSAJES.tablas} titulo="Cargando regímenes" />
      ) : (
        <>
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Confirmá estos valores con el contador antes de cambiarlos. El <b>mínimo no sujeto</b> es por mes y por proveedor; se retiene la alícuota sobre lo que lo supera.
            No se retiene si el resultado es menor a la <b>retención mínima</b>. Los proveedores exentos y los certificados de exclusión se cargan en la ficha de cada proveedor.
          </p>

          {vigentes.map(r => {
            const e = edit[r.clave]
            if (!e) return null
            const nuevoDesde = e.vigencia_desde !== r.vigencia_desde
            return (
              <Card key={r.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg capitalize">{r.clave} <span className="text-sm font-normal normal-case text-muted-foreground">· {r.descripcion}</span></CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Hoy: {porcentaje(r.alicuota_inscripto)} inscripto · {porcentaje(r.alicuota_no_inscripto)} no inscripto · mínimo no sujeto {moneda(Number(r.minimo_no_sujeto))} · retención mínima {moneda(Number(r.retencion_minima))} · rige desde el {fecha(r.vigencia_desde)}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <div><Label className="text-xs">Alícuota inscripto</Label><InputMonto porciento soloPositivos decimales={3} value={e.alicuota_inscripto} onChange={n => set(r.clave, "alicuota_inscripto", n)} /></div>
                    <div><Label className="text-xs">Alícuota no inscripto</Label><InputMonto porciento soloPositivos decimales={3} value={e.alicuota_no_inscripto} onChange={n => set(r.clave, "alicuota_no_inscripto", n)} /></div>
                    <div><Label className="text-xs">Mínimo no sujeto (mes)</Label><InputMonto pesos soloPositivos value={e.minimo_no_sujeto} onChange={n => set(r.clave, "minimo_no_sujeto", n)} /></div>
                    <div><Label className="text-xs">Retención mínima</Label><InputMonto pesos soloPositivos value={e.retencion_minima} onChange={n => set(r.clave, "retencion_minima", n)} /></div>
                    <div><Label className="text-xs">Vigente desde</Label><DateInputAR value={e.vigencia_desde} onChange={v => set(r.clave, "vigencia_desde", v || r.vigencia_desde)} /></div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" disabled={guardando === r.clave || (!cambio(r) && !nuevoDesde)} onClick={() => guardar(r)}>
                      {guardando === r.clave ? "Guardando…" : "Guardar"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {nuevoDesde
                        ? `Se guarda como valor NUEVO desde el ${fecha(e.vigencia_desde)}: el actual queda cerrado el día anterior y pasa al historial.`
                        : "Con la misma fecha se CORRIGE el valor actual. Si el cambio rige desde un día determinado, poné esa fecha en \"Vigente desde\"."}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {futuros.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Valores cargados que todavía no rigen</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {futuros.map(r => (
                  <p key={r.id}><b className="capitalize">{r.clave}</b> desde el {fecha(r.vigencia_desde)}: {porcentaje(r.alicuota_inscripto)} / {porcentaje(r.alicuota_no_inscripto)} · mínimo {moneda(Number(r.minimo_no_sujeto))} · retención mínima {moneda(Number(r.retencion_minima))}</p>
                ))}
              </CardContent>
            </Card>
          )}

          {historial.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Historial</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                {historial.map(r => (
                  <p key={r.id}><b className="capitalize">{r.clave}</b> del {fecha(r.vigencia_desde)} al {r.vigencia_hasta ? fecha(r.vigencia_hasta) : "—"}: {porcentaje(r.alicuota_inscripto)} / {porcentaje(r.alicuota_no_inscripto)} · mínimo {moneda(Number(r.minimo_no_sujeto))} · retención mínima {moneda(Number(r.retencion_minima))}</p>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
