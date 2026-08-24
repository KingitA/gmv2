"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { useBackTrap } from "@/lib/vendedor/use-back-trap"

interface Movimiento {
  id: string
  tipo: string
  medio: string | null
  monto: number
  concepto: string | null
  fecha: string
}

interface BilleteraData {
  balance: number
  desglose: { efectivo: number; cheques: number; transferencias: number }
  pagos_sin_rendir: number
  en_viaje: { total: number; cantidad: number }
  comisiones_pendientes: any[]
  total_pendiente_comisiones: number
  historial: Movimiento[]
}

interface PedidoComision {
  pedido_id: string
  numero_pedido: string
  cliente_id: string | null
  cliente_nombre: string
  fecha: string
  fecha_cobro: string | null
  total_monto: number
  total_comision: number
  total_debito_contado?: number
  cantidad_skus: number
}

interface ArticuloComision {
  kardex_id: string
  sku: string
  descripcion: string
  categoria: string
  cantidad: number
  precio_unitario: number
  subtotal: number
  comision_pct: number
  /** Neto que efectivamente cobra (ya descontado el débito por pago contado) */
  comision_monto: number
  comision_pactada?: number
  descuento_financiero_pct?: number
}

interface ComisionesData {
  tipo: string
  totales: { disponible: number; sin_cobrar: number; retirado: number }
  pedidos: PedidoComision[]
}

interface DetalleData {
  tipo: string
  articulos?: ArticuloComision[]
  comprobantes?: {
    comprobante_id: string
    numero: string
    fecha_cobro: string
    total_neto: number
    total_iva: number
    total: number
    total_comision: number
    debito_contado?: number
    articulos: ArticuloComision[]
  }[]
}

const TIPO_LABEL: Record<string, { label: string; icon: string; color: string }> = {
  cobro_cliente: { label: "Cobro cliente", icon: "💵", color: "text-green-600" },
  retiro_comision: { label: "Retiro comisión", icon: "🏦", color: "text-red-600" },
  debito: { label: "Débito", icon: "➖", color: "text-red-600" },
  credito: { label: "Crédito", icon: "➕", color: "text-green-600" },
}

const fechaCorta = (f: string | null) =>
  f ? new Date(f + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "—"

function VendedorBilleteraInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<BilleteraData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // ?tab=comisiones abre directo la pestaña de comisiones (link de estadísticas)
  const [tab, setTab] = useState<"movimientos" | "comisiones">(
    searchParams.get("tab") === "comisiones" ? "comisiones" : "movimientos"
  )

  // Comisiones reales (kardex, formato playroom)
  const [comData, setComData] = useState<ComisionesData | null>(null)
  const [comTipo, setComTipo] = useState<"cobrada" | "vendida">("cobrada")
  const [comLoading, setComLoading] = useState(false)
  const [pedidoSel, setPedidoSel] = useState<PedidoComision | null>(null)

  // "Atrás" físico: cierra el detalle del pedido antes de salir de la billetera
  useBackTrap(() => {
    if (pedidoSel) { setPedidoSel(null); return true }
    return false
  })
  const [detalle, setDetalle] = useState<DetalleData | null>(null)
  const [detalleLoading, setDetalleLoading] = useState(false)

  useEffect(() => {
    fetch("/api/vendedor/billetera")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError("Error al cargar la billetera"))
      .finally(() => setLoading(false))
  }, [])

  // Carga (y recarga al cambiar el toggle) de comisiones reales
  useEffect(() => {
    if (tab !== "comisiones") return
    setComLoading(true)
    fetch(`/api/vendedor/comisiones?tipo=${comTipo}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setComData(d)
      })
      .catch(() => {})
      .finally(() => setComLoading(false))
  }, [tab, comTipo])

  const abrirPedido = async (p: PedidoComision) => {
    setPedidoSel(p)
    setDetalle(null)
    setDetalleLoading(true)
    try {
      const r = await fetch(`/api/vendedor/comisiones/detalle?pedido_id=${p.pedido_id}&tipo=${comTipo}`)
      const d = await r.json()
      if (!d.error) setDetalle(d)
    } catch {
    } finally {
      setDetalleLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8 text-center">
        <p className="text-red-500 text-xl">{error || "Sin datos"}</p>
      </div>
    )
  }

  // ── Drill-down: detalle de un pedido ────────────────────────────────
  if (pedidoSel) {
    const ItemRow = ({ a }: { a: ArticuloComision }) => (
      <div className="bg-white rounded-xl border border-gray-200 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-gray-900 text-sm leading-snug">{a.descripcion}</p>
            <p className="text-gray-400 text-xs mt-0.5">
              SKU {a.sku} · {a.categoria} · ×{a.cantidad} · {formatCurrency(a.precio_unitario)} c/u
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-gray-500 text-xs">{formatCurrency(a.subtotal)}</p>
            <p className="text-emerald-700 font-bold text-sm">
              {a.comision_pct ? `${a.comision_pct}% · ` : ""}
              {formatCurrency(a.comision_monto)}
            </p>
            {(a.descuento_financiero_pct || 0) > 0 && (
              <p className="text-amber-600 text-[10px] leading-tight">
                pactada {formatCurrency(a.comision_pactada || 0)} − {a.descuento_financiero_pct}% contado
              </p>
            )}
          </div>
        </div>
      </div>
    )

    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-emerald-700 text-white px-5 py-3 sticky top-0 z-10 shadow-md flex items-center gap-3">
          <button onClick={() => setPedidoSel(null)} className="text-2xl leading-none px-1">←</button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">
              Pedido {pedidoSel.numero_pedido !== "—" ? `#${pedidoSel.numero_pedido}` : ""}
            </h1>
            <p className="text-emerald-200 text-xs truncate">{pedidoSel.cliente_nombre}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-emerald-200 text-[10px]">Comisión</p>
            <p className="font-bold">{formatCurrency(pedidoSel.total_comision)}</p>
          </div>
        </header>

        <div className="p-4 space-y-3 max-w-2xl mx-auto">
          {detalleLoading ? (
            <div className="text-center py-12">
              <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : detalle?.tipo === "vendida" ? (
            (detalle.articulos || []).map((a) => <ItemRow key={a.kardex_id} a={a} />)
          ) : (
            (detalle?.comprobantes || []).map((c) => (
              <div key={c.comprobante_id} className="space-y-2">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-emerald-900 text-sm">{c.numero}</p>
                    <p className="text-emerald-700 text-xs">
                      Cobrado {fechaCorta(c.fecha_cobro)} · Neto {formatCurrency(c.total_neto)} + IVA{" "}
                      {formatCurrency(c.total_iva)}
                    </p>
                    {(c.debito_contado || 0) > 0 && (
                      <p className="text-amber-700 text-xs mt-0.5">
                        Débito 10% pago contado: −{formatCurrency(c.debito_contado || 0)}
                      </p>
                    )}
                  </div>
                  <p className="font-bold text-emerald-700">{formatCurrency(c.total_comision)}</p>
                </div>
                {c.articulos.map((a) => (
                  <ItemRow key={a.kardex_id} a={a} />
                ))}
              </div>
            ))
          )}
          {!detalleLoading &&
            ((detalle?.tipo === "vendida" && !detalle.articulos?.length) ||
              (detalle?.tipo === "cobrada" && !detalle.comprobantes?.length)) && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
                Sin ítems con comisión para este pedido.
              </div>
            )}
          <button
            onClick={() => router.push(`/vendedor/pedidos/${pedidoSel.pedido_id}`)}
            className="w-full bg-white border border-emerald-600 text-emerald-700 rounded-xl py-3 font-bold"
          >
            Ver el pedido completo →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-700 text-white px-5 py-3 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.push("/vendedor")} className="text-2xl leading-none px-1">←</button>
        <h1 className="text-xl font-bold">Mi Billetera</h1>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Saldo */}
        <section className="bg-emerald-700 text-white rounded-2xl shadow-md p-6 text-center">
          <p className="text-emerald-200 text-sm">Plata en la calle</p>
          <p className="text-4xl font-bold mt-1">{formatCurrency(data.balance)}</p>
          <p className="text-emerald-200 text-xs mt-1">
            {data.pagos_sin_rendir
              ? `${data.pagos_sin_rendir} ${data.pagos_sin_rendir === 1 ? "cobro" : "cobros"} sin rendir a oficina`
              : "No tenés cobros sin rendir"}
          </p>
          <div className="grid grid-cols-3 gap-2 mt-4 text-sm">
            <div className="bg-emerald-600/60 rounded-xl px-2 py-2">
              <p className="text-emerald-200 text-xs">💵 Efectivo</p>
              <p className="font-bold text-sm">{formatCurrency(data.desglose.efectivo)}</p>
            </div>
            <div className="bg-emerald-600/60 rounded-xl px-2 py-2">
              <p className="text-emerald-200 text-xs">🧾 Cheques</p>
              <p className="font-bold text-sm">{formatCurrency(data.desglose.cheques)}</p>
            </div>
            <div className="bg-emerald-600/60 rounded-xl px-2 py-2">
              <p className="text-emerald-200 text-xs">🏦 Transf.</p>
              <p className="font-bold text-sm">{formatCurrency(data.desglose.transferencias)}</p>
            </div>
          </div>
          {data.en_viaje?.total > 0 && (
            <div className="bg-amber-400/20 border border-amber-300/40 rounded-xl px-3 py-2 mt-3 text-sm">
              <p className="text-amber-100">
                📦 En viaje a oficina: <span className="font-bold">{formatCurrency(data.en_viaje.total)}</span>{" "}
                ({data.en_viaje.cantidad} {data.en_viaje.cantidad === 1 ? "cobro" : "cobros"}) — esperando
                confirmación
              </p>
            </div>
          )}
          <button
            onClick={() => router.push("/vendedor/rendiciones")}
            className="w-full bg-white text-emerald-700 rounded-xl py-3 font-bold mt-4 active:scale-[0.98] transition-transform"
          >
            🧾 Rendiciones
          </button>
          <p className="text-emerald-200 text-xs mt-2">
            Vos rendís el dinero; oficina lo confirma al recibirlo (doble firma).
          </p>
        </section>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab("movimientos")}
            className={`flex-1 py-3 rounded-xl font-bold text-sm ${
              tab === "movimientos" ? "bg-emerald-600 text-white" : "bg-white text-gray-600 border border-gray-200"
            }`}
          >
            Movimientos
          </button>
          <button
            onClick={() => setTab("comisiones")}
            className={`flex-1 py-3 rounded-xl font-bold text-sm ${
              tab === "comisiones" ? "bg-emerald-600 text-white" : "bg-white text-gray-600 border border-gray-200"
            }`}
          >
            Comisiones
          </button>
        </div>

        {tab === "movimientos" ? (
          data.historial.length ? (
            <div className="space-y-2">
              {data.historial.map((m) => {
                const t = TIPO_LABEL[m.tipo] || { label: m.tipo, icon: "•", color: "text-gray-600" }
                return (
                  <div
                    key={m.id}
                    className="bg-white rounded-xl border border-gray-200 p-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xl">{t.icon}</span>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{m.concepto || t.label}</p>
                        <p className="text-gray-400 text-xs">
                          {new Date(m.fecha).toLocaleDateString("es-AR")} · {t.label}
                          {m.medio ? ` · ${m.medio}` : ""}
                        </p>
                      </div>
                    </div>
                    <p className={`font-bold shrink-0 ml-2 ${Number(m.monto) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(Number(m.monto))}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
              Sin movimientos todavía.
            </div>
          )
        ) : (
          <>
            {/* KPIs de comisiones reales */}
            {comData && (
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-emerald-600 text-white rounded-xl p-3 text-center">
                  <p className="text-[11px] text-emerald-100 leading-tight">💰 Para retirar</p>
                  <p className="font-bold text-sm mt-1">{formatCurrency(comData.totales.disponible)}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-gray-500 leading-tight">🕐 Sin cobrar</p>
                  <p className="font-bold text-sm mt-1 text-gray-800">
                    hasta {formatCurrency(comData.totales.sin_cobrar)}
                  </p>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-gray-500 leading-tight">✓ Retirado</p>
                  <p className="font-bold text-sm mt-1 text-gray-800">{formatCurrency(comData.totales.retirado)}</p>
                </div>
                <p className="col-span-3 text-gray-400 text-[11px] px-1 -mt-0.5">
                  "Sin cobrar" es un estimado máximo: puede bajar si el cliente paga contado (−10% de esa
                  comisión). "Para retirar" y "Retirado" son netos: es la plata que efectivamente cobrás.
                </p>
              </div>
            )}

            {/* Toggle mercadería cobrada / vendida */}
            <div className="flex gap-2">
              {(["cobrada", "vendida"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setComTipo(t)}
                  className={`flex-1 py-2 rounded-full text-xs font-bold border ${
                    comTipo === t
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-600 border-gray-300"
                  }`}
                >
                  {t === "cobrada" ? "Mercadería cobrada" : "Mercadería vendida"}
                </button>
              ))}
            </div>

            {comLoading ? (
              <div className="text-center py-10">
                <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : comData?.pedidos.length ? (
              <div className="space-y-2">
                {comData.pedidos.map((p) => (
                  <button
                    key={p.pedido_id}
                    onClick={() => abrirPedido(p)}
                    className="w-full bg-white rounded-xl border border-gray-200 p-3 text-left active:scale-[0.98]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 text-sm truncate">{p.cliente_nombre}</p>
                        <p className="text-gray-400 text-xs mt-0.5">
                          {p.numero_pedido !== "—" ? `#${p.numero_pedido} · ` : ""}
                          {comTipo === "cobrada" ? `cobrado ${fechaCorta(p.fecha_cobro)}` : fechaCorta(p.fecha)} ·{" "}
                          {p.cantidad_skus} SKUs
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-gray-500 text-xs">{formatCurrency(p.total_monto)}</p>
                        <p className="text-emerald-700 font-bold">{formatCurrency(p.total_comision)}</p>
                        {(p.total_debito_contado || 0) > 0 && (
                          <p className="text-amber-600 text-[10px] leading-tight">
                            neto (−10% contado aplicado)
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
                {comTipo === "cobrada"
                  ? "Todavía no hay mercadería cobrada con comisión."
                  : "Sin ventas con comisión registradas."}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function VendedorBilleteraPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <VendedorBilleteraInner />
    </Suspense>
  )
}
