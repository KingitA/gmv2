"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ArrowLeft, Printer, Send, Undo2, Ban, Wallet, Pencil, Banknote, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency, formatDateAR, formatDateTimeAR } from "@/lib/utils"
import type { HojaRuta } from "@/lib/viajes/hoja-ruta"
import { ESTADO_VIAJE_LABEL, ESTADO_VIAJE_COLOR, viajeEditable, puedeEditarInstrucciones, esViajePorTransporte } from "@/lib/viajes/estados"
import { ESTADO_LABEL } from "@/lib/pedidos/estados"
import { ViajeHoja } from "@/components/viajes/viaje-hoja"
import { ViajePedidos } from "@/components/viajes/viaje-pedidos"
import { ViajeArqueo } from "@/components/viajes/viaje-arqueo"
import { ViajeDatos } from "@/components/viajes/viaje-datos"
import { EntregarDinero } from "@/components/viajes/entregar-dinero"

// Detalle del viaje = la hoja de ruta, en una sola pantalla: KPIs arriba,
// paradas en vivo (qué se entregó, cuánto y cómo se cobró), pedidos y el
// arqueo abajo. Datos del viaje y entrega de plata en modales.

type SinFacturar = { id: string; numero: string; estado: string; cliente: string }

export default function ViajeDetallePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [hoja, setHoja] = useState<HojaRuta | null>(null)
  const [error, setError] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const [sinFacturar, setSinFacturar] = useState<SinFacturar[] | null>(null)
  const [editando, setEditando] = useState(false)
  const [entregando, setEntregando] = useState(false)
  const [verPedidos, setVerPedidos] = useState(false)

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

  // En la calle la hoja se actualiza sola (cobros, entregas, gastos)
  useEffect(() => {
    if (!hoja || !["despachado", "en_curso"].includes(hoja.viaje.estado)) return
    const t = setInterval(cargar, 30_000)
    return () => clearInterval(t)
  }, [hoja?.viaje.estado, cargar])

  const despachar = async (decision?: "quitar" | "despachar") => {
    setOcupado(true)
    try {
      const res = await fetch(`/api/viajes/${id}/despachar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision ? { sin_facturar: decision } : {}),
      })
      const data = await res.json()
      if (res.status === 409 && data.requiere_decision) { setSinFacturar(data.sin_facturar); return }
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
  const t = hoja.totales
  const porTransporte = esViajePorTransporte(v.tipo_transporte)
  const editable = viajeEditable(v.estado)
  const titular = v.choferes.find((c) => c.rol === "titular")
  const acompanantes = v.choferes.filter((c) => c.rol !== "titular")
  const puedeEntregarPlata = !porTransporte && ["programado", "despachado", "en_curso"].includes(v.estado)

  return (
    <div className="space-y-4 p-6">
      {/* Encabezado: identidad del viaje + acciones | KPIs */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push("/viajes")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{v.nombre}</h1>
              <Badge className={`${ESTADO_VIAJE_COLOR[v.estado] || "bg-slate-400"} text-white`}>{ESTADO_VIAJE_LABEL[v.estado] || v.estado}</Badge>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditando(true)}><Pencil className="mr-1 h-3.5 w-3.5" /> Editar viaje</Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatDateAR(v.fecha)}{v.dias > 1 && ` → ${formatDateAR(v.fecha_fin)} (${v.dias} días)`} · {v.zonas.join(" + ") || "Sin zonas"} ·{" "}
              {porTransporte
                ? `🚛 ${v.transporte || "Transporte sin definir"}`
                : <>{titular?.nombre || "Sin chofer"}{acompanantes.length > 0 && ` + ${acompanantes.map((a) => a.nombre).join(", ")}`}{v.vehiculo && ` · ${v.vehiculo}`}</>}
              {v.despachado_at && ` · despachado ${formatDateTimeAR(v.despachado_at)}`}
              {v.actualizado_at && <span className="ml-2 text-xs">(modificado por {v.actualizado_por || "—"} el {formatDateTimeAR(v.actualizado_at)})</span>}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {puedeEntregarPlata && (
                <Button size="sm" onClick={() => setEntregando(true)}><Banknote className="mr-2 h-4 w-4" /> Entregar dinero a chofer</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => window.open(`/api/viajes/${id}/hoja-ruta/pdf`, "_blank")} disabled={hoja.paradas.length === 0}>
                <Printer className="mr-2 h-4 w-4" /> Hoja de ruta (PDF)
              </Button>
              {editable && (
                <>
                  <Button size="sm" variant="outline" onClick={() => despachar()} disabled={ocupado || t.pedidos === 0}>
                    <Send className="mr-2 h-4 w-4" /> Despachar
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600" disabled={ocupado}
                    onClick={() => confirm("¿Cancelar el viaje? Sus pedidos quedan libres para otro viaje.") && accion(`/api/viajes/${id}`, { accion: "cancelar" }, "Viaje cancelado", "PATCH")}>
                    <Ban className="mr-2 h-4 w-4" /> Cancelar
                  </Button>
                </>
              )}
              {v.estado === "despachado" && (
                <>
                  {porTransporte && (
                    <Button size="sm" disabled={ocupado} onClick={() => accion(`/api/viajes/${id}/despachar`, { accion: "completar" }, "Viaje completado")}>Marcar como completado</Button>
                  )}
                  <Button size="sm" variant="outline" disabled={ocupado}
                    onClick={() => confirm("¿Reabrir el viaje? Vuelve a 'programado' y los pedidos dejan de estar en viaje.") && accion(`/api/viajes/${id}/despachar`, { accion: "reabrir" }, "Viaje reabierto")}>
                    <Undo2 className="mr-2 h-4 w-4" /> Reabrir
                  </Button>
                </>
              )}
              {v.estado === "en_rendicion" && (
                t.cobrado > 0 ? (
                  <Button size="sm" onClick={() => router.push("/caja")}><Wallet className="mr-2 h-4 w-4" /> Controlar rendición en Caja</Button>
                ) : (
                  <Button size="sm" disabled={ocupado} onClick={() => accion(`/api/viajes/${id}/despachar`, { accion: "cerrar" }, "Viaje completado")}>Cerrar viaje (sin cobros para rendir)</Button>
                )
              )}
            </div>
          </div>
        </div>

        {/* KPIs: lo que importa, grande */}
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-6">
            {!porTransporte && (
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Saldos anteriores</p>
                <p className={`text-3xl font-bold tabular-nums ${t.saldo_anterior > 0.01 ? "text-red-700" : ""}`}>{formatCurrency(t.saldo_anterior)}</p>
              </div>
            )}
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{porTransporte ? "Total del viaje" : "Total a cobrar"}</p>
              <p className="text-4xl font-bold tabular-nums">{formatCurrency(porTransporte ? t.total_viaje : t.total_a_cobrar)}</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
            <span><b className="text-foreground">{t.paradas}</b> clientes</span>
            <span><b className="text-foreground">{t.pedidos}</b> pedidos</span>
            <span><b className="text-foreground">{t.bultos}</b> bultos</span>
            {!porTransporte && <span>este viaje <b className="text-foreground">{formatCurrency(t.total_viaje)}</b></span>}
            {!porTransporte && t.minimo_exigido > 0 && <span className="text-red-700">cobrar sí o sí <b>{formatCurrency(t.minimo_exigido)}</b></span>}
          </div>
          {(t.cobrado > 0 || t.resueltas > 0) && (
            <div className="flex flex-wrap justify-end gap-x-4 text-sm">
              <span className="text-green-700">cobrado <b>{formatCurrency(t.cobrado)}</b></span>
              <span>entregados <b>{t.resueltas}</b>/{t.paradas}</span>
            </div>
          )}
        </div>
      </div>

      {/* La hoja de ruta */}
      <ViajeHoja
        hoja={hoja}
        ordenEditable={editable}
        instruccionesEditables={puedeEditarInstrucciones(v.estado)}
        conCobranza={!porTransporte}
        onCambio={cargar}
      />

      {/* Pedidos del viaje (subir / quitar) */}
      <div className="rounded-lg border bg-white">
        <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold" onClick={() => setVerPedidos((x) => !x)}>
          <span>Pedidos del viaje ({t.pedidos}){editable && " · subir o quitar pedidos"}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${verPedidos ? "rotate-180" : ""}`} />
        </button>
        {verPedidos && <div className="border-t p-3"><ViajePedidos viajeId={id} onCambio={cargar} /></div>}
      </div>

      {/* Plata del viaje y arqueo */}
      {!porTransporte && <ViajeArqueo hoja={hoja} onCambio={cargar} />}

      {/* Modales */}
      <Dialog open={editando} onOpenChange={setEditando}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Editar viaje</DialogTitle></DialogHeader>
          <ViajeDatos viajeId={id} editable={editable} onGuardado={() => { setEditando(false); cargar() }} />
        </DialogContent>
      </Dialog>

      <EntregarDinero hoja={hoja} abierto={entregando} onClose={() => setEntregando(false)} onHecho={cargar} />

      <Dialog open={!!sinFacturar} onOpenChange={(o) => !o && setSinFacturar(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Hay pedidos sin facturar</DialogTitle>
            <DialogDescription>Estos pedidos todavía no tienen sus papeles. Podés bajarlos del viaje (quedan libres para otro) o despachar igual.</DialogDescription>
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
