"use client"

/**
 * Revisión de devoluciones — lista compacta.
 * Una fila por devolución (fecha, viajante, cliente, artículos, total, estado);
 * click en la fila despliega los renglones. Acciones por fila:
 *  - Confirmar: pendiente depósito → marca controlada (devuelve stock de vendibles);
 *               pendiente NC → emite la NC fiscal (CAE) o la Reversa.
 *  - Rechazar / Editar (solo pendiente) / Eliminar (revierte stock si ya estaba controlada).
 * El comprobante asociado (RG 4540) lo resuelve solo el generador de NC.
 */

import { useEffect, useState } from "react"
import { Loader2, ChevronDown, ChevronRight } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"

const ESTADO_UI: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente depósito", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  confirmado: { label: "Pendiente NC", cls: "bg-blue-100 text-blue-800 border-blue-300" },
}

export default function RevisionDevolucionesPage() {
  const [devoluciones, setDevoluciones] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  // Mini menú "Confirmar" (pendiente NC): elegir NC fiscal o Reversa
  const [eligiendoDoc, setEligiendoDoc] = useState<string | null>(null)
  // Edición inline de cantidades (solo pendiente)
  const [editando, setEditando] = useState<string | null>(null)
  const [cantEdits, setCantEdits] = useState<Record<string, string>>({})
  const [quitar, setQuitar] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    try {
      const res = await fetch("/api/devoluciones?estado=revision")
      const data = await res.json()
      setDevoluciones(Array.isArray(data) ? data : [])
    } catch {
      toast({ title: "Error", description: "No se pudieron cargar las devoluciones", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "2-digit" })

  // ── Acciones ────────────────────────────────────────────────────────────────

  // Pendiente depósito → confirmar el control (mismo efecto que depósito: stock de vendibles)
  async function confirmarControl(dev: any) {
    if (!window.confirm(`¿Confirmar el control de ${dev.numero_devolucion}? Devuelve el stock de los artículos vendibles y pasa a "Pendiente NC".`)) return
    setProcesando(dev.id)
    try {
      const res = await fetch(`/api/devoluciones/${dev.id}/confirmar`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario_confirmador: "admin", accion: "confirmar" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: "Controlada", description: "Stock devuelto. Ahora podés emitir la NC/Reversa." })
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcesando(null) }
  }

  // Pendiente NC → emitir documento (el comprobante asociado lo resuelve el generador)
  async function emitirDocumento(dev: any, tipo: "NC" | "Reversa") {
    setEligiendoDoc(null)
    setProcesando(dev.id)
    try {
      const res = await fetch("/api/comprobantes-venta/generar-nc-reversa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devolucion_id: dev.id,
          tipo_comprobante: tipo === "Reversa" ? "REV" : "auto",
          motivo_ajuste: `Devolución ${dev.numero_devolucion || dev.id.slice(0, 8)}`,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: "Emitida", description: `${data.comprobante?.tipo || tipo} ${data.comprobante?.numero || ""} por ${formatCurrency(Math.abs(data.comprobante?.total ?? 0))}` })
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcesando(null) }
  }

  async function rechazar(dev: any) {
    const motivo = window.prompt(`Motivo de rechazo de ${dev.numero_devolucion}:`)
    if (motivo === null) return
    if (!motivo.trim()) { toast({ title: "Error", description: "El motivo es obligatorio", variant: "destructive" }); return }
    setProcesando(dev.id)
    try {
      const res = await fetch(`/api/devoluciones/${dev.id}/confirmar`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario_confirmador: "admin", accion: "rechazar", motivo_rechazo: motivo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: "Rechazada", description: dev.numero_devolucion })
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcesando(null) }
  }

  async function eliminar(dev: any) {
    const extra = dev.estado === "confirmado" ? " Se revierte el stock que había devuelto depósito." : ""
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

  function empezarEdicion(dev: any) {
    setAbierta(dev.id)
    setEditando(dev.id)
    setQuitar(new Set())
    const init: Record<string, string> = {}
    for (const it of dev.items || []) init[it.id] = String(it.cantidad)
    setCantEdits(init)
  }

  async function guardarEdicion(dev: any) {
    setProcesando(dev.id)
    try {
      const items = (dev.items || [])
        .filter((it: any) => !quitar.has(it.id))
        .map((it: any) => ({ id: it.id, cantidad: parseFloat((cantEdits[it.id] ?? "").replace(",", ".")) }))
        .filter((it: any) => Number.isFinite(it.cantidad) && it.cantidad > 0)
      const res = await fetch(`/api/devoluciones/${dev.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, eliminar: [...quitar] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: "Guardada", description: data.eliminada ? "Quedó sin renglones: se eliminó" : `Nuevo total: ${formatCurrency(data.monto_total)}` })
      setEditando(null)
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcesando(null) }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  const btn = "h-7 px-2.5 rounded-md text-xs font-semibold border disabled:opacity-40"

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }

  return (
    <div className="container mx-auto px-6 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Revisión de devoluciones</h1>
        <p className="text-sm text-muted-foreground">
          Depósito controla la mercadería (Pendiente depósito) y acá se emite la NC/Reversa (Pendiente NC).
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
                const enEdicion = editando === dev.id
                return (
                  <>
                    <tr
                      key={dev.id}
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
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5 items-center">
                          {ocupada && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                          {eligiendoDoc === dev.id ? (
                            <>
                              <button className={`${btn} bg-emerald-600 text-white border-emerald-600`} disabled={ocupada} onClick={() => emitirDocumento(dev, "NC")}>NC fiscal</button>
                              <button className={`${btn} bg-slate-700 text-white border-slate-700`} disabled={ocupada} onClick={() => emitirDocumento(dev, "Reversa")}>Reversa</button>
                              <button className={`${btn} border-slate-300 text-slate-500`} onClick={() => setEligiendoDoc(null)}>×</button>
                            </>
                          ) : (
                            <>
                              <button
                                className={`${btn} bg-emerald-50 border-emerald-300 text-emerald-700`}
                                disabled={ocupada}
                                title={dev.estado === "pendiente" ? "Marcar controlada (devuelve stock de vendibles)" : "Emitir NC fiscal o Reversa"}
                                onClick={() => dev.estado === "pendiente" ? confirmarControl(dev) : setEligiendoDoc(dev.id)}
                              >
                                Confirmar
                              </button>
                              <button className={`${btn} bg-red-50 border-red-300 text-red-700`} disabled={ocupada} onClick={() => rechazar(dev)}>Rechazar</button>
                              <button
                                className={`${btn} border-slate-300 text-slate-600`}
                                disabled={ocupada || dev.estado !== "pendiente"}
                                title={dev.estado !== "pendiente" ? "Solo se edita antes del control de depósito" : "Editar cantidades"}
                                onClick={() => empezarEdicion(dev)}
                              >
                                Editar
                              </button>
                              <button className={`${btn} border-red-200 text-red-500`} disabled={ocupada} onClick={() => eliminar(dev)}>Eliminar</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {abiertaEsta && (
                      <tr key={`${dev.id}-det`} className="bg-slate-50/60">
                        <td />
                        <td colSpan={8} className="px-2 pb-3">
                          <table className="w-full text-xs bg-white border rounded-md overflow-hidden">
                            <thead className="text-[10px] uppercase text-slate-400">
                              <tr>
                                <th className="text-left px-2 py-1.5">Artículo</th>
                                <th className="text-left px-2 py-1.5">SKU</th>
                                <th className="text-right px-2 py-1.5">Cantidad</th>
                                <th className="text-right px-2 py-1.5">Precio</th>
                                <th className="text-right px-2 py-1.5">Subtotal</th>
                                <th className="text-left px-2 py-1.5">Condición</th>
                                {enEdicion && <th className="w-8" />}
                              </tr>
                            </thead>
                            <tbody>
                              {(dev.items || []).map((it: any) => {
                                const quitado = quitar.has(it.id)
                                const cant = enEdicion ? parseFloat((cantEdits[it.id] ?? "").replace(",", ".")) || 0 : Number(it.cantidad)
                                return (
                                  <tr key={it.id} className={`border-t ${quitado ? "opacity-40 line-through" : ""}`}>
                                    <td className="px-2 py-1.5 font-medium">{it.articulos?.descripcion || it.articulos?.nombre || "—"}</td>
                                    <td className="px-2 py-1.5 font-mono text-slate-500">{it.articulos?.sku || "—"}</td>
                                    <td className="px-2 py-1.5 text-right">
                                      {enEdicion && !quitado ? (
                                        <input
                                          value={cantEdits[it.id] ?? ""}
                                          onChange={(e) => setCantEdits(p => ({ ...p, [it.id]: e.target.value.replace(/[^\d.,]/g, "") }))}
                                          className="w-16 border rounded px-1 py-0.5 text-right font-semibold"
                                          inputMode="decimal"
                                        />
                                      ) : Number(it.cantidad)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right">{formatCurrency(Number(it.precio_venta_original || 0))}</td>
                                    <td className="px-2 py-1.5 text-right font-semibold">{formatCurrency(cant * Number(it.precio_venta_original || 0))}</td>
                                    <td className="px-2 py-1.5">
                                      {it.es_vendible === false
                                        ? <span className="text-red-600 font-medium">No vendible</span>
                                        : <span className="text-green-700">Vendible</span>}
                                      {it.motivo ? <span className="text-slate-400 italic"> · {it.motivo}</span> : null}
                                    </td>
                                    {enEdicion && (
                                      <td className="px-1 text-center">
                                        <button
                                          className="text-slate-400 hover:text-red-600"
                                          title={quitado ? "Restaurar" : "Quitar renglón"}
                                          onClick={() => setQuitar(p => { const n = new Set(p); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n })}
                                        >
                                          {quitado ? "↩" : "✕"}
                                        </button>
                                      </td>
                                    )}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                          <div className="flex items-center justify-between mt-1.5">
                            <p className="text-[11px] text-slate-400">
                              {dev.observaciones || ""}
                              {dev.retira_viajante ? (dev.observaciones ? " · " : "") + "Retiró mercadería el viajante" : ""}
                            </p>
                            {enEdicion && (
                              <div className="flex gap-1.5">
                                <button className={`${btn} border-slate-300 text-slate-600`} onClick={() => { setEditando(null); setQuitar(new Set()) }}>Cancelar</button>
                                <button className={`${btn} bg-indigo-600 text-white border-indigo-600`} disabled={ocupada} onClick={() => guardarEdicion(dev)}>Guardar cambios</button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
