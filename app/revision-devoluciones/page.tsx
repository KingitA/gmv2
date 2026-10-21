"use client"

/**
 * Revisión de devoluciones — lista compacta.
 * Una fila por devolución (fecha, viajante, cliente, artículos, total, estado);
 * click en la fila despliega los renglones. Acciones por fila:
 *  - Revisar (solo pendiente): renglón por renglón aceptar / rechazar, cantidad
 *    aceptada y condición (vendible / no vendible). Suma stock solo de lo
 *    aceptado y vendible; si se rechaza todo queda rechazada.
 *  - Emitir NC (solo aceptada = "Pendiente NC"): emite la NC fiscal (CAE) o la
 *    Reversa por lo aceptado. El sistema nunca la emite solo.
 *  - Rechazar (solo pendiente) / Eliminar (revierte stock si ya estaba aceptada).
 * El comprobante asociado (RG 4540) lo resuelve solo el generador de NC.
 */

import { Fragment, useEffect, useState } from "react"
import { Loader2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { useRealtime } from "@/lib/hooks/use-realtime"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { InputMonto } from "@/components/ui/input-monto"
import { fecha, fechaHora, numero, redondear } from "@/lib/formato"
import { createClient } from "@/lib/supabase/client"

const ESTADO_UI: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente depósito", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  confirmado: { label: "Pendiente NC", cls: "bg-blue-100 text-blue-800 border-blue-300" },
}

type Condicion = "vendible" | "no_vendible"
interface RevRenglon { aceptar: boolean; cantidad: number | null; condicion: Condicion; motivo: string }

const condicionDe = (it: any): Condicion =>
  it.condicion === "no_vendible" || it.condicion === "vendible" ? it.condicion : it.es_vendible === false ? "no_vendible" : "vendible"
const cantidadOriginal = (it: any) => Number(it.cantidad_original ?? it.cantidad) || 0
const precio = (it: any) => Number(it.precio_venta_original || 0)

export default function RevisionDevolucionesPage() {
  const [devoluciones, setDevoluciones] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  // Revisión renglón por renglón (solo pendiente)
  const [revisando, setRevisando] = useState<string | null>(null)
  const [rev, setRev] = useState<Record<string, RevRenglon>>({})
  const [motivoGeneral, setMotivoGeneral] = useState("")
  const { toast } = useToast()

  useEffect(() => { cargar() }, [])
  // En vivo: devoluciones que carga el chofer/vendedor o revisa el depósito
  useRealtime(["devoluciones"], () => cargar(true))

  async function cargar(silencioso = false) {
    if (!silencioso) setLoading(true)
    try {
      const res = await fetch("/api/devoluciones?estado=revision")
      const data = await res.json()
      const lista = Array.isArray(data) ? data : []
      // confirmado_por guarda el id del usuario: se muestra su nombre (antes
      // "Aceptó D6AC25BB-…", auditoría 21/10)
      const ids = [...new Set(lista.map((d: any) => d.confirmado_por).filter((v: any) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)))]
      if (ids.length) {
        const { data: perfiles } = await createClient().from("profiles").select("id, nombre, email").in("id", ids)
        const nombre = new Map((perfiles || []).map((p: any) => [p.id, p.nombre || p.email]))
        for (const d of lista) if (nombre.has(d.confirmado_por)) d.confirmado_por = nombre.get(d.confirmado_por)
      }
      setDevoluciones(lista)
    } catch {
      toast({ title: "Error", description: "No se pudieron cargar las devoluciones", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  // ── Acciones ────────────────────────────────────────────────────────────────

  function empezarRevision(dev: any) {
    setAbierta(dev.id)
    setRevisando(dev.id)
    setMotivoGeneral("")
    const init: Record<string, RevRenglon> = {}
    for (const it of dev.items || []) {
      init[it.id] = { aceptar: true, cantidad: Number(it.cantidad) || 0, condicion: condicionDe(it), motivo: "" }
    }
    setRev(init)
  }

  function cancelarRevision() {
    setRevisando(null)
    setRev({})
    setMotivoGeneral("")
  }

  const setRenglon = (id: string, cambios: Partial<RevRenglon>) =>
    setRev((p) => ({ ...p, [id]: { ...p[id], ...cambios } }))

  /** Totales antes / después de la revisión en curso */
  function totalesRevision(dev: any) {
    let antes = 0
    let despues = 0
    let aceptados = 0
    for (const it of dev.items || []) {
      antes += Number(it.cantidad || 0) * precio(it)
      const r = rev[it.id]
      if (r?.aceptar && (r.cantidad ?? 0) > 0) {
        despues += (r.cantidad ?? 0) * precio(it)
        aceptados++
      }
    }
    return { antes: redondear(antes), despues: redondear(despues), aceptados, total: (dev.items || []).length }
  }

  async function confirmarRevision(dev: any) {
    const items = dev.items || []
    for (const it of items) {
      const r = rev[it.id]
      if (!r?.aceptar) continue
      const c = r.cantidad ?? 0
      if (!(c > 0)) {
        toast({ title: "Cantidad inválida", description: `${it.articulos?.descripcion || "Renglón"}: para no aceptar nada, rechazá el renglón.`, variant: "destructive" })
        return
      }
      if (c > Math.max(cantidadOriginal(it), Number(it.cantidad) || 0)) {
        toast({ title: "Cantidad inválida", description: `${it.articulos?.descripcion || "Renglón"}: no se puede aceptar más de lo devuelto.`, variant: "destructive" })
        return
      }
    }
    const t = totalesRevision(dev)
    const pregunta =
      t.aceptados === 0
        ? `Rechazaste todos los renglones: ${dev.numero_devolucion} queda RECHAZADA. ¿Seguir?`
        : `¿Aceptar ${t.aceptados} de ${t.total} renglón(es) de ${dev.numero_devolucion} por ${formatCurrency(t.despues)} (cargado ${formatCurrency(t.antes)})? Se suma al stock lo aceptado y vendible; después emitís la NC/Reversa.`
    if (t.aceptados === 0 && !motivoGeneral.trim() && !items.some((it: any) => rev[it.id]?.motivo?.trim())) {
      toast({ title: "Falta el motivo", description: "Para rechazar todo, escribí el motivo.", variant: "destructive" })
      return
    }
    if (!window.confirm(pregunta)) return

    setProcesando(dev.id)
    try {
      const renglones = items.map((it: any) => {
        const r = rev[it.id]
        return {
          id: it.id,
          aceptar: !!r?.aceptar,
          cantidad_aceptada: r?.aceptar ? r.cantidad : 0,
          condicion: r?.condicion ?? condicionDe(it),
          motivo: r?.motivo?.trim() || null,
        }
      })
      const res = await fetch(`/api/devoluciones/${dev.id}/confirmar`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "confirmar", renglones, motivo: motivoGeneral.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.estado === "rechazado") {
        toast({ title: "Rechazada", description: dev.numero_devolucion })
      } else {
        toast({ title: "Aceptada", description: `Quedó en ${formatCurrency(data.monto_total)}. Ahora podés emitir la NC/Reversa.` })
      }
      if (Number(data.descontado_de_mas) > 0) {
        toast({ title: "Ojo: descontado de más", description: `Ya se habían descontado ${formatCurrency(data.descontado_de_mas)} en cobros del cliente. Los pagos no se tocaron.`, variant: "destructive" })
      }
      cancelarRevision()
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcesando(null) }
  }

  // Pendiente NC → emitir el documento que corresponda. El tipo lo decide el
  // sistema solo ('auto'): venta por Factura A/B → NCA/NCB (con CAE), venta por
  // Presupuesto → Reversa; sin comprobante de origen, por el método/condición
  // IVA del cliente. Genera todo en el acto: documento, cta cte, kardex, comisiones.
  async function emitirDocumento(dev: any) {
    if (!window.confirm(`¿Emitir el comprobante de ${dev.numero_devolucion}? Se emite la NC o Reversa según corresponda (solo por lo aceptado) y se acredita en la cuenta corriente del cliente.`)) return
    setProcesando(dev.id)
    try {
      const res = await fetch("/api/comprobantes-venta/generar-nc-reversa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devolucion_id: dev.id,
          tipo_comprobante: "auto",
          motivo_ajuste: `Devolución ${dev.numero_devolucion || dev.id.slice(0, 8)}`,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: "Emitida", description: `${data.comprobante?.tipo || "NC"} ${data.comprobante?.numero || ""} por ${formatCurrency(Math.abs(data.comprobante?.total ?? 0))}` })
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcesando(null) }
  }

  async function rechazar(dev: any) {
    const motivo = window.prompt(`Motivo de rechazo de ${dev.numero_devolucion} (se rechazan todos los renglones):`)
    if (motivo === null) return
    if (!motivo.trim()) { toast({ title: "Error", description: "El motivo es obligatorio", variant: "destructive" }); return }
    setProcesando(dev.id)
    try {
      const res = await fetch(`/api/devoluciones/${dev.id}/confirmar`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "rechazar", motivo_rechazo: motivo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: "Rechazada", description: dev.numero_devolucion })
      if (Number(data.descontado_de_mas) > 0) {
        toast({ title: "Ojo: descontado de más", description: `Ya se habían descontado ${formatCurrency(data.descontado_de_mas)} en cobros del cliente. Los pagos no se tocaron.`, variant: "destructive" })
      }
      if (revisando === dev.id) cancelarRevision()
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcesando(null) }
  }

  async function eliminar(dev: any) {
    const extra = dev.estado === "confirmado" ? " Se revierte el stock que se sumó al aceptarla." : ""
    if (!window.confirm(`¿Eliminar ${dev.numero_devolucion} de ${dev.clientes?.nombre || dev.clientes?.razon_social}?${extra}`)) return
    setProcesando(dev.id)
    try {
      const res = await fetch(`/api/devoluciones/${dev.id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: "Eliminada", description: dev.numero_devolucion })
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcesando(null) }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  const btn = "h-7 px-2.5 rounded-md text-xs font-semibold border disabled:opacity-40"
  const chip = "h-6 px-2 rounded text-[11px] font-semibold border"

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><CargaProgreso mensajes={MENSAJES.devoluciones} titulo="Cargando devoluciones" /></div>
  }

  return (
    <div className="container mx-auto px-6 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Revisión de devoluciones</h1>
        <p className="text-sm text-muted-foreground">
          Depósito (o la oficina) revisa la mercadería renglón por renglón (Pendiente depósito) y acá se emite la NC/Reversa de lo aceptado (Pendiente NC).
        </p>
      </div>

      {devoluciones.length === 0 ? (
        <div className="border rounded-lg py-12 text-center text-muted-foreground">No hay devoluciones en revisión</div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8" />
                <th className="text-left px-2 py-2 font-semibold">N°</th>
                <th className="text-left px-2 py-2 font-semibold">Fecha</th>
                <th className="text-left px-2 py-2 font-semibold">Viajante</th>
                <th className="text-left px-2 py-2 font-semibold">Cliente</th>
                <th className="text-right px-2 py-2 font-semibold">Artíc.</th>
                <th className="text-right px-2 py-2 font-semibold">Total</th>
                <th className="text-left px-3 py-2 font-semibold">Estado</th>
                <th className="text-right px-3 py-2 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {devoluciones.map((dev) => {
                const est = ESTADO_UI[dev.estado] || { label: dev.estado, cls: "bg-slate-100 text-slate-600 border-slate-300" }
                const abiertaEsta = abierta === dev.id
                const ocupada = procesando === dev.id
                const enRevision = revisando === dev.id
                const pendiente = dev.estado === "pendiente"
                const deMas = Number(dev.descontado_de_mas) || 0
                const t = enRevision ? totalesRevision(dev) : null
                return (
                  <Fragment key={dev.id}>
                    <tr
                      onClick={() => setAbierta(abiertaEsta ? null : dev.id)}
                      className={`border-t cursor-pointer hover:bg-slate-50 ${abiertaEsta ? "bg-slate-50" : ""}`}
                    >
                      <td className="pl-2 text-slate-400">{abiertaEsta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="px-2 py-2 font-mono text-xs">{dev.numero_devolucion || dev.id.slice(0, 8)}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{fecha(dev.created_at)}</td>
                      <td className="px-2 py-2">{dev.vendedor?.nombre || "—"}</td>
                      <td className="px-2 py-2 font-medium">{dev.clientes?.nombre || dev.clientes?.razon_social || "—"}</td>
                      <td className="px-2 py-2 text-right">{dev.items?.length ?? 0}</td>
                      <td className="px-2 py-2 text-right font-bold whitespace-nowrap">{formatCurrency(Number(dev.monto_total || 0))}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${est.cls}`}>{est.label}</span>
                        {dev.estado === "confirmado" && (dev.confirmado_por || dev.fecha_confirmacion) && (
                          <div className="text-[10px] text-slate-500 mt-0.5 whitespace-nowrap">
                            Aceptó {dev.confirmado_por || "—"}{dev.fecha_confirmacion ? ` · ${fechaHora(dev.fecha_confirmacion)}` : ""}
                          </div>
                        )}
                        {deMas > 0 && (
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-red-600 mt-0.5 whitespace-nowrap" title="Ya se descontó en cobros más de lo que se aceptó. Los pagos no se tocan solos.">
                            <AlertTriangle className="h-3 w-3" /> Descontado de más: {formatCurrency(deMas)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5 items-center">
                          {ocupada && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                          {pendiente ? (
                            <button
                              className={`${btn} bg-emerald-50 border-emerald-300 text-emerald-700`}
                              disabled={ocupada || enRevision}
                              title="Revisar renglón por renglón: aceptar, rechazar, cantidad y condición"
                              onClick={() => empezarRevision(dev)}
                            >
                              Revisar
                            </button>
                          ) : (
                            <button
                              className={`${btn} bg-emerald-50 border-emerald-300 text-emerald-700`}
                              disabled={ocupada}
                              title="Emite NC o Reversa por lo aceptado, según la venta de origen, y acredita la cta cte"
                              onClick={() => emitirDocumento(dev)}
                            >
                              Emitir NC
                            </button>
                          )}
                          <button
                            className={`${btn} bg-red-50 border-red-300 text-red-700`}
                            disabled={ocupada || !pendiente}
                            title={pendiente ? "Rechazar toda la devolución" : "Ya fue aceptada: no se puede rechazar"}
                            onClick={() => rechazar(dev)}
                          >
                            Rechazar
                          </button>
                          <button className={`${btn} border-red-200 text-red-500`} disabled={ocupada} onClick={() => eliminar(dev)}>Eliminar</button>
                        </div>
                      </td>
                    </tr>
                    {abiertaEsta && (
                      <tr className="bg-slate-50/60">
                        <td />
                        <td colSpan={8} className="px-2 pb-3">
                          <table className="w-full text-xs bg-white border rounded-md overflow-hidden">
                            <thead className="text-[10px] uppercase text-slate-400">
                              <tr>
                                <th className="text-left px-2 py-1.5">Artículo</th>
                                <th className="text-left px-2 py-1.5">SKU</th>
                                {enRevision && <th className="text-left px-2 py-1.5">Decisión</th>}
                                <th className="text-right px-2 py-1.5">Cantidad</th>
                                <th className="text-right px-2 py-1.5">Precio</th>
                                <th className="text-right px-2 py-1.5">Subtotal</th>
                                <th className="text-left px-2 py-1.5">Condición</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(dev.items || []).map((it: any) => {
                                const r = rev[it.id]
                                const rechazadoGuardado = it.estado_renglon === "rechazado"
                                const rechazado = enRevision ? !r?.aceptar : rechazadoGuardado
                                const cant = enRevision ? (r?.aceptar ? r.cantidad ?? 0 : 0) : Number(it.cantidad)
                                const orig = cantidadOriginal(it)
                                const cond = enRevision ? r?.condicion ?? condicionDe(it) : condicionDe(it)
                                return (
                                  <tr key={it.id} className={`border-t align-top ${rechazado ? "bg-red-50/40" : ""}`}>
                                    <td className={`px-2 py-1.5 font-medium ${rechazado ? "line-through text-slate-400" : ""}`}>
                                      {it.articulos?.descripcion || it.articulos?.nombre || "—"}
                                      {!enRevision && it.motivo_revision ? <div className="text-[10px] text-slate-500 italic no-underline">Revisión: {it.motivo_revision}</div> : null}
                                      {enRevision && (
                                        <input
                                          value={r?.motivo ?? ""}
                                          onChange={(e) => setRenglon(it.id, { motivo: e.target.value })}
                                          placeholder={r?.aceptar ? "Motivo (opcional, ej. 1 vencido)" : "Motivo del rechazo"}
                                          className="mt-1 w-full border rounded px-1.5 py-0.5 text-[11px] font-normal"
                                        />
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 font-mono text-slate-500">{it.articulos?.sku || "—"}</td>
                                    {enRevision && (
                                      <td className="px-2 py-1.5">
                                        <div className="flex gap-1">
                                          <button
                                            className={`${chip} ${r?.aceptar ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300 text-slate-500"}`}
                                            onClick={() => setRenglon(it.id, { aceptar: true, cantidad: r?.cantidad && r.cantidad > 0 ? r.cantidad : Number(it.cantidad) || 0 })}
                                          >
                                            Aceptar
                                          </button>
                                          <button
                                            className={`${chip} ${!r?.aceptar ? "bg-red-600 border-red-600 text-white" : "border-slate-300 text-slate-500"}`}
                                            onClick={() => setRenglon(it.id, { aceptar: false })}
                                          >
                                            Rechazar
                                          </button>
                                        </div>
                                      </td>
                                    )}
                                    <td className="px-2 py-1.5 text-right">
                                      {enRevision && r?.aceptar ? (
                                        <div className="flex justify-end items-center gap-1">
                                          <InputMonto
                                            value={r.cantidad}
                                            onChange={(v) => setRenglon(it.id, { cantidad: v })}
                                            decimales={3}
                                            soloPositivos
                                            placeholder="0"
                                            className="h-7 w-16 px-1 text-right text-xs font-semibold"
                                          />
                                          <span className="text-slate-400 whitespace-nowrap">de {numero(Number(it.cantidad), 0, 3)}</span>
                                        </div>
                                      ) : (
                                        <span>
                                          {numero(cant, 0, 3)}
                                          {!enRevision && orig !== Number(it.cantidad) && (
                                            <span className="text-slate-400"> (cargó {numero(orig, 0, 3)})</span>
                                          )}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-right">{formatCurrency(precio(it))}</td>
                                    <td className="px-2 py-1.5 text-right font-semibold">{formatCurrency(cant * precio(it))}</td>
                                    <td className="px-2 py-1.5">
                                      {enRevision && r?.aceptar ? (
                                        <div className="flex gap-1">
                                          <button
                                            className={`${chip} ${cond === "vendible" ? "bg-green-100 border-green-500 text-green-700" : "border-slate-300 text-slate-400"}`}
                                            onClick={() => setRenglon(it.id, { condicion: "vendible" })}
                                          >
                                            Vendible
                                          </button>
                                          <button
                                            className={`${chip} ${cond === "no_vendible" ? "bg-red-100 border-red-500 text-red-700" : "border-slate-300 text-slate-400"}`}
                                            onClick={() => setRenglon(it.id, { condicion: "no_vendible" })}
                                          >
                                            No vendible
                                          </button>
                                        </div>
                                      ) : rechazado ? (
                                        <span className="text-red-600 font-medium">Rechazado</span>
                                      ) : cond === "no_vendible" ? (
                                        <span className="text-red-600 font-medium">No vendible</span>
                                      ) : (
                                        <span className="text-green-700">Vendible</span>
                                      )}
                                      {it.motivo ? <span className="text-slate-400 italic"> · {it.motivo}</span> : null}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                          <div className="flex items-center justify-between gap-3 mt-1.5">
                            <p className="text-[11px] text-slate-400">
                              {dev.observaciones || ""}
                              {dev.retira_viajante ? (dev.observaciones ? " · " : "") + "Retiró mercadería el viajante" : ""}
                              {Number(dev.descontado) > 0 ? `${dev.observaciones || dev.retira_viajante ? " · " : ""}Ya descontado en cobros: ${formatCurrency(Number(dev.descontado))}` : ""}
                            </p>
                            {enRevision && t && (
                              <div className="flex items-center gap-2">
                                <input
                                  value={motivoGeneral}
                                  onChange={(e) => setMotivoGeneral(e.target.value)}
                                  placeholder={t.aceptados === 0 ? "Motivo del rechazo (obligatorio)" : "Observación general (opcional)"}
                                  className="h-7 w-56 border rounded px-2 text-xs"
                                />
                                <span className="text-xs text-slate-500 whitespace-nowrap">
                                  Cargado {formatCurrency(t.antes)} → <b className="text-slate-800">{formatCurrency(t.despues)}</b>
                                  {" "}({t.aceptados}/{t.total} aceptados)
                                </span>
                                <button className={`${btn} border-slate-300 text-slate-600`} onClick={cancelarRevision}>Cancelar</button>
                                <button
                                  className={`${btn} ${t.aceptados === 0 ? "bg-red-600 border-red-600" : "bg-indigo-600 border-indigo-600"} text-white`}
                                  disabled={ocupada}
                                  onClick={() => confirmarRevision(dev)}
                                >
                                  {t.aceptados === 0 ? "Rechazar todo" : "Confirmar revisión"}
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
