"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

// Pantalla de cobro del viajante — contrato docs/CONTRATO-API-VIAJANTES.md
// POST /api/viajante/cobro (Fase E). Si el backend todavía no expone el
// endpoint, se muestra el aviso correspondiente al confirmar.

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

interface PedidoCobrable {
  id: string
  numero_pedido: string | null
  fecha: string
  estado: string
  total: number
}

interface Cliente {
  id: string
  nombre: string
  saldo_actual: number
}

interface Metodo {
  tipo: "efectivo" | "cheque" | "transferencia"
  monto: number
  banco: string
  numero_cheque: string
  fecha_cheque: string
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

const nuevoMetodo = (tipo: Metodo["tipo"] = "efectivo"): Metodo => ({
  tipo,
  monto: 0,
  banco: "",
  numero_cheque: "",
  fecha_cheque: "",
  es_echeq: false,
  referencia_transferencia: "",
  cuenta_bancaria_id: "",
})

export default function VendedorCobrarPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [pedidosCobrables, setPedidosCobrables] = useState<PedidoCobrable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [imputaciones, setImputaciones] = useState<Record<string, number>>({})
  // Pedidos sin facturar seleccionados: monto a cobrar + flag 10% contado
  const [pedidosSel, setPedidosSel] = useState<Record<string, number>>({})
  const [contadoSel, setContadoSel] = useState<Record<string, boolean>>({})
  const [pagoACuenta, setPagoACuenta] = useState(0)
  const [metodos, setMetodos] = useState<Metodo[]>([nuevoMetodo()])
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
          setPedidosCobrables(d.pedidos_cobrables || [])
        }
      })
      .catch(() => setError("Error al cargar el cliente"))
      .finally(() => setLoading(false))
    fetch("/api/vendedor/cuentas-bancarias")
      .then((r) => r.json())
      .then((d) => setCuentas(d.cuentas || []))
      .catch(() => {})
  }, [id])

  const totalImputado = Object.values(imputaciones).reduce((s, m) => s + (m || 0), 0)
  const totalPedidos = Object.values(pedidosSel).reduce((s, m) => s + (m || 0), 0)
  const totalCobro = totalImputado + totalPedidos + (pagoACuenta || 0)
  const totalMetodos = metodos.reduce((s, m) => s + (m.monto || 0), 0)
  const diferencia = Math.round((totalMetodos - totalCobro) * 100) / 100

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

  // Pedido sin facturar: al seleccionarlo cobra el total (90% si es contado)
  const montoAnticipo = (p: PedidoCobrable, contado: boolean) =>
    Math.round((contado ? p.total * 0.9 : p.total) * 100) / 100

  const togglePedido = (p: PedidoCobrable) => {
    setPedidosSel((prev) => {
      const next = { ...prev }
      if (next[p.id] !== undefined) delete next[p.id]
      else next[p.id] = montoAnticipo(p, !!contadoSel[p.id])
      return next
    })
  }

  const toggleContado = (p: PedidoCobrable) => {
    setContadoSel((prev) => {
      const contado = !prev[p.id]
      // Si el pedido está seleccionado, reajustar el monto al nuevo modo
      setPedidosSel((sel) => (sel[p.id] !== undefined ? { ...sel, [p.id]: montoAnticipo(p, contado) } : sel))
      return { ...prev, [p.id]: contado }
    })
  }

  const setMontoPedido = (p: PedidoCobrable, monto: number) => {
    setPedidosSel((prev) => ({ ...prev, [p.id]: Math.min(Math.max(0, monto), p.total) }))
  }

  // Agrupar comprobantes por pedido (los sueltos van a "Otros comprobantes")
  const gruposComprobantes = (() => {
    const grupos = new Map<string, { titulo: string; comps: Comprobante[] }>()
    for (const cp of comprobantes) {
      const key = cp.pedido_id || "otros"
      const titulo = cp.pedido_id
        ? `Pedido ${cp.pedido?.numero_pedido ? `#${cp.pedido.numero_pedido}` : ""}`.trim()
        : "Otros comprobantes"
      if (!grupos.has(key)) grupos.set(key, { titulo, comps: [] })
      grupos.get(key)!.comps.push(cp)
    }
    return [...grupos.entries()].sort(([a], [b]) => (a === "otros" ? 1 : b === "otros" ? -1 : 0))
  })()

  const updateMetodo = (idx: number, patch: Partial<Metodo>) => {
    setMetodos((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)))
  }

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
      const resultados = d.resultados || []
      setFotos((prev) => [...prev, ...resultados.map((r: any) => r.url).filter(Boolean)])
      // Prellenar métodos con lo detectado por OCR
      for (const r of resultados) {
        if (r.tipo === "cheque") {
          setMetodos((prev) => [
            ...prev.filter((m) => m.monto > 0 || m.tipo !== "efectivo"),
            {
              ...nuevoMetodo("cheque"),
              monto: Number(r.monto) || 0,
              banco: r.banco || "",
              numero_cheque: r.numero || "",
              fecha_cheque: r.fecha || "",
            },
          ])
        } else if (r.tipo === "transferencia") {
          setMetodos((prev) => [
            ...prev.filter((m) => m.monto > 0 || m.tipo !== "efectivo"),
            {
              ...nuevoMetodo("transferencia"),
              monto: Number(r.monto) || 0,
              referencia_transferencia: r.numero || "",
            },
          ])
        }
      }
    } catch {
      alert("Error al subir las fotos")
    } finally {
      setSubiendoFotos(false)
    }
  }

  const confirmar = async () => {
    if (!cliente || enviando) return
    if (totalCobro <= 0) {
      alert("Ingresá al menos una imputación o un pago a cuenta.")
      return
    }
    if (Math.abs(diferencia) > 0.01) {
      alert("La suma de los métodos de pago tiene que coincidir con el total del cobro.")
      return
    }
    for (const m of metodos) {
      if (m.monto <= 0) {
        alert("Todos los métodos de pago deben tener un monto mayor a cero.")
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
            pago_a_cuenta: pagoACuenta || 0,
          },
        ],
        metodos: metodos.map((m) => ({
          tipo: m.tipo,
          monto: m.monto,
          banco: m.tipo === "cheque" ? m.banco : null,
          numero_cheque: m.tipo === "cheque" ? m.numero_cheque : null,
          fecha_cheque: m.tipo === "cheque" ? m.fecha_cheque : null,
          es_echeq: m.tipo === "cheque" ? m.es_echeq : false,
          referencia_transferencia: m.tipo === "transferencia" ? m.referencia_transferencia || null : null,
          cuenta_bancaria_id: m.tipo === "transferencia" ? m.cuenta_bancaria_id : null,
        })),
        comprobante_urls: fotos,
        observaciones: obs || null,
      }

      const res = await fetch("/api/viajante/cobro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (res.status === 404) {
        alert("El módulo de cobranzas todavía no está habilitado en el servidor (Fase E pendiente). El cobro NO se registró.")
        return
      }
      const d = await res.json()
      if (!res.ok || d.error) {
        alert(d.error || "Error al registrar el cobro.")
        return
      }
      alert(`✅ Cobro registrado por ${formatCurrency(totalCobro)}. Queda pendiente de rendición.`)
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

  return (
    <div className="min-h-screen bg-gray-50 pb-36">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.back()} className="text-2xl leading-none px-1">←</button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold">💵 Cobrar</h1>
          <p className="text-emerald-200 text-sm truncate">
            {cliente.nombre} · debe {formatCurrency(cliente.saldo_actual)}
          </p>
        </div>
      </header>

      <div className="p-4 space-y-5 max-w-2xl mx-auto">
        {/* Pedidos sin facturar (anticipo) */}
        {pedidosCobrables.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-gray-700 mb-2">Pedidos sin facturar</h2>
            <div className="space-y-2">
              {pedidosCobrables.map((p) => {
                const activo = pedidosSel[p.id] !== undefined
                const contado = !!contadoSel[p.id]
                return (
                  <div
                    key={p.id}
                    className={`bg-white rounded-xl border-2 p-3 ${activo ? "border-emerald-500" : "border-gray-200"}`}
                  >
                    <button onClick={() => togglePedido(p)} className="w-full flex items-center justify-between text-left">
                      <div>
                        <p className="font-bold text-gray-900">
                          {activo ? "☑" : "☐"} Pedido {p.numero_pedido ? `#${p.numero_pedido}` : ""}
                          <span className="ml-2 inline-block bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full text-[10px] font-bold align-middle">
                            SIN FACTURAR
                          </span>
                        </p>
                        <p className="text-gray-500 text-sm">
                          {new Date(p.fecha + "T00:00:00").toLocaleDateString("es-AR")} · total{" "}
                          {formatCurrency(p.total)}
                        </p>
                      </div>
                    </button>
                    {activo && (
                      <div className="mt-2 space-y-2">
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input
                            type="checkbox"
                            checked={contado}
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
                            onClick={() => setMontoPedido(p, montoAnticipo(p, contado))}
                            className="text-emerald-700 text-sm font-bold px-2"
                          >
                            {contado ? "90%" : "Total"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Comprobantes a imputar, agrupados por pedido */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">Comprobantes a cobrar</h2>
          {comprobantes.length ? (
            <div className="space-y-3">
              {gruposComprobantes.map(([key, grupo]) => (
                <div key={key} className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 px-1">
                    {grupo.titulo}
                  </p>
                  {grupo.comps.map((cp) => {
                    const activo = imputaciones[cp.id] !== undefined
                    return (
                      <div
                        key={cp.id}
                        className={`bg-white rounded-xl border-2 p-3 ${activo ? "border-emerald-500" : "border-gray-200"}`}
                      >
                        <button onClick={() => toggleComprobante(cp)} className="w-full flex items-center justify-between text-left">
                          <div>
                            <p className="font-bold text-gray-900">
                              {activo ? "☑" : "☐"} {cp.tipo_comprobante} {cp.numero_comprobante}
                            </p>
                            <p className="text-gray-500 text-sm">
                              {new Date(cp.fecha + "T00:00:00").toLocaleDateString("es-AR")} · saldo{" "}
                              {formatCurrency(cp.saldo_pendiente)}
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
                              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-right font-bold"
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
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-gray-500">
              Sin comprobantes pendientes.
              {pedidosCobrables.length ? " Podés cobrar un pedido sin facturar o registrar un pago a cuenta." : " Podés registrar un pago a cuenta."}
            </div>
          )}
        </section>

        {/* Pago a cuenta */}
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-gray-700 font-bold block mb-2">Pago a cuenta</label>
          <input
            type="number"
            inputMode="decimal"
            value={pagoACuenta || ""}
            onChange={(e) => setPagoACuenta(Math.max(0, parseFloat(e.target.value) || 0))}
            placeholder="0"
            className="w-full rounded-lg border border-gray-300 px-3 py-3 text-right font-bold text-lg"
          />
        </section>

        {/* Métodos de pago */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-gray-700">Métodos de pago</h2>
            <button
              onClick={() => setMetodos((prev) => [...prev, nuevoMetodo()])}
              className="text-emerald-700 font-bold text-sm"
            >
              + Agregar
            </button>
          </div>
          <div className="space-y-3">
            {metodos.map((m, idx) => (
              <div key={idx} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={m.tipo}
                    onChange={(e) => updateMetodo(idx, { tipo: e.target.value as Metodo["tipo"] })}
                    className="rounded-lg border border-gray-300 px-3 py-2 bg-white font-medium"
                  >
                    <option value="efectivo">💵 Efectivo</option>
                    <option value="cheque">🧾 Cheque</option>
                    <option value="transferencia">🏦 Transferencia</option>
                  </select>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={m.monto || ""}
                    onChange={(e) => updateMetodo(idx, { monto: Math.max(0, parseFloat(e.target.value) || 0) })}
                    placeholder="Monto"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-right font-bold"
                  />
                  {metodos.length > 1 && (
                    <button
                      onClick={() => setMetodos((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-red-500 text-xl px-1"
                    >
                      ✕
                    </button>
                  )}
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
          </div>
        </section>

        {/* Fotos comprobantes (OCR) */}
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-gray-700 font-bold block mb-2">📷 Fotos de cheques/comprobantes</label>
          <input
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            onChange={(e) => subirFotos(e.target.files)}
            disabled={subiendoFotos}
            className="w-full text-sm"
          />
          {subiendoFotos && <p className="text-emerald-700 text-sm mt-2">Procesando con OCR...</p>}
          {fotos.length > 0 && (
            <p className="text-gray-500 text-sm mt-2">✓ {fotos.length} foto(s) adjuntas — datos detectados precargados en métodos.</p>
          )}
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

      {/* Resumen fijo */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex justify-between text-sm text-gray-500">
            <span>
              Comprob. {formatCurrency(totalImputado)}
              {totalPedidos > 0 ? ` + pedidos ${formatCurrency(totalPedidos)}` : ""} + a cuenta{" "}
              {formatCurrency(pagoACuenta || 0)}
            </span>
            <span>Métodos {formatCurrency(totalMetodos)}</span>
          </div>
          {Math.abs(diferencia) > 0.01 && (
            <p className="text-red-600 text-sm font-bold text-center">
              Diferencia: {formatCurrency(diferencia)} — los métodos deben igualar el total
            </p>
          )}
          <button
            onClick={confirmar}
            disabled={enviando || totalCobro <= 0 || Math.abs(diferencia) > 0.01}
            className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
          >
            {enviando ? "Registrando..." : `Registrar cobro ${formatCurrency(totalCobro)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
