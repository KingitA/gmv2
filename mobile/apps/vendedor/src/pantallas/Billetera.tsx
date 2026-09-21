import { useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"
import { useOnline, useParamEstado, useRuntime } from "@gm/core"
import { DS } from "../datasets"
import { useFilaBilletera, useRefrescarAlEntrar } from "../datos/hooks"
import { fechaCorta, formatCurrency, NecesitaConexion, Pantalla, SinDescargar } from "../ui"

// Billetera del viajante (= app/vendedor/billetera/page.tsx). Todo sale de la réplica
// (dataset vendedor_billetera, filas por id):
//   "billetera"                     = GET /api/vendedor/billetera
//   "comisiones:cobrada|vendida"    = GET /api/vendedor/comisiones?tipo=
//   "detalle:<tipo>:<pedidoId>"     = GET /api/vendedor/comisiones/detalle (solo los pedidos más recientes)
// Rutas: /billetera?tab=&comTipo=  ·  /billetera/comisiones/:pedidoId?tipo=  (en la web era `pedidoSel`)

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
  /** Saldo cuenta corriente: efectivo en calle + saldos de rendiciones */
  saldo?: number
  desglose: { efectivo: number; cheques: number; transferencias: number }
  cheques_cantidad?: number
  pagos_sin_rendir: number
  en_viaje: { total: number; cantidad: number }
  deuda_rendiciones?: number
  faltante_declarado?: number
  comisiones_pendientes: unknown[]
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

type ComTipo = "cobrada" | "vendida"

const TIPO_LABEL: Record<string, { label: string; icon: string; color: string }> = {
  cobro_cliente: { label: "Cobro cliente", icon: "💵", color: "text-green-600" },
  retiro_comision: { label: "Retiro comisión", icon: "🏦", color: "text-red-600" },
  debito: { label: "Débito", icon: "➖", color: "text-red-600" },
  credito: { label: "Crédito", icon: "➕", color: "text-green-600" },
}

/** = formatDateAR de la web: fecha (DATE o timestamp) en el día calendario de Argentina. */
function formatDateAR(f: string | null | undefined): string {
  if (!f) return ""
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(f) ? `${f}T12:00:00Z` : f)
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
}

export function Billetera() {
  const navigate = useNavigate()
  // ?tab=comisiones abre directo la pestaña de comisiones (link de estadísticas)
  const [tabParam, setTab] = useParamEstado("tab", "movimientos")
  const tab = tabParam === "comisiones" ? "comisiones" : "movimientos"
  const [comTipoParam, setComTipo] = useParamEstado("comTipo", "cobrada")
  const comTipo: ComTipo = comTipoParam === "vendida" ? "vendida" : "cobrada"
  useRefrescarAlEntrar(DS.billetera)

  const { fila: data, cargando } = useFilaBilletera<BilleteraData>("billetera")
  const { fila: comData, cargando: comCargando } = useFilaBilletera<ComisionesData>(`comisiones:${comTipo}`)

  return (
    <Pantalla titulo="Mi Billetera" dataset={DS.billetera}>
      {cargando ? null : !data ? (
        <SinDescargar que="la billetera" />
      ) : (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
          {/* Saldo */}
          <section className="rounded-2xl bg-emerald-700 p-6 text-center text-white shadow-md">
            <p className="text-sm text-emerald-200">💰 Saldo en billetera</p>
            <p className="mt-1 text-4xl font-bold">{formatCurrency(data.saldo ?? data.balance)}</p>
            {Math.abs((data.saldo ?? data.balance) - data.balance) > 0.005 && (
              <p className="mt-0.5 text-xs text-emerald-200">💵 {formatCurrency(data.balance)} en efectivo en la calle</p>
            )}
            {(data.cheques_cantidad || 0) > 0 && (
              <p className="mt-1 text-sm font-medium text-emerald-100">
                🧾 {data.cheques_cantidad} {data.cheques_cantidad === 1 ? "cheque" : "cheques"} en mano
              </p>
            )}
            <p className="mt-1 text-xs text-emerald-200">
              {data.pagos_sin_rendir
                ? `${data.pagos_sin_rendir} ${data.pagos_sin_rendir === 1 ? "cobro" : "cobros"} sin rendir a oficina`
                : "No tenés cobros sin rendir"}
            </p>
            {data.desglose?.transferencias > 0 && (
              <p className="mt-1 text-xs text-emerald-300/80">🏦 {formatCurrency(data.desglose.transferencias)} transferido directo al banco</p>
            )}
            {data.en_viaje?.total > 0 && (
              <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-400/20 px-3 py-2 text-sm">
                <p className="text-amber-100">
                  📦 En viaje a oficina: <span className="font-bold">{formatCurrency(data.en_viaje.total)}</span> ({data.en_viaje.cantidad}{" "}
                  {data.en_viaje.cantidad === 1 ? "cobro" : "cobros"}) — esperando confirmación
                </p>
              </div>
            )}
            {Math.abs(data.deuda_rendiciones ?? 0) > 0.005 && (
              <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${(data.deuda_rendiciones ?? 0) > 0 ? "border-red-300/40 bg-red-400/20" : "border-sky-300/40 bg-sky-400/20"}`}>
                <p className="text-white">
                  {(data.deuda_rendiciones ?? 0) > 0 ? (
                    <>📒 Saldo de rendiciones: <span className="font-bold">{formatCurrency(data.deuda_rendiciones)}</span> en tu cuenta — lo debés a oficina (retenciones y diferencias).</>
                  ) : (
                    <>✔ Saldo de rendiciones a tu favor: <span className="font-bold">{formatCurrency(Math.abs(data.deuda_rendiciones ?? 0))}</span> (entregaste de más).</>
                  )}
                </p>
              </div>
            )}
            <button onClick={() => navigate("/rendiciones")} className="mt-4 w-full rounded-xl bg-white py-3 font-bold text-emerald-700">
              🧾 Rendiciones
            </button>
            <p className="mt-2 text-xs text-emerald-200">Vos rendís el dinero; oficina lo confirma al recibirlo (doble firma).</p>
          </section>

          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setTab("movimientos")}
              className={`min-h-11 flex-1 rounded-xl py-3 text-sm font-bold ${tab === "movimientos" ? "bg-emerald-600 text-white" : "border border-gray-200 bg-white text-gray-600"}`}
            >
              Movimientos
            </button>
            <button
              onClick={() => setTab("comisiones")}
              className={`min-h-11 flex-1 rounded-xl py-3 text-sm font-bold ${tab === "comisiones" ? "bg-emerald-600 text-white" : "border border-gray-200 bg-white text-gray-600"}`}
            >
              Comisiones
            </button>
          </div>

          {tab === "movimientos" ? (
            data.historial?.length ? (
              <div className="space-y-2">
                {data.historial.map((m) => {
                  const t = TIPO_LABEL[m.tipo] || { label: m.tipo, icon: "•", color: "text-gray-600" }
                  return (
                    <div key={m.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="text-xl">{t.icon}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">{m.concepto || t.label}</p>
                          <p className="text-xs text-gray-400">
                            {formatDateAR(m.fecha)} · {t.label}
                            {m.medio ? ` · ${m.medio}` : ""}
                          </p>
                        </div>
                      </div>
                      <p className={`ml-2 shrink-0 font-bold ${Number(m.monto) >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(Number(m.monto))}</p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">Sin movimientos todavía.</div>
            )
          ) : (
            <>
              {/* KPIs de comisiones reales */}
              {comData && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-emerald-600 p-3 text-center text-white">
                    <p className="text-[11px] leading-tight text-emerald-100">💰 Para retirar</p>
                    <p className="mt-1 text-sm font-bold">{formatCurrency(comData.totales.disponible)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
                    <p className="text-[11px] leading-tight text-gray-500">🕐 Sin cobrar</p>
                    <p className="mt-1 text-sm font-bold text-gray-800">hasta {formatCurrency(comData.totales.sin_cobrar)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
                    <p className="text-[11px] leading-tight text-gray-500">✓ Retirado</p>
                    <p className="mt-1 text-sm font-bold text-gray-800">{formatCurrency(comData.totales.retirado)}</p>
                  </div>
                  <p className="col-span-3 -mt-0.5 px-1 text-[11px] text-gray-400">
                    "Sin cobrar" es un estimado máximo: puede bajar si el cliente paga contado (−10% de esa comisión). "Para retirar" y "Retirado" son
                    netos: es la plata que efectivamente cobrás.
                  </p>
                </div>
              )}

              {/* Toggle mercadería cobrada / vendida */}
              <div className="flex gap-2">
                {(["cobrada", "vendida"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setComTipo(t)}
                    className={`min-h-11 flex-1 rounded-full border py-2 text-xs font-bold ${comTipo === t ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-600"}`}
                  >
                    {t === "cobrada" ? "Mercadería cobrada" : "Mercadería vendida"}
                  </button>
                ))}
              </div>

              {comCargando ? null : !comData ? (
                <SinDescargar que="las comisiones" />
              ) : comData.pedidos?.length ? (
                <div className="space-y-2">
                  {comData.pedidos.map((p) => (
                    <button
                      key={p.pedido_id}
                      onClick={() => navigate(`/billetera/comisiones/${encodeURIComponent(p.pedido_id)}?tipo=${comTipo}`)}
                      className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-gray-900">{p.cliente_nombre}</p>
                          <p className="mt-0.5 text-xs text-gray-400">
                            {p.numero_pedido !== "—" ? `#${p.numero_pedido} · ` : ""}
                            {comTipo === "cobrada" ? `cobrado ${fechaCorta(p.fecha_cobro)}` : fechaCorta(p.fecha)} · {p.cantidad_skus} SKUs
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-gray-500">
                            {formatCurrency(p.total_monto)} <span className="text-gray-300">s/IVA</span>
                          </p>
                          <p className="font-bold text-emerald-700">{formatCurrency(p.total_comision)}</p>
                          {(p.total_debito_contado || 0) > 0 && <p className="text-[10px] leading-tight text-amber-600">neto (−10% contado aplicado)</p>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">
                  {comTipo === "cobrada" ? "Todavía no hay mercadería cobrada con comisión." : "Sin ventas con comisión registradas."}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Pantalla>
  )
}

// ─── Drill-down: detalle de comisión de un pedido ────────────────────────────

function ItemRow({ a }: { a: ArticuloComision }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug text-gray-900">{a.descripcion}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            SKU {a.sku} · {a.categoria} · ×{a.cantidad} · {formatCurrency(a.precio_unitario)} c/u s/IVA
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-gray-500">
            {formatCurrency(a.subtotal)} <span className="text-gray-300">s/IVA</span>
          </p>
          <p className="text-sm font-bold text-emerald-700">
            {a.comision_pct ? `${a.comision_pct}% · ` : ""}
            {formatCurrency(a.comision_monto)}
          </p>
          {(a.descuento_financiero_pct || 0) > 0 && (
            <p className="text-[10px] leading-tight text-amber-600">
              pactada {formatCurrency(a.comision_pactada || 0)} − {a.descuento_financiero_pct}% contado
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

type Remoto = { clave: string; estado: "cargando" | "ok" | "error"; data: DetalleData | null }

export function ComisionPedido() {
  const navigate = useNavigate()
  const { pedidoId = "" } = useParams<{ pedidoId: string }>()
  const [sp] = useSearchParams()
  const tipo: ComTipo = sp.get("tipo") === "vendida" ? "vendida" : "cobrada"
  const online = useOnline()
  const { api } = useRuntime()

  const { fila: lista } = useFilaBilletera<ComisionesData>(`comisiones:${tipo}`)
  const pedidoSel = lista?.pedidos?.find((p) => p.pedido_id === pedidoId) ?? null
  const clave = `detalle:${tipo}:${pedidoId}`
  const { fila: replicado, cargando } = useFilaBilletera<DetalleData>(clave)

  // El servidor solo replica el detalle de los pedidos más recientes: el resto se pide
  // online (solo para mostrarlo). Sin red ⇒ estado vacío claro, nunca un spinner infinito.
  const [remoto, setRemoto] = useState<Remoto | null>(null)
  const falta = !cargando && !replicado && !!pedidoId
  useEffect(() => {
    if (!falta || !online) return
    let vivo = true
    setRemoto({ clave, estado: "cargando", data: null })
    api
      .get<DetalleData & { error?: string }>(`/api/vendedor/comisiones/detalle?pedido_id=${encodeURIComponent(pedidoId)}&tipo=${tipo}`, { timeoutMs: 20_000 })
      .then((d) => vivo && setRemoto(d?.error ? { clave, estado: "error", data: null } : { clave, estado: "ok", data: d }))
      .catch(() => vivo && setRemoto({ clave, estado: "error", data: null }))
    return () => {
      vivo = false
    }
  }, [falta, online, api, clave, pedidoId, tipo])

  const r = remoto?.clave === clave ? remoto : null
  const detalle: DetalleData | null = replicado ?? r?.data ?? null
  const cargandoDetalle = cargando || (!detalle && falta && online && r?.estado !== "error")

  const titulo = `Pedido ${pedidoSel && pedidoSel.numero_pedido !== "—" ? `#${pedidoSel.numero_pedido}` : ""}`.trim()

  return (
    <Pantalla titulo={titulo} dataset={DS.billetera}>
      {pedidoSel && (
        <div className="flex items-center gap-3 bg-emerald-700 px-5 py-3 text-white">
          <p className="min-w-0 flex-1 truncate text-sm text-emerald-100">{pedidoSel.cliente_nombre}</p>
          <div className="shrink-0 text-right">
            <p className="text-[10px] text-emerald-200">Comisión</p>
            <p className="font-bold">{formatCurrency(pedidoSel.total_comision)}</p>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
        {/* Todos los montos de esta pantalla van SIN IVA: la comisión se calcula sobre el neto */}
        <p className="text-center text-xs text-gray-400">
          Precios y subtotales <b>sin IVA</b> — tu % de comisión se aplica sobre estos montos.
        </p>

        {cargandoDetalle ? (
          <p className="py-12 text-center text-gray-500">Cargando el detalle…</p>
        ) : !detalle ? (
          online ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">No se pudo cargar el detalle de este pedido. Probá de nuevo en un rato.</div>
          ) : (
            <NecesitaConexion que="ver el detalle de este pedido" />
          )
        ) : detalle.tipo === "vendida" ? (
          (detalle.articulos || []).map((a) => <ItemRow key={a.kardex_id} a={a} />)
        ) : (
          (detalle.comprobantes || []).map((c) => (
            <div key={c.comprobante_id} className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div>
                  <p className="text-sm font-bold text-emerald-900">{c.numero}</p>
                  <p className="text-xs text-emerald-700">
                    Cobrado {fechaCorta(c.fecha_cobro)} · Neto {formatCurrency(c.total_neto)} + IVA {formatCurrency(c.total_iva)}
                  </p>
                  {(c.debito_contado || 0) > 0 && <p className="mt-0.5 text-xs text-amber-700">Débito 10% pago contado: −{formatCurrency(c.debito_contado || 0)}</p>}
                </div>
                <p className="font-bold text-emerald-700">{formatCurrency(c.total_comision)}</p>
              </div>
              {c.articulos.map((a) => (
                <ItemRow key={a.kardex_id} a={a} />
              ))}
            </div>
          ))
        )}

        {!cargandoDetalle && detalle && ((detalle.tipo === "vendida" && !detalle.articulos?.length) || (detalle.tipo === "cobrada" && !detalle.comprobantes?.length)) && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">Sin ítems con comisión para este pedido.</div>
        )}

        {pedidoId && pedidoId !== "sin_pedido" && (
          <button onClick={() => navigate(`/pedidos/${pedidoId}`)} className="min-h-12 w-full rounded-xl border border-emerald-600 bg-white py-3 font-bold text-emerald-700">
            Ver el pedido completo →
          </button>
        )}
      </div>
    </Pantalla>
  )
}
