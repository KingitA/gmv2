"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { BcraDeudorChip } from "@/components/pagos/BcraDeudorChip"

// Pantalla de cobro del viajante — contrato docs/CONTRATO-API-VIAJANTES.md
// (POST /api/viajante/cobro). Flujo pensado para la calle:
//   1. "¿Qué paga?" — lista unificada de PEDIDOS con su estado; si el pedido
//      ya tiene comprobantes se entra y se eligen cuáles afectar; si no, se
//      cobra el pedido completo (anticipo, con opción 10% contado). Las
//      devoluciones sin NC aparecen avisadas sobre su pedido.
//   2. "¿Cómo paga?" — efectivo a mano, o foto (cámara/galería) de cheques y
//      transferencias: el OCR precarga los datos.
//   3. Lo que sobra de los métodos queda automáticamente como pago a cuenta.

interface Comprobante {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  total_factura: number
  saldo_pendiente: number
  pedido_id: string | null
  pedido?: { numero_pedido: string | null } | null
}

interface PedidoCobro {
  id: string
  numero_pedido: string | null
  fecha: string
  estado: string
  total: number
  pago_contado_10: boolean
  anticipo_pago_id: string | null
  facturado: boolean
  cobrable: boolean
}

interface DevolucionPendiente {
  id: string
  numero_devolucion: string | null
  pedido_id: string | null
  monto_total: number
}

interface Cliente {
  id: string
  nombre: string
  saldo_actual: number
}

interface Metodo {
  tipo: "cheque" | "transferencia"
  monto: number
  banco: string
  numero_cheque: string
  fecha_cheque: string
  cuit_emisor: string
  es_echeq: boolean
  referencia_transferencia: string
  cuenta_bancaria_id: string
}

interface CuentaBancaria {
  id: string
  banco: string
  nombre: string | null
  alias: string | null
}

const ESTADO_PEDIDO: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "PENDIENTE", cls: "bg-yellow-100 text-yellow-700" },
  impreso: { label: "IMPRESO", cls: "bg-blue-100 text-blue-700" },
  en_preparacion: { label: "EN PREPARACIÓN", cls: "bg-blue-100 text-blue-700" },
  en_viaje: { label: "EN VIAJE", cls: "bg-indigo-100 text-indigo-700" },
  entregado: { label: "ENTREGADO", cls: "bg-green-100 text-green-700" },
  confirmado: { label: "CONFIRMADO", cls: "bg-blue-100 text-blue-700" },
}

const nuevoMetodo = (tipo: Metodo["tipo"]): Metodo => ({
  tipo,
  monto: 0,
  banco: "",
  numero_cheque: "",
  fecha_cheque: "",
  cuit_emisor: "",
  es_echeq: false,
  referencia_transferencia: "",
  cuenta_bancaria_id: "",
})

export default function VendedorCobrarPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [pedidos, setPedidos] = useState<PedidoCobro[]>([])
  const [devoluciones, setDevoluciones] = useState<DevolucionPendiente[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Qué paga ──
  const [abierto, setAbierto] = useState<string | null>(null) // pedido expandido
  const [imputaciones, setImputaciones] = useState<Record<string, number>>({})
  const [pedidosSel, setPedidosSel] = useState<Record<string, number>>({})
  const [contadoSel, setContadoSel] = useState<Record<string, boolean>>({})

  // ── Cómo paga ──
  const [efectivo, setEfectivo] = useState(0)
  const [metodos, setMetodos] = useState<Metodo[]>([])
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([])
  const [fotos, setFotos] = useState<string[]>([])
  const [subiendoFotos, setSubiendoFotos] = useState(false)
  const [obs, setObs] = useState("")
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    fetch(`/api/vendedor/cliente/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else {
          setCliente(d.cliente)
          setComprobantes(d.comprobantes || [])
          setPedidos(d.pedidos_cobro || [])
          setDevoluciones(d.devoluciones_pendientes || [])
        }
      })
      .catch(() => setError("Error al cargar el cliente"))
      .finally(() => setLoading(false))
    fetch("/api/vendedor/cuentas-bancarias")
      .then((r) => r.json())
      .then((d) => setCuentas(d.cuentas || []))
      .catch(() => {})
  }, [id])

  // Comprobantes agrupados por pedido; los sueltos van aparte
  const compsPorPedido = useMemo(() => {
    const m = new Map<string, Comprobante[]>()
    for (const cp of comprobantes) {
      if (!cp.pedido_id) continue
      if (!m.has(cp.pedido_id)) m.set(cp.pedido_id, [])
      m.get(cp.pedido_id)!.push(cp)
    }
    return m
  }, [comprobantes])

  const compsSueltos = useMemo(
    () => comprobantes.filter((cp) => !cp.pedido_id || !pedidos.some((p) => p.id === cp.pedido_id)),
    [comprobantes, pedidos]
  )

  const devsPorPedido = useMemo(() => {
    const m = new Map<string, DevolucionPendiente[]>()
    for (const d of devoluciones) {
      const key = d.pedido_id || "sin_pedido"
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(d)
    }
    return m
  }, [devoluciones])

  // Pedidos que se muestran: con comprobantes pendientes, cobrables, o con devolución
  const pedidosVisibles = useMemo(
    () =>
      pedidos.filter(
        (p) => compsPorPedido.has(p.id) || p.cobrable || p.anticipo_pago_id || devsPorPedido.has(p.id)
      ),
    [pedidos, compsPorPedido, devsPorPedido]
  )

  const totalImputado = Object.values(imputaciones).reduce((s, m) => s + (m || 0), 0)
  const totalPedidos = Object.values(pedidosSel).reduce((s, m) => s + (m || 0), 0)
  const totalAsignado = totalImputado + totalPedidos
  const totalMetodos = efectivo + metodos.reduce((s, m) => s + (m.monto || 0), 0)
  const sobrante = Math.round((totalMetodos - totalAsignado) * 100) / 100

  // ── Selección ──
  const toggleComprobante = (cp: Comprobante) => {
    setImputaciones((prev) => {
      const next = { ...prev }
      if (next[cp.id] !== undefined) delete next[cp.id]
      else next[cp.id] = cp.saldo_pendiente
      return next
    })
  }

  const setMonto = (cpId: string, monto: number, max: number) => {
    setImputaciones((prev) => ({ ...prev, [cpId]: Math.min(Math.max(0, monto), max) }))
  }

  const montoAnticipo = (p: PedidoCobro, contado: boolean) =>
    Math.round((contado ? p.total * 0.9 : p.total) * 100) / 100

  const togglePedido = (p: PedidoCobro) => {
    setPedidosSel((prev) => {
      const next = { ...prev }
      if (next[p.id] !== undefined) delete next[p.id]
      else next[p.id] = montoAnticipo(p, !!contadoSel[p.id])
      return next
    })
  }

  const toggleContado = (p: PedidoCobro) => {
    setContadoSel((prev) => {
      const contado = !prev[p.id]
      setPedidosSel((sel) => (sel[p.id] !== undefined ? { ...sel, [p.id]: montoAnticipo(p, contado) } : sel))
      return { ...prev, [p.id]: contado }
    })
  }

  const setMontoPedido = (p: PedidoCobro, monto: number) => {
    setPedidosSel((prev) => ({ ...prev, [p.id]: Math.min(Math.max(0, monto), p.total) }))
  }

  const seleccionadosDePedido = (pedidoId: string) =>
    (compsPorPedido.get(pedidoId) || []).reduce(
      (s, cp) => s + (imputaciones[cp.id] !== undefined ? imputaciones[cp.id] : 0),
      0
    )

  const updateMetodo = (idx: number, patch: Partial<Metodo>) => {
    setMetodos((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)))
  }

  // ── Fotos → OCR → métodos precargados ──
  const subirFotos = async (files: FileList | null) => {
    if (!files?.length) return
    setSubiendoFotos(true)
    try {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append("files", f)
      const res = await fetch("/api/pagos-clientes/ocr", { method: "POST", body: fd })
      const d = await res.json()
      if (d.error) {
        alert(d.error)
        return
      }
      setFotos((prev) => [...prev, ...(d.archivos || []).map((a: any) => a.url).filter(Boolean)])
      const nuevos: Metodo[] = []
      for (const r of d.resultados || []) {
        if (r.tipo === "cheque") {
          nuevos.push({
            ...nuevoMetodo("cheque"),
            monto: Number(r.monto) || 0,
            banco: r.banco_emisor || "",
            numero_cheque: r.numero_cheque || "",
            fecha_cheque: r.fecha_cheque || "",
            cuit_emisor: r.cuit_emisor || "",
            es_echeq: r.color_cheque === "ECHEQ",
          })
        } else if (r.tipo === "transferencia") {
          nuevos.push({
            ...nuevoMetodo("transferencia"),
            monto: Number(r.monto) || 0,
            referencia_transferencia: r.numero_comprobante || "",
            cuenta_bancaria_id: r.cuenta_bancaria_id || "",
          })
        }
      }
      if (nuevos.length) setMetodos((prev) => [...prev, ...nuevos])
      else if (!(d.resultados || []).length)
        alert("La foto quedó adjunta pero no se detectaron datos. Cargá el cheque/transferencia a mano.")
    } catch {
      alert("Error al subir las fotos")
    } finally {
      setSubiendoFotos(false)
    }
  }

  // ── Confirmar ──
  const confirmar = async () => {
    if (!cliente || enviando) return
    if (totalMetodos <= 0) {
      alert("Ingresá efectivo o sacale foto a los cheques/transferencias.")
      return
    }
    if (sobrante < -0.01) {
      alert(
        `Los métodos de pago (${formatCurrency(totalMetodos)}) no alcanzan lo seleccionado (${formatCurrency(totalAsignado)}). Sacá selección o sumá plata.`
      )
      return
    }
    for (const m of metodos) {
      if (m.monto <= 0) {
        alert("Todos los cheques/transferencias deben tener un monto mayor a cero.")
        return
      }
      if (m.tipo === "cheque" && (!m.banco || !m.numero_cheque || !m.fecha_cheque)) {
        alert("Los cheques requieren banco, número y fecha.")
        return
      }
      if (m.tipo === "transferencia" && !m.cuenta_bancaria_id) {
        alert("Las transferencias requieren la cuenta destino.")
        return
      }
    }

    setEnviando(true)
    try {
      const metodosPayload = [
        ...(efectivo > 0 ? [{ tipo: "efectivo", monto: efectivo }] : []),
        ...metodos.map((m) => ({
          tipo: m.tipo,
          monto: m.monto,
          banco: m.tipo === "cheque" ? m.banco : null,
          numero_cheque: m.tipo === "cheque" ? m.numero_cheque : null,
          fecha_cheque: m.tipo === "cheque" ? m.fecha_cheque : null,
          cuit_emisor: m.tipo === "cheque" ? m.cuit_emisor || null : null,
          es_echeq: m.tipo === "cheque" ? m.es_echeq : false,
          referencia_transferencia: m.tipo === "transferencia" ? m.referencia_transferencia || null : null,
          cuenta_bancaria_id: m.tipo === "transferencia" ? m.cuenta_bancaria_id : null,
        })),
      ]

      const body = {
        clientes: [
          {
            cliente_id: cliente.id,
            imputaciones: Object.entries(imputaciones)
              .filter(([, monto]) => monto > 0)
              .map(([comprobante_id, monto]) => ({ comprobante_id, monto })),
            pedidos: Object.entries(pedidosSel)
              .filter(([, monto]) => monto > 0)
              .map(([pedido_id, monto]) => ({ pedido_id, monto, contado: !!contadoSel[pedido_id] })),
            pago_a_cuenta: Math.max(0, sobrante),
          },
        ],
        metodos: metodosPayload,
        comprobante_urls: fotos,
        observaciones: obs || null,
      }

      const res = await fetch("/api/viajante/cobro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const d = await res.json()
      if (!res.ok || d.error) {
        alert(d.error || "Error al registrar el cobro.")
        return
      }
      alert(`✅ Cobro registrado por ${formatCurrency(totalMetodos)}. Queda pendiente de rendición.`)
      router.push(`/vendedor/clientes/${cliente.id}`)
    } catch {
      alert("Error de conexión al registrar el cobro.")
    } finally {
      setEnviando(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !cliente) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8 text-center">
        <p className="text-red-500 text-xl">{error || "Cliente no encontrado"}</p>
      </div>
    )
  }

  const FilaComprobante = ({ cp }: { cp: Comprobante }) => {
    const activo = imputaciones[cp.id] !== undefined
    return (
      <div className={`rounded-xl border-2 p-3 ${activo ? "border-emerald-500 bg-emerald-50/40" : "border-gray-200 bg-white"}`}>
        <button onClick={() => toggleComprobante(cp)} className="w-full flex items-center justify-between text-left">
          <div>
            <p className="font-bold text-gray-900">
              {activo ? "☑" : "☐"} {cp.tipo_comprobante} {cp.numero_comprobante}
            </p>
            <p className="text-gray-500 text-sm">
              {new Date(cp.fecha + "T00:00:00").toLocaleDateString("es-AR")} · saldo {formatCurrency(cp.saldo_pendiente)}
            </p>
          </div>
        </button>
        {activo && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-gray-500 text-sm">Imputar:</span>
            <input
              type="number"
              inputMode="decimal"
              value={imputaciones[cp.id]}
              onChange={(e) => setMonto(cp.id, parseFloat(e.target.value) || 0, cp.saldo_pendiente)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-right font-bold bg-white"
            />
            <button
              onClick={() => setMonto(cp.id, cp.saldo_pendiente, cp.saldo_pendiente)}
              className="text-emerald-700 text-sm font-bold px-2"
            >
              Total
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-44">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.back()} className="text-2xl leading-none px-1">←</button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold">💵 Cobrar</h1>
          <p className="text-emerald-200 text-sm truncate">
            {cliente.nombre} · debe {formatCurrency(cliente.saldo_actual)}
          </p>
        </div>
      </header>

      <div className="p-4 space-y-6 max-w-2xl mx-auto">
        {/* ══ 1. Qué paga ══ */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">¿Qué está pagando?</h2>

          {/* Devoluciones sin pedido asociado */}
          {devsPorPedido.has("sin_pedido") && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 mb-2 text-sm text-amber-800">
              🔄 Devolución pendiente sin NC:{" "}
              {devsPorPedido
                .get("sin_pedido")!
                .map((d) => `${d.numero_devolucion || "s/n"} ${formatCurrency(d.monto_total)}`)
                .join(" · ")}
              . El saldo baja cuando la oficina la procese.
            </div>
          )}

          {pedidosVisibles.length === 0 && compsSueltos.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-gray-500">
              Sin pedidos ni comprobantes pendientes. Lo que cobres queda como pago a cuenta.
            </div>
          ) : (
            <div className="space-y-2">
              {pedidosVisibles.map((p) => {
                const comps = compsPorPedido.get(p.id) || []
                const devs = devsPorPedido.get(p.id) || []
                const estado = p.facturado
                  ? { label: "FACTURADO", cls: "bg-green-100 text-green-700" }
                  : ESTADO_PEDIDO[p.estado] || { label: p.estado.toUpperCase(), cls: "bg-gray-100 text-gray-600" }
                const seleccionado = pedidosSel[p.id] !== undefined
                const montoDentro = seleccionadosDePedido(p.id)
                const expandido = abierto === p.id

                return (
                  <div
                    key={p.id}
                    className={`bg-white rounded-2xl border-2 overflow-hidden ${
                      seleccionado || montoDentro > 0 ? "border-emerald-500" : "border-gray-200"
                    }`}
                  >
                    {/* Cabecera del pedido */}
                    <button
                      onClick={() => {
                        if (comps.length) setAbierto(expandido ? null : p.id)
                        else if (p.cobrable) togglePedido(p)
                      }}
                      className="w-full p-3 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-gray-900 min-w-0 truncate">
                          {comps.length ? (expandido ? "▾" : "▸") : p.cobrable ? (seleccionado ? "☑" : "☐") : "•"}{" "}
                          Pedido {p.numero_pedido ? `#${p.numero_pedido}` : ""}
                        </p>
                        <p className="font-bold text-gray-900 shrink-0">{formatCurrency(p.total)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${estado.cls}`}>
                          {estado.label}
                        </span>
                        {p.pago_contado_10 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                            ✓ 10% CONTADO
                          </span>
                        )}
                        {p.anticipo_pago_id && !p.facturado && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                            ANTICIPO PAGADO
                          </span>
                        )}
                        {devs.map((d) => (
                          <span
                            key={d.id}
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700"
                          >
                            🔄 DEVOLUCIÓN {formatCurrency(d.monto_total)} SIN NC
                          </span>
                        ))}
                        {comps.length > 0 && (
                          <span className="text-gray-400 text-[11px]">
                            {comps.length} comprobante{comps.length > 1 ? "s" : ""}
                            {montoDentro > 0 ? ` · imputando ${formatCurrency(montoDentro)}` : ""}
                          </span>
                        )}
                        <span className="text-gray-400 text-[11px] ml-auto shrink-0">
                          {new Date(p.fecha + "T00:00:00").toLocaleDateString("es-AR")}
                        </span>
                      </div>
                    </button>

                    {/* Pedido sin facturar seleccionado: monto + 10% contado */}
                    {!comps.length && p.cobrable && seleccionado && (
                      <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-2">
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input
                            type="checkbox"
                            checked={!!contadoSel[p.id]}
                            onChange={() => toggleContado(p)}
                            className="w-5 h-5"
                          />
                          10% contado (cobra el 90%, la NC del 10% sale al facturar)
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 text-sm">Cobrar:</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={pedidosSel[p.id]}
                            onChange={(e) => setMontoPedido(p, parseFloat(e.target.value) || 0)}
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-right font-bold"
                          />
                          <button
                            onClick={() => setMontoPedido(p, montoAnticipo(p, !!contadoSel[p.id]))}
                            className="text-emerald-700 text-sm font-bold px-2"
                          >
                            {contadoSel[p.id] ? "90%" : "Total"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Pedido facturado expandido: sus comprobantes */}
                    {comps.length > 0 && expandido && (
                      <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-2 bg-gray-50/60">
                        {comps.map((cp) => (
                          <FilaComprobante key={cp.id} cp={cp} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Comprobantes sin pedido en la lista */}
              {compsSueltos.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 px-1">
                    Otros comprobantes
                  </p>
                  {compsSueltos.map((cp) => (
                    <FilaComprobante key={cp.id} cp={cp} />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ══ 2. Cómo paga ══ */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">¿Cómo paga?</h2>
          <div className="space-y-3">
            {/* Efectivo */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3">
              <span className="text-2xl">💵</span>
              <span className="font-bold text-gray-700">Efectivo</span>
              <input
                type="number"
                inputMode="decimal"
                value={efectivo || ""}
                onChange={(e) => setEfectivo(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder="0"
                className="flex-1 rounded-xl border border-gray-300 px-3 py-3 text-right font-bold text-xl min-w-0"
              />
            </div>

            {/* Foto de cheques/transferencias */}
            <div className="grid grid-cols-2 gap-2">
              <label className="bg-emerald-600 text-white rounded-2xl py-4 font-bold text-center active:scale-[0.97] transition-transform cursor-pointer">
                📷 Sacar foto
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  className="hidden"
                  disabled={subiendoFotos}
                  onChange={(e) => {
                    subirFotos(e.target.files)
                    e.target.value = ""
                  }}
                />
              </label>
              <label className="bg-white border-2 border-emerald-600 text-emerald-700 rounded-2xl py-4 font-bold text-center active:scale-[0.97] transition-transform cursor-pointer">
                🖼 Galería
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={subiendoFotos}
                  onChange={(e) => {
                    subirFotos(e.target.files)
                    e.target.value = ""
                  }}
                />
              </label>
            </div>
            <p className="text-gray-400 text-xs -mt-1 px-1">
              Cheques y transferencias entran con foto (o desde la galería si te la mandaron por WhatsApp): los
              datos se cargan solos y podés corregirlos.
            </p>
            {subiendoFotos && (
              <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium px-1">
                <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                Leyendo la foto...
              </div>
            )}
            {fotos.length > 0 && (
              <p className="text-gray-500 text-xs px-1">✓ {fotos.length} foto(s) adjuntas al cobro.</p>
            )}

            {/* Cheques / transferencias detectados o manuales */}
            {metodos.map((m, idx) => (
              <div key={idx} className="bg-white rounded-2xl border border-gray-200 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-700">
                    {m.tipo === "cheque" ? "🧾 Cheque" : "🏦 Transferencia"}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={m.monto || ""}
                    onChange={(e) => updateMetodo(idx, { monto: Math.max(0, parseFloat(e.target.value) || 0) })}
                    placeholder="Monto"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-right font-bold min-w-0"
                  />
                  <button
                    onClick={() => setMetodos((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-red-500 text-xl px-1"
                  >
                    ✕
                  </button>
                </div>
                {m.tipo === "cheque" && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={m.banco}
                      onChange={(e) => updateMetodo(idx, { banco: e.target.value })}
                      placeholder="Banco *"
                      className="rounded-lg border border-gray-300 px-3 py-2"
                    />
                    <input
                      value={m.numero_cheque}
                      onChange={(e) => updateMetodo(idx, { numero_cheque: e.target.value })}
                      placeholder="N° cheque *"
                      className="rounded-lg border border-gray-300 px-3 py-2"
                    />
                    <input
                      type="date"
                      value={m.fecha_cheque}
                      onChange={(e) => updateMetodo(idx, { fecha_cheque: e.target.value })}
                      className="rounded-lg border border-gray-300 px-3 py-2"
                    />
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={m.es_echeq}
                        onChange={(e) => updateMetodo(idx, { es_echeq: e.target.checked })}
                        className="w-5 h-5"
                      />
                      Es e-cheq
                    </label>
                    <input
                      value={m.cuit_emisor}
                      onChange={(e) => updateMetodo(idx, { cuit_emisor: e.target.value })}
                      placeholder="CUIT emisor (20-12345678-9)"
                      inputMode="numeric"
                      className="col-span-2 rounded-lg border border-gray-300 px-3 py-2"
                    />
                    <div className="col-span-2">
                      <BcraDeudorChip cuit={m.cuit_emisor} />
                    </div>
                  </div>
                )}
                {m.tipo === "transferencia" && (
                  <div className="grid grid-cols-1 gap-2">
                    <select
                      value={m.cuenta_bancaria_id}
                      onChange={(e) => updateMetodo(idx, { cuenta_bancaria_id: e.target.value })}
                      className="rounded-lg border border-gray-300 px-3 py-2 bg-white"
                    >
                      <option value="">Cuenta destino *</option>
                      {cuentas.map((cb) => (
                        <option key={cb.id} value={cb.id}>
                          {cb.banco}
                          {cb.alias ? ` (${cb.alias})` : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      value={m.referencia_transferencia}
                      onChange={(e) => updateMetodo(idx, { referencia_transferencia: e.target.value })}
                      placeholder="Referencia / N° operación"
                      className="rounded-lg border border-gray-300 px-3 py-2"
                    />
                  </div>
                )}
              </div>
            ))}

            <div className="flex gap-4 px-1">
              <button
                onClick={() => setMetodos((prev) => [...prev, nuevoMetodo("cheque")])}
                className="text-emerald-700 text-sm font-bold"
              >
                + Cheque a mano
              </button>
              <button
                onClick={() => setMetodos((prev) => [...prev, nuevoMetodo("transferencia")])}
                className="text-emerald-700 text-sm font-bold"
              >
                + Transferencia a mano
              </button>
            </div>
          </div>
        </section>

        {/* Observaciones */}
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-gray-500 text-sm block mb-1">Observaciones</label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            placeholder="Opcional..."
          />
        </section>
      </div>

      {/* ══ Resumen fijo ══ */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex justify-between text-sm text-gray-500">
            <span>Asignado {formatCurrency(totalAsignado)}</span>
            <span>Métodos {formatCurrency(totalMetodos)}</span>
          </div>
          {sobrante > 0.01 && (
            <p className="text-emerald-700 text-sm font-bold text-center bg-emerald-50 rounded-lg py-1.5">
              {totalAsignado > 0
                ? `Sobran ${formatCurrency(sobrante)} → quedan a cuenta del cliente`
                : `${formatCurrency(sobrante)} quedan como entrega a cuenta`}
            </p>
          )}
          {sobrante < -0.01 && (
            <p className="text-red-600 text-sm font-bold text-center">
              Faltan {formatCurrency(-sobrante)} en métodos para cubrir lo seleccionado
            </p>
          )}
          <button
            onClick={confirmar}
            disabled={enviando || totalMetodos <= 0 || sobrante < -0.01}
            className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
          >
            {enviando ? "Registrando..." : `Registrar cobro ${formatCurrency(totalMetodos)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
