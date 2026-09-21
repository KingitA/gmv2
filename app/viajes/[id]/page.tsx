"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ArrowLeft, Printer, Send, Undo2, Ban, Wallet } from "lucide-react"
import { toast } from "sonner"
import { formatDateAR, formatDateTimeAR } from "@/lib/utils"
import type { HojaRuta } from "@/lib/viajes/hoja-ruta"
import { ESTADO_VIAJE_LABEL, ESTADO_VIAJE_COLOR, viajeEditable, puedeEditarInstrucciones, esViajePorTransporte } from "@/lib/viajes/estados"
import { ESTADO_LABEL } from "@/lib/pedidos/estados"
import { ViajeHoja } from "@/components/viajes/viaje-hoja"
import { ViajePedidos } from "@/components/viajes/viaje-pedidos"
import { ViajePlata } from "@/components/viajes/viaje-plata"
import { ViajeDatos } from "@/components/viajes/viaje-datos"

type SinFacturar = { id: string; numero: string; estado: string; cliente: string }

export default function ViajeDetallePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [hoja, setHoja] = useState<HojaRuta | null>(null)
  const [error, setError] = useState("")
  const [tab, setTab] = useState("hoja")
  const [ocupado, setOcupado] = useState(false)
  const [sinFacturar, setSinFacturar] = useState<SinFacturar[] | null>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/viajes/${id}/hoja-ruta`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setHoja(data)
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el viaje")
    }
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  const despachar = async (decision?: "quitar" | "despachar") => {
    setOcupado(true)
    try {
      const res = await fetch(`/api/viajes/${id}/despachar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision ? { sin_facturar: decision } : {}),
      })
      const data = await res.json()
      if (res.status === 409 && data.requiere_decision) {
        setSinFacturar(data.sin_facturar)
        return
      }
      if (!res.ok) throw new Error(data.error)
      setSinFacturar(null)
      toast.success("Viaje despachado: la hoja de ruta quedó fija")
      await cargar()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo despachar")
    } finally {
      setOcupado(false)
    }
  }

  const accion = async (url: string, body: any, ok: string, metodo = "POST") => {
    setOcupado(true)
    try {
      const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(ok)
      await cargar()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo completar la acción")
    } finally {
      setOcupado(false)
    }
  }

  if (error) return <div className="p-6"><p className="text-red-600">{error}</p></div>
  if (!hoja) return <div className="p-6 text-muted-foreground">Cargando viaje…</div>

  const v = hoja.viaje
  const porTransporte = esViajePorTransporte(v.tipo_transporte)
  const editable = viajeEditable(v.estado)
  const titular = v.choferes.find((c) => c.rol === "titular")
  const acompanantes = v.choferes.filter((c) => c.rol !== "titular")

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push("/viajes")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{v.nombre}</h1>
              <Badge className={`${ESTADO_VIAJE_COLOR[v.estado] || "bg-slate-400"} text-white`}>{ESTADO_VIAJE_LABEL[v.estado] || v.estado}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatDateAR(v.fecha)} · {v.zonas.join(" + ") || "Sin zonas"} ·{" "}
              {porTransporte
                ? `🚛 ${v.transporte || "Transporte sin definir"}`
                : <>
                    {titular?.nombre || "Sin chofer"}
                    {acompanantes.length > 0 && ` + ${acompanantes.map((a) => a.nombre).join(", ")}`}
                    {v.vehiculo && ` · ${v.vehiculo}`}
                  </>}
              {v.despachado_at && ` · despachado ${formatDateTimeAR(v.despachado_at)}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.open(`/api/viajes/${id}/hoja-ruta/pdf`, "_blank")} disabled={hoja.paradas.length === 0}>
            <Printer className="mr-2 h-4 w-4" /> Hoja de ruta (PDF)
          </Button>
          {editable && (
            <>
              <Button onClick={() => despachar()} disabled={ocupado || hoja.totales.pedidos === 0}>
                <Send className="mr-2 h-4 w-4" /> Despachar
              </Button>
              <Button
                variant="ghost"
                className="text-red-600"
                disabled={ocupado}
                onClick={() => confirm("¿Cancelar el viaje? Sus pedidos quedan libres para otro viaje.") && accion(`/api/viajes/${id}`, { accion: "cancelar" }, "Viaje cancelado", "PATCH")}
              >
                <Ban className="mr-2 h-4 w-4" /> Cancelar
              </Button>
            </>
          )}
          {v.estado === "despachado" && (
            <>
              {porTransporte && (
                <Button disabled={ocupado} onClick={() => accion(`/api/viajes/${id}/despachar`, { accion: "completar" }, "Viaje completado")}>
                  Marcar como completado
                </Button>
              )}
              <Button
                variant="outline"
                disabled={ocupado}
                onClick={() => confirm("¿Reabrir el viaje? Vuelve a 'programado' y los pedidos dejan de estar en viaje.") && accion(`/api/viajes/${id}/despachar`, { accion: "reabrir" }, "Viaje reabierto")}
              >
                <Undo2 className="mr-2 h-4 w-4" /> Reabrir
              </Button>
            </>
          )}
          {v.estado === "en_rendicion" && (
            hoja.totales.cobrado > 0 ? (
              <Button onClick={() => router.push("/caja")}><Wallet className="mr-2 h-4 w-4" /> Controlar rendición en Caja</Button>
            ) : (
              <Button disabled={ocupado} onClick={() => accion(`/api/viajes/${id}/despachar`, { accion: "cerrar" }, "Viaje completado")}>
                Cerrar viaje (sin cobros para rendir)
              </Button>
            )
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="hoja">Hoja de ruta</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos ({hoja.totales.pedidos})</TabsTrigger>
          {!porTransporte && <TabsTrigger value="plata">Plata</TabsTrigger>}
          <TabsTrigger value="datos">Datos</TabsTrigger>
        </TabsList>

        <TabsContent value="hoja" className="pt-4">
          <ViajeHoja
            hoja={hoja}
            ordenEditable={editable}
            instruccionesEditables={puedeEditarInstrucciones(v.estado)}
            conCobranza={!porTransporte}
            onCambio={cargar}
          />
        </TabsContent>
        <TabsContent value="pedidos" className="pt-4">
          <ViajePedidos viajeId={id} onCambio={cargar} />
        </TabsContent>
        {!porTransporte && (
          <TabsContent value="plata" className="pt-4">
            <ViajePlata hoja={hoja} onCambio={cargar} />
          </TabsContent>
        )}
        <TabsContent value="datos" className="pt-4">
          <ViajeDatos viajeId={id} editable={editable} onGuardado={cargar} />
        </TabsContent>
      </Tabs>

      {/* Pedidos sin facturar al despachar */}
      <Dialog open={!!sinFacturar} onOpenChange={(o) => !o && setSinFacturar(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Hay pedidos sin facturar</DialogTitle>
            <DialogDescription>
              Estos pedidos todavía no tienen sus papeles. Podés bajarlos del viaje (quedan libres para otro) o despachar igual.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
            {(sinFacturar || []).map((p) => (
              <div key={p.id} className="flex justify-between px-3 py-2">
                <span><span className="font-medium">#{p.numero}</span> · {p.cliente}</span>
                <span className="text-muted-foreground">{ESTADO_LABEL[p.estado] || p.estado}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setSinFacturar(null)}>Volver</Button>
            <Button variant="outline" disabled={ocupado} onClick={() => despachar("despachar")}>Despachar igual</Button>
            <Button disabled={ocupado} onClick={() => despachar("quitar")}>Bajarlos y despachar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
