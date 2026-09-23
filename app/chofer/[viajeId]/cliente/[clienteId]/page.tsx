"use client"

import { useEffect, useState, useCallback, useRef, memo } from "react"
import { ArticuloResultRow } from "@/components/search/ArticuloResultRow"
import { useRouter, useParams, useSearchParams } from "next/navigation"
import { useBackTrap } from "@/lib/vendedor/use-back-trap"
import { createClient as createClientBrowser } from "@/lib/supabase/client"
import { ComprobantesSelector } from "@/components/pagos/ComprobantesSelector"
import { formatCurrency, formatDateAR } from "@/lib/utils"
import { topeAjuste } from "@/lib/cobranzas/ajuste"
import { cuitValido, editarCampo, faltantes, filaVacia, urlsDeFotos, type FilaCheque } from "@/lib/cheques/isomorfico"
import { EstadoFoto, clsOcr, useLectorFotos } from "@/components/pagos/foto-cheque"
import { ConsultandoBcra, VeredictoBcraCard, useConsultaBcraFila, useConsultasBcra } from "@/components/pagos/BcraDeudorChip"

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

// Efectivo, o una fila de cheque/transferencia (lib/cheques/fila: nace de la foto,
// el OCR la completa en segundo plano, los campos del OCR quedan marcados).
interface MetodoEfectivo {
  id: string
  tipo: "efectivo"
  monto: number
}
type MetodoPago = MetodoEfectivo | FilaCheque
const esFila = (m: MetodoPago): m is FilaCheque => m.tipo !== "efectivo"

/** Fila → método en el formato que espera POST /api/chofer/viaje/[id]/cobro. */
const metodoPayload = (m: MetodoPago) =>
  esFila(m)
    ? m.tipo === "cheque"
      ? { tipo: "cheque", monto: m.monto, banco_emisor: m.banco, numero_cheque: m.numero_cheque, fecha_cheque: m.fecha_cheque, fecha_emision: m.fecha_emision || undefined, cuit_emisor: m.cuit_emisor || undefined, color_cheque: m.es_echeq ? "ECHEQ" : undefined }
      : { tipo: "transferencia", monto: m.monto, numero_comprobante: m.referencia_transferencia || undefined, cuenta_bancaria_id: m.cuenta_bancaria_id || undefined }
    : { tipo: "efectivo", monto: m.monto }

const MOTIVOS = ["diferencia_precios", "rotura", "vencido", "no_pedido", "otro"]
// en_rendicion ya NO es read-only: el chofer puede corregir cobros hasta que
// oficina confirme la rendición (Fase C).
const READONLY_ESTADOS = ["completado"]

// ─── Componente principal ─────────────────────────────────────

export default function ClienteEntregaPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const viajeId = params.viajeId as string
  const clienteId = params.clienteId as string

  const [data, setData] = useState<ClienteData | null>(null)
  const [loading, setLoading] = useState(true)
  const accionAplicada = useRef(false)

  const [showDevolucionSheet, setShowDevolucionSheet] = useState(false)
  const [showCobroSheet, setShowCobroSheet] = useState(false)

  // Estado de devolución
  const [devItems, setDevItems] = useState<ItemDevolucion[]>([])
  const [busquedaArticulo, setBusquedaArticulo] = useState("")
  const [resultadosArticulo, setResultadosArticulo] = useState<any[]>([])
  const [guardandoDev, setGuardandoDev] = useState(false)
  const [devError, setDevError] = useState<string | null>(null)

  // Estado de cobro
  const [comprobantesSeleccionados, setComprobantesSeleccionados] = useState<Record<string, number>>({})
  const [incluirDevoluciones, setIncluirDevoluciones] = useState(true)
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([
    { id: "1", tipo: "efectivo", monto: 0 },
  ])
  const [guardandoCobro, setGuardandoCobro] = useState(false)
  // Clave de idempotencia: estable ante doble tap/reintento, rota al éxito
  const idemKeyRef = useRef<string>(crypto.randomUUID())
  // Filas de cheque/transferencia dentro de metodosPago: la foto crea la fila al instante y
  // el OCR la completa después (components/pagos/foto-cheque). Nada espera al OCR.
  const setFilasCheques = useCallback((fn: (prev: FilaCheque[]) => FilaCheque[]) => {
    setMetodosPago((prev) => {
      const nuevas = fn(prev.filter(esFila))
      const porId = new Map(nuevas.map((f) => [f.id, f]))
      const base = prev.map((m) => (esFila(m) ? porId.get(m.id) : m)).filter((m): m is MetodoPago => !!m)
      const yaIds = new Set(base.filter(esFila).map((f) => f.id))
      const agregadas = nuevas.filter((f) => !yaIds.has(f.id))
      // Un único efectivo vacío se reemplaza por lo que trae la foto
      const soloUnEfectivoVacio = base.length === 1 && base[0].tipo === "efectivo" && base[0].monto === 0 && agregadas.length > 0
      return soloUnEfectivoVacio ? agregadas : [...base, ...agregadas]
    })
  }, [])
  const { leer: leerFotos, reintentarSubida } = useLectorFotos(setFilasCheques)
  // Consultas BCRA en segundo plano: el cobro se registra sin esperarlas; lo que llega
  // después de cerrar el formulario lo avisa el layout (AvisosBcraGlobal).
  const bcra = useConsultasBcra()
  // Clientes adicionales para cobrar en la misma cobranza (cobro conjunto en la calle)
  const [cobrosExtra, setCobrosExtra] = useState<Array<{ cliente: any; saldo: number; monto: number }>>([])
  const [contadoPedidos, setContadoPedidos] = useState<Set<string>>(new Set())  // anticipos con 10% contado
  const [contadoGeneral, setContadoGeneral] = useState(false)                    // 10% sobre comprobantes saldados
  const [compsCargados, setCompsCargados] = useState<any[]>([])
  const [dtosHechos, setDtosHechos] = useState<Set<string>>(new Set())
  const [dialogoDiff, setDialogoDiff] = useState<number | null>(null)             // +falta / −sobra

  const esReadOnly = READONLY_ESTADOS.includes(data?.viaje_estado || "")

  const cargarDatos = useCallback(() => {
    setLoading(true)
    fetch(`/api/chofer/viaje/${viajeId}/cliente/${clienteId}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
  }, [viajeId, clienteId])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Abrir cobro/devolución automáticamente si se entró con ?accion= desde la lista del viaje
  useEffect(() => {
    if (!data || accionAplicada.current) return
    const accion = searchParams.get("accion")
    if (accion === "cobrar") { setShowCobroSheet(true); accionAplicada.current = true }
    else if (accion === "devolucion") { setShowDevolucionSheet(true); accionAplicada.current = true }
  }, [data, searchParams])

  // "Atrás" físico: cerrar los sheets (y primero la búsqueda de la devolución)
  // antes de salir de la ficha del cliente.
  useBackTrap(() => {
    if (showDevolucionSheet) {
      if (busquedaArticulo) { setBusquedaArticulo(""); return true }
      setShowDevolucionSheet(false); setDevError(null); return true
    }
    if (showCobroSheet) { setShowCobroSheet(false); return true }
    return false
  })

  // La selección de comprobantes/pedidos la maneja ComprobantesSelector (incluye anticipos).

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

  // ─── Devoluciones ─────────────────────────────────────────────

  // Agrega un artículo buscado por texto (buscar artículo en sheet)
  const agregarItemDevolucion = async (articulo: any) => {
    setBusquedaArticulo("")
    setResultadosArticulo([])
    await agregarItemPorArticulo(articulo.id, articulo.sku, articulo.descripcion)
  }

  // Agrega un artículo directo desde el pedido (swipe)
  const agregarItemDesdePedido = async (item: ClienteData["pedido"] extends null ? never : NonNullable<ClienteData["pedido"]>["detalle"][0]) => {
    await agregarItemPorArticulo(item.articulo_id, item.articulos.sku, item.articulos.descripcion, item.precio_final, item.cantidad)
    setShowDevolucionSheet(true)
  }

  const agregarItemPorArticulo = async (
    articuloId: string,
    sku: string,
    descripcion: string,
    precioOverride?: number,
    cantidadMax?: number
  ) => {
    const enPedido = data?.pedido?.detalle.find((d) => d.articulo_id === articuloId)
    let precio = precioOverride ?? 0
    let origen: "pedido" | "vieja" = "vieja"

    if (enPedido) {
      precio = precioOverride ?? enPedido.precio_final
      origen = "pedido"
    } else if (!precioOverride) {
      const res = await fetch(`/api/chofer/articulo/precio-historico?clienteId=${clienteId}&articuloId=${articuloId}`)
      const d = await res.json()
      precio = d.precio || 0
    }

    // No agregar duplicado — si ya está, no hacer nada
    if (devItems.some((x) => x.articulo_id === articuloId)) return

    setDevItems((prev) => [
      ...prev,
      {
        articulo_id: articuloId,
        sku,
        descripcion,
        // Del pedido: por defecto vuelve TODO lo facturado (se corrige si es parcial)
        cantidad: origen === "pedido" ? (cantidadMax ?? enPedido?.cantidad ?? 1) : 1,
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
    setDevError(null)
    try {
      const res = await fetch(`/api/chofer/viaje/${viajeId}/devolucion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, pedido_id: data?.pedido?.id || null, items: devItems }),
      })
      const d = await res.json()
      if (d.success) {
        setDevItems([])
        setShowDevolucionSheet(false)
        cargarDatos()
      } else {
        setDevError(d.error || "Error al registrar la devolución")
      }
    } catch {
      setDevError("Error de conexión. Intentá de nuevo.")
    } finally {
      setGuardandoDev(false)
    }
  }

  // ─── Cobro ────────────────────────────────────────────────────
  // NC 10% contado proyectada: 10% del total de cada comprobante saldado
  // completo hoy (FA/FB/FC/PRES sin el descuento ya hecho). El servidor recorta
  // las imputaciones al 90% y la NC real sale al confirmar la rendición.
  const bonificacionEstimada = () => {
    if (!contadoGeneral) return 0
    let b = 0
    for (const cp of compsCargados) {
      const imp = comprobantesSeleccionados[cp.id]
      if (imp === undefined || dtosHechos.has(cp.id)) continue
      if (!["FA", "FB", "FC", "PRES"].includes(String(cp.tipo_comprobante || "").toUpperCase())) continue
      if (Math.abs(imp - Number(cp.saldo_pendiente)) < 0.01) b += Number(cp.total_factura) * 0.1
    }
    return Math.round(b * 100) / 100
  }
  const totalImputado = () => Object.values(comprobantesSeleccionados).reduce((s, v) => s + v, 0)
  const totalCobro = () => {
    const devTotal = incluirDevoluciones
      ? (data?.devoluciones || []).filter((d) => d.estado === "pendiente").reduce((s: number, d: any) => s + Number(d.monto_total), 0)
      : 0
    return Math.max(0, Math.round((totalImputado() - devTotal - bonificacionEstimada()) * 100) / 100)
  }

  const guardarCobro = async (modoDiferencia?: "ajuste" | "saldo") => {
    // Total NETO a cobrar = comprobantes/anticipos seleccionados − devoluciones − NC 10%.
    const totalNeto = totalCobro()
    const totalMetodos = Math.round(metodosPago.reduce((s, m) => s + Number(m.monto), 0) * 100) / 100
    if (totalMetodos <= 0) {
      alert("Ingresá al menos un método de pago con monto.")
      return
    }
    for (const m of metodosPago) {
      if (esFila(m) && m.monto > 0 && faltantes(m).length) {
        alert(`Al ${m.tipo === "cheque" ? "cheque" : "comprobante"}${m.numero_cheque ? " " + m.numero_cheque : ""} le falta: ${faltantes(m).join(", ")}.`)
        return
      }
    }
    // Diferencia (mismo criterio que viajante / ERP): si no da al centavo, se
    // ajusta por redondeo (tope 1% de lo imputado, oficina lo confirma al
    // rendir) o se deja saldo pendiente / a cuenta.
    const diff = Math.round((totalMetodos - totalNeto) * 100) / 100
    let ajusteRedondeo = 0
    if (Math.abs(diff) > 0.01 && totalImputado() > 0) {
      if (!modoDiferencia) { setDialogoDiff(diff); return }
      if (modoDiferencia === "ajuste") ajusteRedondeo = -diff // +falta = crédito, −sobra = débito
    }
    setDialogoDiff(null)
    setGuardandoCobro(true)
    try {
      // Imputaciones = solo comprobantes reales. Las claves "pedido:<id>" son anticipos
      // a pedidos sin facturar → quedan como pago a cuenta.
      const imputaciones = Object.entries(comprobantesSeleccionados)
        .filter(([k, monto]) => monto > 0 && !k.startsWith("pedido:"))
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
          metodos: metodosPago.filter((m) => m.monto > 0).map(metodoPayload),
          imputaciones,
          devolucion_ids: devPendientes,
          comprobante_urls: urlsDeFotos(metodosPago.filter(esFila)).map((url) => ({ url })),
          pedidos_contado: [...contadoPedidos],
          contado_general: contadoGeneral && bonificacionEstimada() > 0,
          ajuste_redondeo: ajusteRedondeo,
          cobros_extra: cobrosExtra
            .filter((c) => c.monto > 0)
            .map((c) => ({ cliente_id: c.cliente.id, metodos: [{ tipo: "efectivo", monto: c.monto }], imputaciones: [] })),
          idempotency_key: idemKeyRef.current,
        }),
      })
      const d = await res.json()
      if (d.success) { idemKeyRef.current = crypto.randomUUID(); for (const m of metodosPago) if (esFila(m) && m.tipo === "cheque" && m.monto > 0 && !cuitValido(m.cuit_emisor)) bcra.sinCuit(m.id, { cuits: [], banco: m.banco, numero_cheque: m.numero_cheque, monto: m.monto, cliente_nombre: data?.cliente?.nombre || null }, m.cuit_emisor || null); setShowCobroSheet(false); bcra.cerrarFormulario(); setCobrosExtra([]); setMetodosPago([{ id: "1", tipo: "efectivo", monto: 0 }]); setContadoPedidos(new Set()); setContadoGeneral(false); setComprobantesSeleccionados({}); cargarDatos() }
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
        {/* Artículos del pedido — swipe izquierda para devolver */}
        {pedido && !esReadOnly && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="font-bold text-gray-700">Pedido #{pedido.numero}</h3>
              <span className="text-xs text-gray-400">← deslizá para devolver</span>
            </div>
            <div className="divide-y divide-gray-100">
              {pedido.detalle.map((item) => (
                <SwipeableItem
                  key={item.id}
                  onDevolver={() => agregarItemDesdePedido(item)}
                  disabled={esReadOnly}
                >
                  <div className="flex justify-between items-center text-sm px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{item.articulos.descripcion}</p>
                      <p className="text-gray-400 text-xs">{item.articulos.sku}</p>
                    </div>
                    <div className="text-right ml-3 flex-shrink-0">
                      <p className="text-gray-500 text-xs">{item.cantidad} × {formatCurrency(item.precio_final)}</p>
                      <p className="font-bold text-gray-800">{formatCurrency(item.subtotal)}</p>
                    </div>
                  </div>
                </SwipeableItem>
              ))}
            </div>
            <div className="border-t mx-4 mt-1 py-3 flex justify-between font-bold text-sm">
              <span className="text-gray-700">Total pedido</span>
              <span>{formatCurrency(pedido.total)}</span>
            </div>
          </section>
        )}

        {/* Pedido en modo lectura (sin swipe) */}
        {pedido && esReadOnly && (
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
                    <p className="text-gray-500 text-xs">{item.cantidad} × {formatCurrency(item.precio_final)}</p>
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

        {/* Saldo pendiente + devoluciones juntos */}
        {(comprobantes_pendientes.length > 0 || devoluciones.length > 0) && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <h3 className="font-bold text-gray-700 mb-3">Saldo y Devoluciones</h3>
            <div className="space-y-2">
              {/* Comprobantes pendientes (rojo = debe) */}
              {comprobantes_pendientes.map((c) => (
                <div key={c.id} className="flex justify-between items-center text-sm">
                  <div>
                    <p className="font-medium text-gray-700">{c.tipo_comprobante} {c.numero_comprobante}</p>
                    <p className="text-gray-400 text-xs">{formatDateAR(c.fecha)}</p>
                  </div>
                  <p className="font-bold text-red-600">−{formatCurrency(c.saldo_pendiente)}</p>
                </div>
              ))}

              {/* Devoluciones (verde = crédito a favor) */}
              {devoluciones.map((dev: any) => (
                <div key={dev.id} className="flex justify-between items-center text-sm bg-green-50 rounded-xl px-3 py-2">
                  <div>
                    <p className="font-medium text-green-800">↩ Devolución {dev.numero_devolucion}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      dev.estado === "pendiente" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                    }`}>
                      {dev.estado === "pendiente" ? "pendiente confirmación" : "confirmada"}
                    </span>
                  </div>
                  <p className="font-bold text-green-600">+{formatCurrency(dev.monto_total)}</p>
                </div>
              ))}

              {/* Neto */}
              {comprobantes_pendientes.length > 0 && devoluciones.length > 0 && (
                <div className="border-t pt-2 flex justify-between font-bold text-sm">
                  <span className="text-gray-700">Neto a cobrar</span>
                  <span className={resumen.total_a_cobrar > 0 ? "text-red-600" : "text-green-600"}>
                    {formatCurrency(resumen.total_a_cobrar)}
                  </span>
                </div>
              )}
            </div>
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
              <button onClick={() => { setShowDevolucionSheet(false); setDevError(null) }} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="p-5 space-y-5">
              {/* Error de API */}
              {devError && (
                <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 text-red-700 text-sm font-medium">
                  ⚠️ {devError}
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-gray-600 mb-2 block">Buscar artículo adicional</label>
                <input type="text" value={busquedaArticulo} onChange={(e) => setBusquedaArticulo(e.target.value)} placeholder="SKU o descripción..." className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-blue-500 focus:outline-none" />
                {resultadosArticulo.length > 0 && (
                  <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
                    {resultadosArticulo.map((art) => (
                      <button key={art.id} onClick={() => agregarItemDevolucion(art)} className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-b-0">
                        <ArticuloResultRow articulo={art} size="sm" />
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
          onFotos={leerFotos}
          onReintentarSubida={reintentarSubida}
          clienteNombre={data?.cliente?.nombre || null}
          cobrosExtra={cobrosExtra}
          setCobrosExtra={setCobrosExtra}
          clienteId={clienteId}
          onContadoPedidosChange={setContadoPedidos}
          onClose={() => { setShowCobroSheet(false); bcra.cerrarFormulario() }}
          contadoGeneral={contadoGeneral}
          onContadoGeneralChange={setContadoGeneral}
          onComprobantesLoaded={setCompsCargados}
          onDtosHechosLoaded={setDtosHechos}
          bonificacion={bonificacionEstimada()}
          dialogoDiff={dialogoDiff}
          setDialogoDiff={setDialogoDiff}
          topeAjusteActual={topeAjuste(totalImputado())}
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
  onFotos,
  onReintentarSubida,
  clienteNombre,
  cobrosExtra,
  setCobrosExtra,
  clienteId,
  onContadoPedidosChange,
  onClose,
  contadoGeneral,
  onContadoGeneralChange,
  onComprobantesLoaded,
  onDtosHechosLoaded,
  bonificacion,
  dialogoDiff,
  setDialogoDiff,
  topeAjusteActual,
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
  guardarCobro: (modo?: "ajuste" | "saldo") => void
  guardandoCobro: boolean
  onFotos: (files: FileList | File[] | null | undefined, opts?: { filaId?: string }) => void
  onReintentarSubida: (filaId: string) => void
  clienteNombre: string | null
  cobrosExtra: Array<{ cliente: any; saldo: number; monto: number }>
  setCobrosExtra: React.Dispatch<React.SetStateAction<Array<{ cliente: any; saldo: number; monto: number }>>>
  clienteId: string
  onContadoPedidosChange: (s: Set<string>) => void
  onClose: () => void
  contadoGeneral: boolean
  onContadoGeneralChange: (v: boolean) => void
  onComprobantesLoaded: (c: any[]) => void
  onDtosHechosLoaded: (d: Set<string>) => void
  bonificacion: number
  dialogoDiff: number | null
  setDialogoDiff: (d: number | null) => void
  topeAjusteActual: number
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const totalMet = metodosPago.reduce((s, m) => s + Number(m.monto), 0)
  const total = totalCobro()
  const diff = totalMet - total

  // Búsqueda de clientes adicionales para cobrar
  const supabaseCli = createClientBrowser()
  const [busqCli, setBusqCli] = useState("")
  const [resCli, setResCli] = useState<any[]>([])
  useEffect(() => {
    if (busqCli.length < 2) { setResCli([]); return }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(busqCli)}&limit=8`)
      const d = await r.json()
      setResCli(Array.isArray(d) ? d : d.clientes || [])
    }, 300)
    return () => clearTimeout(t)
  }, [busqCli])

  const agregarClienteExtra = async (cli: any) => {
    setBusqCli(""); setResCli([])
    if (cobrosExtra.some((c) => c.cliente.id === cli.id)) return
    const { data: saldoRow } = await supabaseCli.from("v_saldo_clientes").select("saldo_actual").eq("cliente_id", cli.id).maybeSingle()
    const saldo = Number((saldoRow as any)?.saldo_actual ?? 0)
    setCobrosExtra((prev) => [...prev, { cliente: cli, saldo, monto: saldo > 0 ? saldo : 0 }])
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
      <div className="bg-white rounded-t-3xl w-full max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 py-4 border-b flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">Registrar Cobro</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl">×</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Pedidos y comprobantes a cobrar (incluye anticipos a pedidos sin facturar) */}
          <div>
            <h3 className="font-bold text-gray-700 mb-3">Pedidos / comprobantes a cobrar</h3>
            <ComprobantesSelector
              clienteId={clienteId}
              seleccionados={comprobantesSeleccionados}
              onChange={setComprobantesSeleccionados}
              onContadoPedidosChange={onContadoPedidosChange}
              seleccionTotal
              contadoGeneral={contadoGeneral}
              onContadoGeneralChange={onContadoGeneralChange}
              onComprobantesLoaded={onComprobantesLoaded}
              onDtosHechosLoaded={onDtosHechosLoaded}
            />
            {bonificacion > 0 && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                10% contado: −{formatCurrency(bonificacion)} (la NC sale al confirmar la rendición)
              </p>
            )}
          </div>

          {/* Agregar cliente para cobrar (cobro conjunto en la calle) */}
          <div>
            <h3 className="font-bold text-gray-700 mb-2">Agregar cliente para cobrar</h3>
            <input
              type="text"
              value={busqCli}
              onChange={(e) => setBusqCli(e.target.value)}
              placeholder="Buscar cliente por nombre o CUIT..."
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
            {resCli.length > 0 && (
              <div className="mt-1 border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                {resCli.map((cli) => (
                  <button key={cli.id} onClick={() => agregarClienteExtra(cli)} className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-0">
                    <p className="text-sm font-medium">{cli.razon_social || cli.nombre_razon_social || cli.nombre}</p>
                    <p className="text-xs text-gray-400">{cli.direccion || ""} {cli.localidad ? `· ${cli.localidad}` : ""}</p>
                  </button>
                ))}
              </div>
            )}
            {cobrosExtra.map((ce, idx) => (
              <div key={ce.cliente.id} className="mt-2 bg-gray-50 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{ce.cliente.razon_social || ce.cliente.nombre_razon_social || ce.cliente.nombre}</p>
                    <p className="text-xs text-gray-400">Saldo: {formatCurrency(ce.saldo)}</p>
                  </div>
                  <button onClick={() => setCobrosExtra((p) => p.filter((_, i) => i !== idx))} className="text-red-500 text-lg px-2">×</button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-500">Cobrar (efectivo):</span>
                  <input
                    type="number"
                    value={ce.monto || 0}
                    onChange={(e) => setCobrosExtra((p) => p.map((c, i) => (i === idx ? { ...c, monto: Number(e.target.value) || 0 } : c)))}
                    className="flex-1 border-2 border-gray-200 rounded-lg px-2 py-1 text-right font-bold"
                  />
                </div>
              </div>
            ))}
          </div>

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
              className="w-full py-4 rounded-2xl border-2 border-dashed border-blue-400 text-blue-700 font-bold text-lg bg-blue-50 active:scale-95 transition-transform flex items-center justify-center gap-3"
            >
              📷 Sacar foto a cheques / transferencias
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
                onFotos(e.target.files)
                e.target.value = ""
              }}
            />

            <p className="text-center text-xs text-gray-500">La foto abre el cheque al instante; los datos se completan solos en unos segundos y siempre se pueden corregir.</p>
          </div>

          {/* Métodos de pago */}
          <div className="space-y-3">
            {metodosPago.map((m, idx) => (
              <MetodoPagoCard
                key={m.id}
                metodo={m}
                clienteNombre={clienteNombre}
                onChange={(updates) => setMetodosPago((prev) => prev.map((x, i) => (i === idx ? aplicarCambios(x, updates) : x)))}
                onRemove={metodosPago.length > 1 ? () => setMetodosPago((p) => p.filter((_, i) => i !== idx)) : undefined}
                onFoto={(files) => onFotos(files, esFila(m) ? { filaId: m.id } : undefined)}
                onReintentarSubida={() => onReintentarSubida(m.id)}
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
          {Math.abs(diff) > 0.01 && (
            <div className={`rounded-xl px-4 py-3 text-center font-medium ${diff < 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {diff < 0 ? `Faltan ${formatCurrency(Math.abs(diff))}` : `Sobran ${formatCurrency(diff)}`}
              <span className="block text-xs font-normal opacity-80">Al registrar elegís: ajuste por redondeo o dejar el saldo.</span>
            </div>
          )}

          {dialogoDiff !== null && (
            <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={() => setDialogoDiff(null)}>
              <div className="w-full space-y-3 rounded-t-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-center text-lg font-bold">
                  {dialogoDiff < 0 ? `Faltan ${formatCurrency(Math.abs(dialogoDiff))}` : `Sobran ${formatCurrency(dialogoDiff)}`}
                </h3>
                {Math.abs(dialogoDiff) <= topeAjusteActual + 0.005 ? (
                  <button onClick={() => guardarCobro("ajuste")} disabled={guardandoCobro} className="w-full rounded-2xl bg-blue-600 py-4 font-bold text-white disabled:opacity-50">
                    Ajuste por redondeo {dialogoDiff < 0 ? "(se le perdona)" : "(no queda a favor)"} — oficina lo confirma al rendir
                  </button>
                ) : (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
                    La diferencia supera el 1% de lo imputado ({formatCurrency(topeAjusteActual)}): no se ajusta desde la calle.
                  </p>
                )}
                <button onClick={() => guardarCobro("saldo")} disabled={guardandoCobro} className="w-full rounded-2xl border-2 border-gray-300 py-4 font-bold text-gray-700 disabled:opacity-50">
                  {dialogoDiff < 0 ? "Dejar el saldo pendiente" : "Dejar el sobrante a cuenta del cliente"}
                </button>
                <button onClick={() => setDialogoDiff(null)} className="w-full py-2 text-sm text-gray-400">Volver</button>
              </div>
            </div>
          )}

          <button
            onClick={() => guardarCobro()}
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

// ─── Card de método de pago ────────────────────────────────────
// Efectivo: solo monto. Cheque/transferencia: fila de lib/cheques con foto, campos
// del OCR resaltados en ámbar (hasta que el chofer los pisa) y consulta BCRA en
// segundo plano cuando el CUIT queda completo y válido.

type CambiosMetodo = Partial<Omit<FilaCheque, "tipo">> & { tipo?: MetodoPago["tipo"] }

/** Aplica cambios a un método: cambio de tipo (efectivo ↔ fila) o edición de campos (marca "editado" en la fila). */
function aplicarCambios(m: MetodoPago, updates: CambiosMetodo): MetodoPago {
  const { tipo, ...campos } = updates
  let out: MetodoPago = m
  if (tipo && tipo !== m.tipo) {
    if (tipo === "efectivo") out = { id: m.id, tipo: "efectivo", monto: m.monto }
    else if (m.tipo === "efectivo") out = { ...filaVacia(m.id, tipo), monto: m.monto }
    else out = { ...m, tipo }
  }
  if (!esFila(out)) return { ...out, ...(campos.monto !== undefined ? { monto: campos.monto } : {}) }
  return (Object.entries(campos) as Array<[keyof FilaCheque, any]>).reduce((f, [k, v]) => editarCampo(f, k, v), out)
}

const CLS_INPUT = "w-full border-2 rounded-xl px-4 py-3 text-base border-gray-200"

function MetodoPagoCard({
  metodo,
  clienteNombre,
  onChange,
  onRemove,
  onFoto,
  onReintentarSubida,
}: {
  metodo: MetodoPago
  clienteNombre: string | null
  onChange: (updates: CambiosMetodo) => void
  onRemove?: () => void
  onFoto: (files: FileList) => void
  onReintentarSubida: () => void
}) {
  const fotoRef = useRef<HTMLInputElement>(null)
  const fila = esFila(metodo) ? metodo : null
  const consulta = useConsultaBcraFila(
    metodo.id,
    fila && fila.tipo === "cheque" && fila.cuit_emisor
      ? { cuits: [fila.cuit_emisor], banco: fila.banco, numero_cheque: fila.numero_cheque, monto: fila.monto, cliente_nombre: clienteNombre }
      : null,
  )
  const riesgo = consulta?.veredicto?.veredicto === "riesgo"

  return (
    <div className={`rounded-2xl p-4 space-y-3 border-2 transition-colors ${riesgo ? "bg-red-50 border-red-400" : "bg-gray-50 border-gray-200"}`}>
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
          className={`w-full border-2 rounded-xl px-4 py-3 text-2xl font-bold text-center focus:border-blue-500 focus:outline-none ${fila ? clsOcr(fila, "monto", "border-gray-200") : "border-gray-200"}`}
        />
      </div>

      {fila && (
        <div className="space-y-2">
          <button
            onClick={() => fotoRef.current?.click()}
            className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-medium text-sm flex items-center justify-center gap-2"
          >
            📷 {fila.ocr.estado === "sin_foto" ? (fila.tipo === "cheque" ? "Sacar foto a este cheque" : "Sacar foto al comprobante") : "Sacar otra foto"}
          </button>
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { if (e.target.files?.length) onFoto(e.target.files); e.target.value = "" }} />
          <EstadoFoto fila={fila} onReintentar={onReintentarSubida} />

          {fila.tipo === "cheque" ? (
            <>
              <input type="text" placeholder="Banco" value={fila.banco} onChange={(e) => onChange({ banco: e.target.value })} className={clsOcr(fila, "banco", CLS_INPUT)} />
              <input type="text" inputMode="numeric" placeholder="Número de cheque" value={fila.numero_cheque} onChange={(e) => onChange({ numero_cheque: e.target.value })} className={clsOcr(fila, "numero_cheque", CLS_INPUT)} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Fecha emisión</label>
                  <input type="date" value={fila.fecha_emision} onChange={(e) => onChange({ fecha_emision: e.target.value })} className={clsOcr(fila, "fecha_emision", "w-full border-2 rounded-xl px-3 py-2 border-gray-200")} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Fecha vencimiento</label>
                  <input type="date" value={fila.fecha_cheque} onChange={(e) => onChange({ fecha_cheque: e.target.value })} className={clsOcr(fila, "fecha_cheque", "w-full border-2 rounded-xl px-3 py-2 border-gray-200")} />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">CUIT emisor</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="XX-XXXXXXXX-X"
                  value={fila.cuit_emisor}
                  onChange={(e) => onChange({ cuit_emisor: e.target.value })}
                  className={`w-full border-2 rounded-xl px-4 py-3 text-base font-mono ${riesgo ? "border-red-400 bg-red-50" : clsOcr(fila, "cuit_emisor", "border-gray-200")}`}
                />
              </div>
              {!cuitValido(fila.cuit_emisor) && (
                <p className="text-xs font-medium text-amber-700">
                  {fila.cuit_emisor ? "⚠️ El CUIT no cierra (dígito verificador): revisalo en el cheque." : "⚠️ Sin CUIT: este cheque no se consulta en el BCRA (queda sin control de riesgo)."}
                </p>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={fila.es_echeq} onChange={(e) => onChange({ es_echeq: e.target.checked })} className="w-5 h-5" />
                Es e-cheq
              </label>
              {consulta?.consultando && <ConsultandoBcra />}
              {consulta?.veredicto && <VeredictoBcraCard v={consulta.veredicto} />}
            </>
          ) : (
            <input type="text" placeholder="Número de comprobante / referencia" value={fila.referencia_transferencia} onChange={(e) => onChange({ referencia_transferencia: e.target.value })} className={CLS_INPUT} />
          )}
        </div>
      )}
    </div>
  )
}

// ─── SwipeableItem ────────────────────────────────────────────
// Deslizá izquierda para revelar el botón "Devolver"

function SwipeableItem({
  children,
  onDevolver,
  disabled,
}: {
  children: React.ReactNode
  onDevolver: () => void
  disabled?: boolean
}) {
  const [offset, setOffset] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const startX = useRef(0)
  const THRESHOLD = 70 // px para revelar
  const BUTTON_W = 90  // px del botón

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return
    startX.current = e.touches[0].clientX
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (disabled) return
    const dx = e.touches[0].clientX - startX.current
    if (dx < 0) setOffset(Math.max(dx, -BUTTON_W))
  }

  const handleTouchEnd = () => {
    if (disabled) return
    if (offset < -THRESHOLD) {
      setOffset(-BUTTON_W)
      setRevealed(true)
    } else {
      setOffset(0)
      setRevealed(false)
    }
  }

  const handleDevolver = () => {
    setOffset(0)
    setRevealed(false)
    onDevolver()
  }

  return (
    <div className="relative overflow-hidden">
      {/* Botón detrás (rojo) */}
      <div
        className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-amber-500"
        style={{ width: BUTTON_W }}
      >
        <button
          onClick={handleDevolver}
          className="flex flex-col items-center justify-center w-full h-full text-white"
        >
          <span className="text-xl">↩</span>
          <span className="text-xs font-bold">Devolver</span>
        </button>
      </div>

      {/* Contenido deslizable */}
      <div
        className="relative bg-white transition-transform"
        style={{
          transform: `translateX(${offset}px)`,
          transition: offset === 0 || offset === -BUTTON_W ? "transform 0.2s ease" : "none",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => { if (revealed) { setOffset(0); setRevealed(false) } }}
      >
        {children}
      </div>
    </div>
  )
}
