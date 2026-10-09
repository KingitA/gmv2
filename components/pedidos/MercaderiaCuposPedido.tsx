"use client"

// Mercadería bonificada de un pedido ya tomado, por CUPO (todo el pedido /
// segmento / proveedor / marca). En cada cupo se eligen los artículos a regalar;
// las unidades las calcula el servidor (% × neto del cupo, repartido parejo) y
// quedan fijas al cerrar el picking. Un cupo sin artículos bloquea la facturación.

import { useCallback, useEffect, useState, useRef } from "react"
import { useDentroDeModal } from "@/lib/hooks/use-dentro-de-modal"
import { useDebounced } from "@/lib/hooks/use-debounced"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, Package, Search, Trash2, AlertTriangle } from "lucide-react"
import { ArticuloResultRow } from "@/components/search/ArticuloResultRow"
import { getCuposMercaderiaPedido, agregarArticuloACupo, quitarArticuloBonificado, type CupoMercaderiaVista } from "@/lib/actions/mercaderia"
import { agregarItemBonificado } from "@/lib/actions/pedidos"
import { moneda } from "@/lib/formato"
import { InputMonto } from "@/components/ui/input-monto"

function Buscador({ onElegir, disabled }: { onElegir: (p: any) => void; disabled?: boolean }) {
  const [q, setQ] = useState("")
  const [res, setRes] = useState<any[]>([])
  const cajaRef = useRef<HTMLDivElement>(null)
  const enModal = useDentroDeModal(cajaRef, res.length > 0)
  const qDeb = useDebounced(q, 300)
  useEffect(() => {
    if (qDeb.trim().length < 2) { setRes([]); return }
    let vivo = true // descarta respuestas de búsquedas viejas
    import("@/lib/actions/productos")
      .then(({ searchProductos }) => searchProductos(qDeb))
      .then((r) => { if (vivo) setRes(r || []) })
      .catch(() => {})
    return () => { vivo = false }
  }, [qDeb])
  const buscar = useCallback((t: string) => {
    setQ(t)
    if (t.trim().length < 2) setRes([])
  }, [])
  return (
    <div ref={cajaRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <Input placeholder="Buscar artículo a regalar..." className="pl-9 h-9" value={q} disabled={disabled} onChange={(e) => buscar(e.target.value)} />
      {res.length > 0 && (
        <div className={`${enModal ? "relative" : "absolute top-full left-0 z-50"} w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-[260px] overflow-auto`}>
          {res.map((p: any) => (
            <div key={p.id} className="px-4 py-3 hover:bg-amber-50 cursor-pointer border-b border-slate-100 last:border-0"
              onClick={() => { onElegir(p); setQ(""); setRes([]) }}>
              <ArticuloResultRow articulo={p} size="sm" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MercaderiaCuposPedido({
  pedidoId,
  editable,
  itemsBonificados,
  onCambio,
}: {
  pedidoId: string
  editable: boolean
  /** renglones bonificados del pedido (para pedidos viejos, sin cupos) */
  itemsBonificados: any[]
  onCambio: () => Promise<void> | void
}) {
  const [data, setData] = useState<{ usaCupos: boolean; cupos: CupoMercaderiaVista[]; pendientes: string[] } | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [qtyManual, setQtyManual] = useState(0)

  const cargar = useCallback(async () => {
    try { setData(await getCuposMercaderiaPedido(pedidoId)) } catch { setData({ usaCupos: false, cupos: [], pendientes: [] }) }
  }, [pedidoId])
  useEffect(() => { cargar() }, [cargar, itemsBonificados.length])

  const accion = async (clave: string, fn: () => Promise<unknown>) => {
    setTrabajando(clave)
    try {
      await fn()
      await cargar()
      await onCambio()
    } catch (e: any) {
      alert(e?.message || "No se pudo actualizar la mercadería bonificada")
    } finally {
      setTrabajando(null)
    }
  }

  if (!data) return null

  // Pedido viejo (sin cupos): se muestran los regalados y se puede agregar con cantidad fija.
  if (!data.usaCupos) {
    if (!itemsBonificados.length && !editable) return null
    return (
      <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-sm space-y-3">
        <div className="flex items-start gap-2">
          <Package className="h-4 w-4 text-amber-600 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Mercadería bonificada</p>
            <p className="text-xs text-amber-700">
              Pedido tomado antes de los cupos por segmento. Cantidades fijas cargadas a mano; para calcularlas por cupo
              usá <b>Repreciar</b> o guardá un cambio de condiciones del pedido.
            </p>
          </div>
        </div>
        {editable && (
          <div className="flex gap-3 items-center">
            <div className="flex-1">
              <Buscador disabled={!!trabajando} onElegir={(p) => {
                if (!(qtyManual > 0)) { alert("Indicá las unidades a regalar"); return }
                accion("manual", () => agregarItemBonificado(pedidoId, p.id, qtyManual, null))
              }} />
            </div>
            <InputMonto decimales={0} soloPositivos className="h-9 w-24 text-center" placeholder="uds." value={qtyManual || ""} onChange={(n) => setQtyManual(Math.trunc(n ?? 0))} />
          </div>
        )}
      </div>
    )
  }

  if (!data.cupos.length) return null

  return (
    <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-sm space-y-4">
      <div className="flex items-start gap-2">
        <Package className="h-4 w-4 text-amber-600 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Mercadería bonificada</p>
          <p className="text-xs text-amber-700">
            Cada cupo regala su % sobre el neto de esa mercadería. Las unidades se calculan solas y quedan fijas al
            terminar el picking, sobre lo que realmente va.
          </p>
        </div>
      </div>

      {data.pendientes.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs font-medium text-red-800">
            Falta elegir qué regalar en {data.pendientes.length === 1 ? "un cupo" : `${data.pendientes.length} cupos`}.
            El pedido no se puede facturar hasta definirlo (o sacar la bonificación de mercadería del pedido).
          </p>
        </div>
      )}

      {data.cupos.map((c) => (
        <div key={c.origen} className={`rounded-lg border px-3 py-3 space-y-2 ${c.articulos.length ? "border-amber-200" : "border-red-200 bg-red-50/40"}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">{c.nombre} · {c.pct}%</p>
            <p className="text-xs text-slate-500">Base {moneda(c.base || 0)} · a bonificar <b className="text-amber-700">{moneda(c.monto || 0)}</b></p>
          </div>
          {c.articulos.length > 0 && (
            <div className="space-y-1">
              {c.articulos.map((a) => (
                <div key={a.detalle_id} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate">{a.sku} · {a.descripcion}</span>
                  <span className="font-semibold tabular-nums">{a.cantidad} u.</span>
                  <span className="text-slate-400 tabular-nums">({moneda(a.precio_neto || 0)} c/u)</span>
                  {editable && (
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!!trabajando}
                      onClick={() => accion(a.detalle_id, () => quitarArticuloBonificado(pedidoId, a.detalle_id))}>
                      {trabajando === a.detalle_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-red-500" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {editable && (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Buscador disabled={!!trabajando} onElegir={(p) => accion(c.origen, () => agregarArticuloACupo(pedidoId, c.origen, p.id))} />
              </div>
              {trabajando === c.origen && <Loader2 className="h-4 w-4 animate-spin text-amber-600" />}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
