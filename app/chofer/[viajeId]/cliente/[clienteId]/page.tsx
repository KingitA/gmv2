"use client"

import { useEffect, useState, useCallback, useRef, memo } from "react"
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
  // cheque
  banco_emisor?: string
  numero_cheque?: string
  fecha_cheque?: string
  fecha_emision?: string
  cuit_emisor?: string
  color_cheque?: string
  // transferencia
  numero_comprobante?: string
  cuenta_bancaria_id?: string
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

  const [showDevolucionSheet, setShowDevolucionSheet] = useState(false)
  const [showCobroSheet, setShowCobroSheet] = useState(false)

  // Estado de devolución
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
  const [procesandoOCR, setProcesandoOCR] = useState(false)
  const [ocrMsg, setOcrMsg] = useState<string | null>(null)

  const esReadOnly = READONLY_ESTADOS.includes(data?.viaje_estado || "")

  const cargarDatos = useCallback(() => {
    setLoading(true)
    fetch(`/api/chofer/viaje/${viajeId}/cliente/${clienteId}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
  }, [viajeId, clienteId])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  useEffect(() => {
    if (!data) return
    const init: Record<string, number> = {}
    for (const c of data.comprobantes_pendientes) {
      init[c.id] = Number(c.saldo_pendiente)
    }
    setComprobantesSeleccionados(init)
  }, [data])

  // Búsqueda de artículos
  useEffect(() => {
    if (busquedaArticulo.length < 2) { setResultadosArticulo([]); return }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/articulos/buscar?q=${encodeURIComponent(busquedaArticulo)}&limit=8`)
      const d = await res.json()
      setResultadosArticulo(Array.isArray(d) ? d : d.articulos || [])
    }, 300)
    return () => clearTimeout(timer)
  }, [busquedaArticulo])

  // ─── OCR: procesar foto(s) y agregar métodos de pago ─────────
  const procesarFotosOCR = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return
    setProcesandoOCR(true)
    setOcrMsg("Procesando imagen con IA...")
    try {
      const formData = new FormData()
      for (const file of Array.from(files)) {
        formData.append("files", file)
      }
      const res = await fetch("/api/pagos-clientes/ocr", {
        method: "POST",
        body: formData,
      })
      const d = await res.json()
      if (!d.success || !d.resultados?.length) {
        setOcrMsg("No se encontraron datos en la imagen. Ingresá los datos manualmente.")
        return
      }

      const nuevosMetodos: MetodoPago[] = d.resultados.map((r: any, i: number) => ({
        id: `ocr-${Date.now()}-${i}`,
        tipo: r.tipo === "transferencia" ? "transferencia" : "cheque",
        monto: r.monto || 0,
        // cheque
        banco_emisor: r.banco_emisor || "",
        numero_cheque: r.numero_cheque || "",
        fecha_cheque: r.fecha_cheque || "",
        fecha_emision: r.fecha_emision || "",
        cuit_emisor: r.cuit_emisor || "",
        color_cheque: r.color_cheque || "NEGRO",
        // transferencia
        numero_comprobante: r.numero_comprobante || "",
        cuenta_bancaria_id: r.cuenta_bancaria_id || undefined,
      }))

      // Reemplazar el efectivo inicial si solo había uno vacío, sino agregar
      setMetodosPago((prev) => {
        const soloUnEfectivoVacio = prev.length === 1 && prev[0].tipo === "efectivo" && prev[0].monto === 0
        return soloUnEfectivoVacio ? nuevosMetodos : [...prev, ...nuevosMetodos]
      })

      setOcrMsg(`✓ ${d.total_encontrados} comprobante${d.total_encontrados > 1 ? "s" : ""} detectado${d.total_encontrados > 1 ? "s" : ""}. Revisá los datos.`)
    } catch {
      setOcrMsg("Error procesando imagen. Ingresá los datos manualmente.")
    } finally {
      setProcesandoOCR(false)
    }
  }

  // ─── Devoluciones ─────────────────────────────────────────────
  const agregarItemDevolucion = async (articulo: any) => {
    setBusquedaArticulo("")
    setResultadosArticulo([])
    const enPedido = data?.pedido?.detalle.find((d) => d.articulo_id === articulo.id)
    let precio = 0
    let origen: "pedido" | "vieja" = "vieja"
    if (enPedido) {
      precio = enPedido.precio_final
      origen = "pedido"
    } else {
      const res = await fetch(`/api/chofer/articulo/precio-historico?clienteId=${clienteId}&articuloId=${articulo.id}`)
      const d = await res.json()
      precio = d.precio || 0
    }
    setDevItems((prev) => [
      ...prev,
      {
        articulo_id: articulo.id,
        sku: articulo.sku,
        descripcion: articulo.descripcion,
        cantidad: 1,
        precio_venta_original: precio,
        motivo: "otro",
        condicion: "vendible",
        origen,
      },
    ])
  }

  const guardarDevolucion = async () => {
    if (!devItems.length) return
    setGuardandoDev(true)
    try {
      const res = await fetch(`/api/chofer/viaje/${viajeId}/devolucion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, pedido_id: data?.pedido?.id || null, items: devItems }),
      })
      const d = await res.json()
      if (d.success) { setDevItems([]); setShowDevolucionSheet(false); cargarDatos() }
    } finally { setGuardandoDev(false) }
  }

  // ─── Cobro ────────────────────────────────────────────────────
  const totalCobro = () => {
    const compTotal = Object.values(comprobantesSeleccionados).reduce((s, v) => s + v, 0)
    const devTotal = incluirDevoluciones
      ? (data?.devoluciones || []).filter((d) => d.estado === "pendiente").reduce((s: number, d: any) => s + Number(d.monto_total), 0)
      : 0
    return Math.max(0, compTotal - devTotal)
  }

  const guardarCobro = async () => {
    const total = totalCobro()
    const totalMetodos = metodosPago.reduce((s, m) => s + Number(m.monto), 0)
    if (Math.abs(total - totalMetodos) > 1) {
      alert(`El total de métodos (${formatCurrency(totalMetodos)}) no coincide con lo a cobrar (${formatCurrency(total)})`)
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
      if (d.success) { setShowCobroSheet(false); cargarDatos() }
      else alert(d.error || "Error al registrar cobro")
    } finally { setGuardandoCobro(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) return <div className="flex items-center justify-center min-h-screen"><p className="text-red-500">No se encontraron datos del cliente.</p></div>

  const { cliente, pedido, resumen, comprobantes_pendientes, devoluciones, pagos_registrados } = data
  const clienteNombre = cliente?.razon_social || cliente?.nombre || "Cliente"

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md">
        <button onClick={() => router.push(`/chofer/${viajeId}`)} className="text-blue-200 text-sm mb-1">← Volver al viaje</button>
        <h1 className="text-xl font-bold truncate">{clienteNombre}</h1>
        {cliente?.direccion && <p className="text-blue-200 text-sm truncate">📍 {cliente.direccion}</p>}
      </header>

      {esReadOnly && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 text-amber-800 text-sm text-center font-medium">
          Viaje finalizado — solo consulta
        </div>
      )}

      <div className="mx-4 mt-4 bg-blue-700 rounded-2xl p-4 text-white">
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div><p className="text-blue-200 text-xs">Saldo anterior</p><p className="font-bold text-red-300">{formatCurrency(resumen.saldo_anterior)}</p></div>
          <div><p className="text-blue-200 text-xs">Este pedido</p><p className="font-bold">{formatCurrency(resumen.total_pedido)}</p></div>
          <div><p className="text-blue-200 text-xs">A cobrar</p><p className="font-bold text-yellow-200">{formatCurrency(resumen.total_a_cobrar)}</p></div>
        </div>
      </div>

      <div className="p-4 space-y-4 pb-36">
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
              <span>Total pedido</span><span>{formatCurrency(pedido.total)}</span>
            </div>
          </section>
        )}

        {comprobantes_pendientes.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <h3 className="font-bold text-gray-700 mb-3">Saldo Pendiente</h3>
            <div className="space-y-2">
              {comprobantes_pendientes.map((c) => (
                <div key={c.id} className="flex justify-between items-center text-sm">
                  <div>
                    <p className="font-medium text-gray-700">{c.tipo_comprobante} {c.numero_comprobante}</p>
                    <p className="text-gray-400 text-xs">{new Date(c.fecha).toLocaleDateString("es-AR")}</p>
                  </div>
                  <p className="font-bold text-red-600">{formatCurrency(c.saldo_pendiente)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {devoluciones.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-amber-200 p-4">
            <h3 className="font-bold text-amber-700 mb-3">Devoluciones Registradas</h3>
            {devoluciones.map((dev: any) => (
              <div key={dev.id} className="flex justify-between items-center py-2">
                <div>
                  <p className="font-medium text-gray-700">{dev.numero_devolucion}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${dev.estado === "pendiente" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{dev.estado}</span>
                </div>
                <p className="font-bold text-green-600">+{formatCurrency(dev.monto_total)}</p>
              </div>
            ))}
          </section>
        )}

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

      {!esReadOnly && !resumen.ya_cobrado && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-lg">
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setShowDevolucionSheet(true)} className="py-4 rounded-2xl bg-amber-100 text-amber-800 font-bold text-lg border-2 border-amber-200 active:scale-95 transition-transform">↩ Devolución</button>
            <button onClick={() => setShowCobroSheet(true)} className="py-4 rounded-2xl bg-blue-600 text-white font-bold text-lg active:scale-95 transition-transform">💵 Cobrar</button>
          </div>
        </div>
      )}

      {/* ─── Sheet: Devolución ─── */}
      {showDevolucionSheet && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-5 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Registrar Devolución</h2>
              <button onClick={() => setShowDevolucionSheet(false)} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <label className="text-sm font-medium text-gray-600 mb-2 block">Buscar artículo</label>
                <input type="text" value={busquedaArticulo} onChange={(e) => setBusquedaArticulo(e.target.value)} placeholder="SKU o descripción..." className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-blue-500 focus:outline-none" />
                {resultadosArticulo.length > 0 && (
                  <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
                    {resultadosArticulo.map((art) => (
                      <button key={art.id} onClick={() => agregarItemDevolucion(art)} className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-b-0">
                        <p className="font-medium">{art.descripcion}</p>
                        <p className="text-xs text-gray-400">{art.sku}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {devItems.map((item, idx) => (
                <div key={idx} className="bg-gray-50 rounded-2xl p-4 space-y-3">
                  <div className="flex justify-between">
                    <div>
                      <p className="font-bold text-gray-800">{item.descripcion}</p>
                      <p className="text-xs text-gray-400">{item.sku}</p>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{item.origen === "pedido" ? "De este pedido" : "Mercadería vieja"}</span>
                    </div>
                    <button onClick={() => setDevItems((p) => p.filter((_, i) => i !== idx))} className="text-red-400 text-2xl leading-none">×</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
                      <input type="number" min="1" value={item.cantidad} onChange={(e) => setDevItems((p) => p.map((x, i) => i === idx ? { ...x, cantidad: Number(e.target.value) } : x))} className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-lg font-bold text-center" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Precio unit.</label>
                      <input type="number" value={item.precio_venta_original} onChange={(e) => setDevItems((p) => p.map((x, i) => i === idx ? { ...x, precio_venta_original: Number(e.target.value) } : x))} className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-lg font-bold text-center" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-2 block">Condición</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["vendible", "no_vendible"] as const).map((c) => (
                        <button key={c} onClick={() => setDevItems((p) => p.map((x, i) => i === idx ? { ...x, condicion: c } : x))} className={`py-3 rounded-xl font-bold text-sm border-2 ${item.condicion === c ? (c === "vendible" ? "bg-green-100 border-green-500 text-green-700" : "bg-red-100 border-red-500 text-red-700") : "border-gray-200 text-gray-400"}`}>
                          {c === "vendible" ? "✓ Vendible" : "✗ No vendible"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-2 block">Motivo</label>
                    <div className="flex flex-wrap gap-2">
                      {MOTIVOS.map((m) => (
                        <button key={m} onClick={() => setDevItems((p) => p.map((x, i) => i === idx ? { ...x, motivo: m } : x))} className={`px-3 py-2 rounded-xl text-sm font-medium border-2 ${item.motivo === m ? "bg-blue-100 border-blue-500 text-blue-700" : "border-gray-200 text-gray-500"}`}>
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
                <>
                  <div className="bg-green-50 rounded-xl px-4 py-3 flex justify-between items-center">
                    <span className="font-medium text-green-700">Total devolución:</span>
                    <span className="font-bold text-green-700 text-xl">{formatCurrency(devItems.reduce((s, i) => s + i.cantidad * i.precio_venta_original, 0))}</span>
                  </div>
                  <button onClick={guardarDevolucion} disabled={guardandoDev} className="w-full py-5 bg-amber-500 text-white rounded-2xl text-xl font-bold active:scale-95 disabled:opacity-50">
                    {guardandoDev ? "Guardando..." : "Registrar Devolución"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Sheet: Cobro ─── */}
      {showCobroSheet && (
        <CobroSheet
          comprobantes_pendientes={comprobantes_pendientes}
          devoluciones={devoluciones}
          comprobantesSeleccionados={comprobantesSeleccionados}
          setComprobantesSeleccionados={setComprobantesSeleccionados}
          incluirDevoluciones={incluirDevoluciones}
          setIncluirDevoluciones={setIncluirDevoluciones}
          metodosPago={metodosPago}
          setMetodosPago={setMetodosPago}
          totalCobro={totalCobro}
          guardarCobro={guardarCobro}
          guardandoCobro={guardandoCobro}
          procesandoOCR={procesandoOCR}
          ocrMsg={ocrMsg}
          setOcrMsg={setOcrMsg}
          onFotos={procesarFotosOCR}
          onClose={() => setShowCobroSheet(false)}
        />
      )}
    </div>
  )
}

// ─── Sheet de Cobro (separado para claridad) ─────────────────

function CobroSheet({
  comprobantes_pendientes,
  devoluciones,
  comprobantesSeleccionados,
  setComprobantesSeleccionados,
  incluirDevoluciones,
  setIncluirDevoluciones,
  metodosPago,
  setMetodosPago,
  totalCobro,
  guardarCobro,
  guardandoCobro,
  procesandoOCR,
  ocrMsg,
  setOcrMsg,
  onFotos,
  onClose,
}: {
  comprobantes_pendientes: any[]
  devoluciones: any[]
  comprobantesSeleccionados: Record<string, number>
  setComprobantesSeleccionados: React.Dispatch<React.SetStateAction<Record<string, number>>>
  incluirDevoluciones: boolean
  setIncluirDevoluciones: React.Dispatch<React.SetStateAction<boolean>>
  metodosPago: MetodoPago[]
  setMetodosPago: React.Dispatch<React.SetStateAction<MetodoPago[]>>
  totalCobro: () => number
  guardarCobro: () => void
  guardandoCobro: boolean
  procesandoOCR: boolean
  ocrMsg: string | null
  setOcrMsg: React.Dispatch<React.SetStateAction<string | null>>
  onFotos: (files: FileList | File[]) => void
  onClose: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const totalMet = metodosPago.reduce((s, m) => s + Number(m.monto), 0)
  const total = totalCobro()
  const diff = totalMet - total

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
      <div className="bg-white rounded-t-3xl w-full max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 py-4 border-b flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">Registrar Cobro</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl">×</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Comprobantes */}
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
                    <input
                      type="number"
                      value={comprobantesSeleccionados[c.id] || 0}
                      max={c.saldo_pendiente}
                      onChange={(e) => setComprobantesSeleccionados((p) => ({ ...p, [c.id]: Math.min(Number(e.target.value), c.saldo_pendiente) }))}
                      className="w-28 border-2 border-gray-200 rounded-lg px-2 py-1 text-right font-bold"
                    />
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
                    {formatCurrency(devoluciones.filter((d: any) => d.estado === "pendiente").reduce((s: number, d: any) => s + Number(d.monto_total), 0))}
                  </p>
                </div>
                <button onClick={() => setIncluirDevoluciones((p) => !p)} className={`w-14 h-7 rounded-full transition-colors ${incluirDevoluciones ? "bg-green-500" : "bg-gray-300"}`}>
                  <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-1 ${incluirDevoluciones ? "translate-x-7" : ""}`} />
                </button>
              </div>
            </div>
          )}

          {/* Total */}
          <div className="bg-blue-50 rounded-2xl px-4 py-4 text-center">
            <p className="text-blue-600 text-sm">Total a cobrar</p>
            <p className="text-3xl font-bold text-blue-800">{formatCurrency(total)}</p>
          </div>

          {/* ─── Escáner OCR Global ─── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 font-medium">FORMA DE PAGO</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Botón escanear */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={procesandoOCR}
              className="w-full py-4 rounded-2xl border-2 border-dashed border-blue-400 text-blue-700 font-bold text-lg bg-blue-50 active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {procesandoOCR ? (
                <>
                  <span className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  Procesando con IA...
                </>
              ) : (
                <>📷 Sacar foto a cheques / transferencias</>
              )}
            </button>

            {/* Input oculto — acepta múltiples archivos, abre cámara en móvil */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  onFotos(e.target.files)
                  setOcrMsg(null)
                }
                e.target.value = ""
              }}
            />

            {/* Mensaje OCR */}
            {ocrMsg && (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium text-center ${ocrMsg.startsWith("✓") ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                {ocrMsg}
              </div>
            )}
          </div>

          {/* Métodos de pago */}
          <div className="space-y-3">
            {metodosPago.map((m, idx) => (
              <MetodoPagoCard
                key={m.id}
                metodo={m}
                onChange={(updates) => setMetodosPago((prev) => prev.map((x, i) => i === idx ? { ...x, ...updates } : x))}
                onRemove={metodosPago.length > 1 ? () => setMetodosPago((p) => p.filter((_, i) => i !== idx)) : undefined}
                onFoto={(files) => {
                  // Foto individual: reemplaza ESTE método con los resultados OCR
                  onFotos(files)
                }}
              />
            ))}

            <button
              onClick={() => setMetodosPago((p) => [...p, { id: Date.now().toString(), tipo: "efectivo", monto: 0 }])}
              className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium"
            >
              + Agregar método de pago
            </button>
          </div>

          {/* Diferencia */}
          {Math.abs(diff) > 0.5 && (
            <div className={`rounded-xl px-4 py-3 text-center font-medium ${diff < 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {diff < 0 ? `Faltan ${formatCurrency(Math.abs(diff))}` : `Vuelto / excedente: ${formatCurrency(diff)}`}
            </div>
          )}

          <button
            onClick={guardarCobro}
            disabled={guardandoCobro || totalMet <= 0}
            className="w-full py-5 bg-blue-600 text-white rounded-2xl text-xl font-bold active:scale-95 disabled:opacity-50"
          >
            {guardandoCobro ? "Guardando..." : `Registrar Cobro de ${formatCurrency(totalMet)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Situaciones BCRA ─────────────────────────────────────────

const SITUACIONES_BCRA: Record<number, { label: string; color: string }> = {
  1: { label: "Normal", color: "green" },
  2: { label: "Riesgo bajo / Seguimiento especial", color: "yellow" },
  3: { label: "Riesgo medio / Con problemas", color: "orange" },
  4: { label: "Alto riesgo de insolvencia", color: "red" },
  5: { label: "Irrecuperable", color: "red" },
  6: { label: "Irrecuperable por disposición técnica", color: "red" },
}

interface BcraResult {
  situacion_max: number
  denominacion: string | null
  apto: boolean
  sin_antecedentes: boolean
  error?: string
}

// ─── Card de método de pago ────────────────────────────────────

function MetodoPagoCard({
  metodo,
  onChange,
  onRemove,
  onFoto,
}: {
  metodo: MetodoPago
  onChange: (updates: Partial<MetodoPago>) => void
  onRemove?: () => void
  onFoto: (files: FileList) => void
}) {
  const fotoRef = useRef<HTMLInputElement>(null)
  const [bcra, setBcra] = useState<BcraResult | null>(null)
  const [consultandoBcra, setConsultandoBcra] = useState(false)

  // Consulta BCRA directamente desde el browser (la BCRA bloquea IPs de datacenters cloud).
  // La API pública de BCRA tiene Access-Control-Allow-Origin: * → CORS ok desde el cliente.
  useEffect(() => {
    if (metodo.tipo !== "cheque") return
    const cuitLimpio = (metodo.cuit_emisor || "").replace(/\D/g, "")
    if (cuitLimpio.length < 10) { setBcra(null); return }

    const timer = setTimeout(async () => {
      setConsultandoBcra(true)
      setBcra(null)
      try {
        const res = await fetch(
          `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/${cuitLimpio}`,
          { headers: { Accept: "application/json" } }
        )

        if (res.status === 404) {
          setBcra({ situacion_max: 1, denominacion: null, apto: true, sin_antecedentes: true })
          return
        }
        if (!res.ok) {
          setBcra({ situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: `Error BCRA: ${res.status}` })
          return
        }

        const data = await res.json()
        const results = data.results
        let situacionMax = 1

        for (const periodo of results?.periodos || []) {
          for (const entidad of periodo.entidades || []) {
            const sit = Number(entidad.situacion)
            if (sit > situacionMax) situacionMax = sit
          }
        }

        setBcra({
          situacion_max: situacionMax,
          denominacion: results?.denominacion || null,
          apto: situacionMax === 1,
          sin_antecedentes: false,
        })
      } catch {
        setBcra({ situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: "No se pudo conectar con BCRA" })
      } finally {
        setConsultandoBcra(false)
      }
    }, 800)

    return () => clearTimeout(timer)
  }, [metodo.cuit_emisor, metodo.tipo])

  return (
    <div className={`rounded-2xl p-4 space-y-3 border-2 transition-colors ${
      metodo.tipo === "cheque" && bcra && !bcra.apto
        ? "bg-red-50 border-red-400"
        : "bg-gray-50 border-gray-200"
    }`}>
      {/* Tipo + quitar */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1 flex-wrap">
          {(["efectivo", "transferencia", "cheque"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onChange({ tipo: t })}
              className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-colors ${metodo.tipo === t ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 text-gray-500"}`}
            >
              {t === "efectivo" ? "💵" : t === "transferencia" ? "🏦" : "📄"} {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {onRemove && <button onClick={onRemove} className="text-red-400 text-xl ml-1">×</button>}
      </div>

      {/* Monto */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Monto</label>
        <input
          type="number"
          inputMode="decimal"
          value={metodo.monto || ""}
          onChange={(e) => onChange({ monto: Number(e.target.value) })}
          placeholder="0.00"
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-2xl font-bold text-center focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Campos específicos por tipo */}
      {metodo.tipo === "cheque" && (
        <div className="space-y-2">
          {/* Botón foto individual */}
          <button
            onClick={() => fotoRef.current?.click()}
            className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-medium text-sm flex items-center justify-center gap-2"
          >
            📷 Sacar foto a este cheque
          </button>
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { if (e.target.files?.length) onFoto(e.target.files); e.target.value = "" }} />

          <input type="text" placeholder="Banco" value={metodo.banco_emisor || ""} onChange={(e) => onChange({ banco_emisor: e.target.value })} className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base" />
          <input type="text" placeholder="Número de cheque" value={metodo.numero_cheque || ""} onChange={(e) => onChange({ numero_cheque: e.target.value })} className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Fecha emisión</label>
              <input type="date" value={metodo.fecha_emision || ""} onChange={(e) => onChange({ fecha_emision: e.target.value })} className="w-full border-2 border-gray-200 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Fecha vencimiento</label>
              <input type="date" value={metodo.fecha_cheque || ""} onChange={(e) => onChange({ fecha_cheque: e.target.value })} className="w-full border-2 border-gray-200 rounded-xl px-3 py-2" />
            </div>
          </div>

          {/* CUIT — campo clave que dispara la consulta BCRA */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">CUIT emisor</label>
            <input
              type="text"
              placeholder="XX-XXXXXXXX-X"
              value={metodo.cuit_emisor || ""}
              onChange={(e) => onChange({ cuit_emisor: e.target.value })}
              className={`w-full border-2 rounded-xl px-4 py-3 text-base font-mono ${
                bcra && !bcra.apto ? "border-red-400 bg-red-50" : "border-gray-200"
              }`}
            />
          </div>

          {/* ─── Resultado BCRA ─── */}
          {consultandoBcra && (
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-100 rounded-xl text-sm text-gray-500">
              <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              Consultando BCRA...
            </div>
          )}

          {!consultandoBcra && bcra && (
            <BcraBadge bcra={bcra} />
          )}

          {/* Resumen del cheque */}
          {metodo.banco_emisor && metodo.numero_cheque && (
            <div className="bg-white rounded-xl px-3 py-2 text-xs text-gray-500 border border-gray-200">
              {metodo.banco_emisor} · #{metodo.numero_cheque}
              {metodo.fecha_cheque && ` · vence ${new Date(metodo.fecha_cheque + "T12:00:00").toLocaleDateString("es-AR")}`}
            </div>
          )}
        </div>
      )}

      {metodo.tipo === "transferencia" && (
        <div className="space-y-2">
          {/* Botón foto individual */}
          <button
            onClick={() => fotoRef.current?.click()}
            className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-medium text-sm flex items-center justify-center gap-2"
          >
            📷 Sacar foto al comprobante
          </button>
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { if (e.target.files?.length) onFoto(e.target.files); e.target.value = "" }} />

          <input type="text" placeholder="Número de comprobante / referencia" value={metodo.numero_comprobante || ""} onChange={(e) => onChange({ numero_comprobante: e.target.value })} className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base" />
        </div>
      )}
    </div>
  )
}

// ─── Badge de resultado BCRA ──────────────────────────────────

function BcraBadge({ bcra }: { bcra: BcraResult }) {
  if (bcra.error) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-100 rounded-xl border border-gray-300">
        <span className="text-gray-500 text-lg">⚠️</span>
        <div>
          <p className="text-sm font-medium text-gray-600">No se pudo consultar BCRA</p>
          <p className="text-xs text-gray-400">{bcra.error}</p>
        </div>
      </div>
    )
  }

  const sit = bcra.situacion_max
  const info = SITUACIONES_BCRA[sit] || { label: "Desconocida", color: "gray" }

  if (bcra.apto) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-green-50 rounded-xl border-2 border-green-400">
        <span className="text-3xl">✅</span>
        <div className="flex-1">
          <p className="font-bold text-green-800 text-base">Apto — Situación {sit}</p>
          <p className="text-green-600 text-sm">{info.label}</p>
          {bcra.denominacion && <p className="text-green-700 text-xs font-medium mt-0.5">{bcra.denominacion}</p>}
          {bcra.sin_antecedentes && <p className="text-green-500 text-xs">Sin antecedentes en Central de Deudores</p>}
        </div>
      </div>
    )
  }

  // Situación 2 o superior — NO aceptar cheque
  return (
    <div className="flex items-start gap-3 px-4 py-4 bg-red-50 rounded-xl border-2 border-red-500">
      <span className="text-3xl mt-0.5">🚫</span>
      <div className="flex-1">
        <p className="font-bold text-red-800 text-lg">NO ACEPTAR CHEQUE</p>
        <p className="font-bold text-red-700">Situación {sit} — {info.label}</p>
        {bcra.denominacion && <p className="text-red-600 text-sm font-medium mt-1">{bcra.denominacion}</p>}
        <p className="text-red-500 text-xs mt-1">El emisor tiene antecedentes negativos en el BCRA.</p>
      </div>
    </div>
  )
}
