"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

// ─── Tipos ────────────────────────────────────────────────────

interface ClienteData {
  cliente: any
  pedido: {
    id: string
    numero: string
    total: number
    bultos: number
    observaciones: string
    detalle: Array<{
      id: string
      articulo_id: string
      cantidad: number
      precio_final: number
      subtotal: number
      articulos: { sku: string; descripcion: string }
    }>
  } | null
  comprobantes_pendientes: Array<{
    id: string
    tipo_comprobante: string
    numero_comprobante: string
    fecha: string
    total_factura: number
    saldo_pendiente: number
  }>
  devoluciones: any[]
  pagos_registrados: any[]
  resumen: {
    saldo_anterior: number
    total_pedido: number
    total_devuelto: number
    total_cobrado: number
    total_a_cobrar: number
    ya_cobrado: boolean
  }
  viaje_estado: string
}

interface ItemDevolucion {
  articulo_id: string
  sku: string
  descripcion: string
  cantidad: number
  precio_venta_original: number
  motivo: string
  condicion: "vendible" | "no_vendible"
  origen: "pedido" | "vieja"
  comprobante_venta_id?: string
}

interface MetodoPago {
  id: string
  tipo: "efectivo" | "transferencia" | "cheque"
  monto: number
  banco_emisor?: string
  numero_cheque?: string
  fecha_cheque?: string
  numero_comprobante?: string
}

const MOTIVOS = ["diferencia_precios", "rotura", "vencido", "no_pedido", "otro"]
const READONLY_ESTADOS = ["completado", "en_rendicion"]

// ─── Componente principal ─────────────────────────────────────

export default function ClienteEntregaPage() {
  const router = useRouter()
  const params = useParams()
  const viajeId = params.viajeId as string
  const clienteId = params.clienteId as string

  const [data, setData] = useState<ClienteData | null>(null)
  const [loading, setLoading] = useState(true)

  // Estados de tabs/sheets
  const [tab, setTab] = useState<"resumen" | "devolucion" | "cobro">("resumen")
  const [showDevolucionSheet, setShowDevolucionSheet] = useState(false)
  const [showCobroSheet, setShowCobroSheet] = useState(false)

  // Estado de devolución en curso
  const [devItems, setDevItems] = useState<ItemDevolucion[]>([])
  const [busquedaArticulo, setBusquedaArticulo] = useState("")
  const [resultadosArticulo, setResultadosArticulo] = useState<any[]>([])
  const [guardandoDev, setGuardandoDev] = useState(false)

  // Estado de cobro
  const [comprobantesSeleccionados, setComprobantesSeleccionados] = useState<Record<string, number>>({})
  const [incluirDevoluciones, setIncluirDevoluciones] = useState(true)
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([
    { id: "1", tipo: "efectivo", monto: 0 },
  ])
  const [guardandoCobro, setGuardandoCobro] = useState(false)

  const esReadOnly = READONLY_ESTADOS.includes(data?.viaje_estado || "")

  const cargarDatos = useCallback(() => {
    setLoading(true)
    fetch(`/api/chofer/viaje/${viajeId}/cliente/${clienteId}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
  }, [viajeId, clienteId])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Inicializar comprobantes seleccionados cuando llegan los datos
  useEffect(() => {
    if (!data) return
    const init: Record<string, number> = {}
    for (const c of data.comprobantes_pendientes) {
      init[c.id] = Number(c.saldo_pendiente)
    }
    setComprobantesSeleccionados(init)
  }, [data])

  // Búsqueda de artículos para devolución
  useEffect(() => {
    if (busquedaArticulo.length < 2) { setResultadosArticulo([]); return }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/articulos/buscar?q=${encodeURIComponent(busquedaArticulo)}&limit=8`)
      const d = await res.json()
      setResultadosArticulo(Array.isArray(d) ? d : d.articulos || [])
    }, 300)
    return () => clearTimeout(timer)
  }, [busquedaArticulo])

  const agregarItemDevolucion = async (articulo: any) => {
    setBusquedaArticulo("")
    setResultadosArticulo([])

    // Verificar si el artículo está en el pedido actual
    const enPedido = data?.pedido?.detalle.find((d) => d.articulo_id === articulo.id)

    let precio = 0
    let origen: "pedido" | "vieja" = "vieja"
    let comprobante_venta_id: string | undefined

    if (enPedido) {
      precio = enPedido.precio_final
      origen = "pedido"
    } else {
      // Buscar último precio de venta
      const res = await fetch(
        `/api/chofer/articulo/precio-historico?clienteId=${clienteId}&articuloId=${articulo.id}`
      )
      const d = await res.json()
      precio = d.precio || 0
      origen = "vieja"
    }

    const nuevo: ItemDevolucion = {
      articulo_id: articulo.id,
      sku: articulo.sku,
      descripcion: articulo.descripcion,
      cantidad: 1,
      precio_venta_original: precio,
      motivo: "otro",
      condicion: "vendible",
      origen,
      comprobante_venta_id,
    }
    setDevItems((prev) => [...prev, nuevo])
  }

  const guardarDevolucion = async () => {
    if (!devItems.length) return
    setGuardandoDev(true)
    try {
      const res = await fetch(`/api/chofer/viaje/${viajeId}/devolucion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          pedido_id: data?.pedido?.id || null,
          items: devItems,
        }),
      })
      const d = await res.json()
      if (d.success) {
        setDevItems([])
        setShowDevolucionSheet(false)
        cargarDatos()
      }
    } finally {
      setGuardandoDev(false)
    }
  }

  const totalCobro = () => {
    const compTotal = Object.values(comprobantesSeleccionados).reduce((s, v) => s + v, 0)
    const devTotal = incluirDevoluciones
      ? (data?.devoluciones || [])
          .filter((d) => d.estado === "pendiente")
          .reduce((s: number, d: any) => s + Number(d.monto_total), 0)
      : 0
    return Math.max(0, compTotal - devTotal)
  }

  const guardarCobro = async () => {
    const total = totalCobro()
    const totalMetodos = metodosPago.reduce((s, m) => s + Number(m.monto), 0)
    if (Math.abs(total - totalMetodos) > 1) {
      alert(`El total de los métodos (${formatCurrency(totalMetodos)}) no coincide con lo a cobrar (${formatCurrency(total)})`)
      return
    }

    setGuardandoCobro(true)
    try {
      const imputaciones = Object.entries(comprobantesSeleccionados)
        .filter(([, monto]) => monto > 0)
        .map(([comprobante_id, monto_imputado]) => ({ comprobante_id, monto_imputado }))

      const devPendientes = incluirDevoluciones
        ? (data?.devoluciones || []).filter((d) => d.estado === "pendiente").map((d: any) => d.id)
        : []

      const res = await fetch(`/api/chofer/viaje/${viajeId}/cobro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          monto_total: totalMetodos,
          metodos: metodosPago.filter((m) => m.monto > 0),
          imputaciones,
          devolucion_ids: devPendientes,
        }),
      })
      const d = await res.json()
      if (d.success) {
        setShowCobroSheet(false)
        cargarDatos()
      } else {
        alert(d.error || "Error al registrar cobro")
      }
    } finally {
      setGuardandoCobro(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500">No se encontraron datos del cliente.</p>
      </div>
    )
  }

  const { cliente, pedido, resumen, comprobantes_pendientes, devoluciones, pagos_registrados } = data
  const clienteNombre = cliente?.razon_social || cliente?.nombre || "Cliente"

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md">
        <button
          onClick={() => router.push(`/chofer/${viajeId}`)}
          className="text-blue-200 text-sm mb-1"
        >
          ← Volver al viaje
        </button>
        <h1 className="text-xl font-bold truncate">{clienteNombre}</h1>
        {cliente?.direccion && (
          <p className="text-blue-200 text-sm truncate">📍 {cliente.direccion}</p>
        )}
      </header>

      {esReadOnly && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 text-amber-800 text-sm text-center font-medium">
          Viaje finalizado — solo consulta
        </div>
      )}

      {/* Resumen rápido */}
      <div className="mx-4 mt-4 bg-blue-700 rounded-2xl p-4 text-white">
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div>
            <p className="text-blue-200 text-xs">Saldo anterior</p>
            <p className="font-bold text-red-300">{formatCurrency(resumen.saldo_anterior)}</p>
          </div>
          <div>
            <p className="text-blue-200 text-xs">Este pedido</p>
            <p className="font-bold">{formatCurrency(resumen.total_pedido)}</p>
          </div>
          <div>
            <p className="text-blue-200 text-xs">A cobrar</p>
            <p className="font-bold text-yellow-200">{formatCurrency(resumen.total_a_cobrar)}</p>
          </div>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="p-4 space-y-4 pb-36">
        {/* Pedido */}
        {pedido && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <h3 className="font-bold text-gray-700 mb-3">Pedido #{pedido.numero}</h3>
            <div className="space-y-2">
              {pedido.detalle.map((item) => (
                <div key={item.id} className="flex justify-between items-center text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate">{item.articulos.descripcion}</p>
                    <p className="text-gray-400 text-xs">{item.articulos.sku}</p>
                  </div>
                  <div className="text-right ml-3 flex-shrink-0">
                    <p className="text-gray-600">{item.cantidad} × {formatCurrency(item.precio_final)}</p>
                    <p className="font-bold text-gray-800">{formatCurrency(item.subtotal)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t mt-3 pt-3 flex justify-between font-bold">
              <span>Total pedido</span>
              <span>{formatCurrency(pedido.total)}</span>
            </div>
          </section>
        )}

        {/* Comprobantes pendientes previos */}
        {comprobantes_pendientes.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <h3 className="font-bold text-gray-700 mb-3">Saldo Pendiente</h3>
            <div className="space-y-2">
              {comprobantes_pendientes.map((c) => (
                <div key={c.id} className="flex justify-between items-center text-sm">
                  <div>
                    <p className="font-medium text-gray-700">{c.tipo_comprobante} {c.numero_comprobante}</p>
                    <p className="text-gray-400 text-xs">
                      {new Date(c.fecha).toLocaleDateString("es-AR")}
                    </p>
                  </div>
                  <p className="font-bold text-red-600">{formatCurrency(c.saldo_pendiente)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Devoluciones del viaje */}
        {devoluciones.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-amber-200 p-4">
            <h3 className="font-bold text-amber-700 mb-3">Devoluciones Registradas</h3>
            {devoluciones.map((dev: any) => (
              <div key={dev.id} className="flex justify-between items-center py-2">
                <div>
                  <p className="font-medium text-gray-700">{dev.numero_devolucion}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    dev.estado === "pendiente" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                  }`}>
                    {dev.estado}
                  </span>
                </div>
                <p className="font-bold text-green-600">+{formatCurrency(dev.monto_total)}</p>
              </div>
            ))}
          </section>
        )}

        {/* Cobros registrados */}
        {pagos_registrados.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-green-200 p-4">
            <h3 className="font-bold text-green-700 mb-3">Cobros Registrados</h3>
            {pagos_registrados.map((p: any) => (
              <div key={p.id} className="flex justify-between items-center py-2">
                <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                  {p.estado === "pendiente_rendicion" ? "Pendiente rendición" : "Confirmado"}
                </span>
                <p className="font-bold text-green-700">{formatCurrency(p.monto)}</p>
              </div>
            ))}
          </section>
        )}
      </div>

      {/* Botones de acción (solo si viaje activo) */}
      {!esReadOnly && !resumen.ya_cobrado && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-lg">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setShowDevolucionSheet(true)}
              className="py-4 rounded-2xl bg-amber-100 text-amber-800 font-bold text-lg border-2 border-amber-200 active:scale-95 transition-transform"
            >
              ↩ Devolución
            </button>
            <button
              onClick={() => setShowCobroSheet(true)}
              className="py-4 rounded-2xl bg-blue-600 text-white font-bold text-lg active:scale-95 transition-transform"
            >
              💵 Cobrar
            </button>
          </div>
        </div>
      )}

      {/* ─── Sheet: Registrar Devolución ─── */}
      {showDevolucionSheet && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-5 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Registrar Devolución</h2>
              <button onClick={() => setShowDevolucionSheet(false)} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="p-5 space-y-5">
              {/* Buscar artículo */}
              <div>
                <label className="text-sm font-medium text-gray-600 mb-2 block">Buscar artículo</label>
                <input
                  type="text"
                  value={busquedaArticulo}
                  onChange={(e) => setBusquedaArticulo(e.target.value)}
                  placeholder="SKU o descripción..."
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-blue-500 focus:outline-none"
                />
                {resultadosArticulo.length > 0 && (
                  <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
                    {resultadosArticulo.map((art) => (
                      <button
                        key={art.id}
                        onClick={() => agregarItemDevolucion(art)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-b-0"
                      >
                        <p className="font-medium">{art.descripcion}</p>
                        <p className="text-xs text-gray-400">{art.sku}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Items agregados */}
              {devItems.map((item, idx) => (
                <div key={idx} className="bg-gray-50 rounded-2xl p-4 space-y-3">
                  <div className="flex justify-between">
                    <div>
                      <p className="font-bold text-gray-800">{item.descripcion}</p>
                      <p className="text-xs text-gray-400">{item.sku}</p>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {item.origen === "pedido" ? "De este pedido" : "Mercadería vieja"}
                      </span>
                    </div>
                    <button onClick={() => setDevItems((p) => p.filter((_, i) => i !== idx))}
                      className="text-red-400 text-2xl leading-none">×</button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
                      <input
                        type="number"
                        min="1"
                        value={item.cantidad}
                        onChange={(e) => setDevItems((p) => p.map((x, i) => i === idx ? { ...x, cantidad: Number(e.target.value) } : x))}
                        className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-lg font-bold text-center"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Precio unit.</label>
                      <input
                        type="number"
                        value={item.precio_venta_original}
                        onChange={(e) => setDevItems((p) => p.map((x, i) => i === idx ? { ...x, precio_venta_original: Number(e.target.value) } : x))}
                        className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-lg font-bold text-center"
                      />
                    </div>
                  </div>

                  {/* Condición */}
                  <div>
                    <label className="text-xs text-gray-500 mb-2 block">Condición del artículo</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["vendible", "no_vendible"] as const).map((c) => (
                        <button
                          key={c}
                          onClick={() => setDevItems((p) => p.map((x, i) => i === idx ? { ...x, condicion: c } : x))}
                          className={`py-3 rounded-xl font-bold text-sm border-2 transition-colors ${
                            item.condicion === c
                              ? c === "vendible" ? "bg-green-100 border-green-500 text-green-700" : "bg-red-100 border-red-500 text-red-700"
                              : "border-gray-200 text-gray-400"
                          }`}
                        >
                          {c === "vendible" ? "✓ Vendible" : "✗ No vendible"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Motivo */}
                  <div>
                    <label className="text-xs text-gray-500 mb-2 block">Motivo</label>
                    <div className="flex flex-wrap gap-2">
                      {MOTIVOS.map((m) => (
                        <button
                          key={m}
                          onClick={() => setDevItems((p) => p.map((x, i) => i === idx ? { ...x, motivo: m } : x))}
                          className={`px-3 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${
                            item.motivo === m ? "bg-blue-100 border-blue-500 text-blue-700" : "border-gray-200 text-gray-500"
                          }`}
                        >
                          {m.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl px-3 py-2 text-right">
                    <span className="text-gray-500 text-sm">Subtotal: </span>
                    <span className="font-bold text-green-600">{formatCurrency(item.cantidad * item.precio_venta_original)}</span>
                  </div>
                </div>
              ))}

              {devItems.length > 0 && (
                <div className="bg-green-50 rounded-xl px-4 py-3 flex justify-between items-center">
                  <span className="font-medium text-green-700">Total devolución:</span>
                  <span className="font-bold text-green-700 text-xl">
                    {formatCurrency(devItems.reduce((s, i) => s + i.cantidad * i.precio_venta_original, 0))}
                  </span>
                </div>
              )}

              {devItems.length > 0 && (
                <button
                  onClick={guardarDevolucion}
                  disabled={guardandoDev}
                  className="w-full py-5 bg-amber-500 text-white rounded-2xl text-xl font-bold active:scale-95 disabled:opacity-50"
                >
                  {guardandoDev ? "Guardando..." : "Registrar Devolución"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Sheet: Cobrar ─── */}
      {showCobroSheet && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full max-h-[95vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-5 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Registrar Cobro</h2>
              <button onClick={() => setShowCobroSheet(false)} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="p-5 space-y-5">
              {/* Comprobantes a imputar */}
              {comprobantes_pendientes.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-700 mb-3">Comprobantes a cobrar</h3>
                  <div className="space-y-2">
                    {comprobantes_pendientes.map((c) => (
                      <div key={c.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                        <div>
                          <p className="font-medium text-sm">{c.tipo_comprobante} {c.numero_comprobante}</p>
                          <p className="text-xs text-gray-400">{new Date(c.fecha).toLocaleDateString("es-AR")}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={comprobantesSeleccionados[c.id] || 0}
                            max={c.saldo_pendiente}
                            onChange={(e) => setComprobantesSeleccionados((p) => ({
                              ...p, [c.id]: Math.min(Number(e.target.value), c.saldo_pendiente)
                            }))}
                            className="w-28 border-2 border-gray-200 rounded-lg px-2 py-1 text-right font-bold"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Toggle devoluciones */}
              {devoluciones.filter((d: any) => d.estado === "pendiente").length > 0 && (
                <div className="bg-amber-50 rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-amber-800">Incluir devoluciones como crédito</p>
                      <p className="text-amber-600 text-sm">
                        {formatCurrency(devoluciones
                          .filter((d: any) => d.estado === "pendiente")
                          .reduce((s: number, d: any) => s + Number(d.monto_total), 0))}
                      </p>
                    </div>
                    <button
                      onClick={() => setIncluirDevoluciones((p) => !p)}
                      className={`w-14 h-7 rounded-full transition-colors ${incluirDevoluciones ? "bg-green-500" : "bg-gray-300"}`}
                    >
                      <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-1 ${incluirDevoluciones ? "translate-x-7" : ""}`} />
                    </button>
                  </div>
                </div>
              )}

              {/* Total a cobrar */}
              <div className="bg-blue-50 rounded-2xl px-4 py-4 text-center">
                <p className="text-blue-600 text-sm">Total a cobrar</p>
                <p className="text-3xl font-bold text-blue-800">{formatCurrency(totalCobro())}</p>
              </div>

              {/* Métodos de pago */}
              <div>
                <h3 className="font-bold text-gray-700 mb-3">Forma de pago</h3>
                {metodosPago.map((m, idx) => (
                  <MetodoPagoCard
                    key={m.id}
                    metodo={m}
                    onChange={(updates) =>
                      setMetodosPago((prev) => prev.map((x, i) => i === idx ? { ...x, ...updates } : x))
                    }
                    onRemove={metodosPago.length > 1 ? () => setMetodosPago((p) => p.filter((_, i) => i !== idx)) : undefined}
                  />
                ))}

                <button
                  onClick={() => setMetodosPago((p) => [...p, { id: Date.now().toString(), tipo: "efectivo", monto: 0 }])}
                  className="w-full mt-2 py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium"
                >
                  + Agregar método
                </button>
              </div>

              {/* Diferencia */}
              {(() => {
                const totalMet = metodosPago.reduce((s, m) => s + Number(m.monto), 0)
                const diff = totalMet - totalCobro()
                return Math.abs(diff) > 0.5 ? (
                  <div className={`rounded-xl px-4 py-3 text-center font-medium ${diff < 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                    {diff < 0 ? `Faltan ${formatCurrency(Math.abs(diff))}` : `Sobran ${formatCurrency(diff)}`}
                  </div>
                ) : null
              })()}

              <button
                onClick={guardarCobro}
                disabled={guardandoCobro}
                className="w-full py-5 bg-blue-600 text-white rounded-2xl text-xl font-bold active:scale-95 disabled:opacity-50"
              >
                {guardandoCobro ? "Guardando..." : `Registrar Cobro de ${formatCurrency(totalCobro())}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Subcomponente: Método de pago ────────────────────────────

function MetodoPagoCard({
  metodo,
  onChange,
  onRemove,
}: {
  metodo: MetodoPago
  onChange: (updates: Partial<MetodoPago>) => void
  onRemove?: () => void
}) {
  return (
    <div className="bg-gray-50 rounded-2xl p-4 mb-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["efectivo", "transferencia", "cheque"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onChange({ tipo: t })}
              className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-colors ${
                metodo.tipo === t ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 text-gray-500"
              }`}
            >
              {t === "efectivo" ? "💵" : t === "transferencia" ? "🏦" : "📄"} {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {onRemove && (
          <button onClick={onRemove} className="text-red-400 text-xl">×</button>
        )}
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">Monto</label>
        <input
          type="number"
          value={metodo.monto || ""}
          onChange={(e) => onChange({ monto: Number(e.target.value) })}
          placeholder="0.00"
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-2xl font-bold text-center focus:border-blue-500 focus:outline-none"
        />
      </div>

      {metodo.tipo === "cheque" && (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Banco"
            value={metodo.banco_emisor || ""}
            onChange={(e) => onChange({ banco_emisor: e.target.value })}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3"
          />
          <input
            type="text"
            placeholder="Número de cheque"
            value={metodo.numero_cheque || ""}
            onChange={(e) => onChange({ numero_cheque: e.target.value })}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3"
          />
          <input
            type="date"
            value={metodo.fecha_cheque || ""}
            onChange={(e) => onChange({ fecha_cheque: e.target.value })}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3"
          />
        </div>
      )}

      {metodo.tipo === "transferencia" && (
        <input
          type="text"
          placeholder="Número de comprobante / referencia"
          value={metodo.numero_comprobante || ""}
          onChange={(e) => onChange({ numero_comprobante: e.target.value })}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3"
        />
      )}
    </div>
  )
}
