"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface RendicionData {
  viaje: {
    id: string
    nombre: string
    fecha: string
    estado: string
    usuarios?: { nombre: string; email: string }
  }
  pagos: any[]
  devoluciones: any[]
  gastos: any[]
  cajas?: { id: string; nombre: string }[]
  resumen: {
    total_cobrado: number
    total_devoluciones: number
    total_gastos: number
    fondos_recibidos: number
    efectivo_neto: number
    efectivo_pendiente_rendir?: number
    pagos_por_metodo: Record<string, number>
    pagos_pendientes: number
    devoluciones_pendientes: number
  }
}

export default function RendicionPage() {
  const router = useRouter()
  const params = useParams()
  const viajeId = params.id as string

  const [data, setData] = useState<RendicionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  // Cheques de pagos a cuenta que quedaron con color PENDIENTE: el backend
  // rechaza la rendición hasta que la oficina elija BLANCO/NEGRO.
  const [pagosSinColor, setPagosSinColor] = useState<string[]>([])
  const [colorCheques, setColorCheques] = useState<string>("")

  // Conciliación de la rendición
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [efectivoContado, setEfectivoContado] = useState("")
  const [cajaDestino, setCajaDestino] = useState("")
  const [forzarDiferencia, setForzarDiferencia] = useState(false)

  useEffect(() => {
    fetch(`/api/viajes/${viajeId}/confirmar-rendicion`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) {
          setData(d)
          // Checklist: todos los pendientes marcados por defecto
          setSeleccionados(
            new Set(
              (d.pagos || [])
                .filter((p: any) => p.estado === "pendiente_rendicion")
                .map((p: any) => p.id)
            )
          )
          setEfectivoContado(String(d.resumen?.efectivo_pendiente_rendir ?? ""))
          const chica = (d.cajas || []).find((c: any) => c.nombre === "Caja Chica")
          if (chica) setCajaDestino(chica.id)
        }
      })
      .finally(() => setLoading(false))
  }, [viajeId])

  const togglePago = (id: string) => {
    setSeleccionados((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const handleConfirmar = async () => {
    if (!cajaDestino) {
      alert("Seleccioná la caja destino del efectivo")
      return
    }
    setConfirmando(true)
    try {
      const res = await fetch(`/api/viajes/${viajeId}/confirmar-rendicion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caja_destino_tipo: "CAJA",
          caja_destino_id: cajaDestino,
          efectivo_declarado: parseFloat(efectivoContado) || 0,
          pagos_verificados: [...seleccionados],
          forzar_diferencia: forzarDiferencia,
          ...(colorCheques && pagosSinColor.length
            ? { colores_cheque: Object.fromEntries(pagosSinColor.map((id) => [id, colorCheques])) }
            : {}),
        }),
      })
      const d = await res.json()
      if (d.success) {
        router.push(`/viajes/${viajeId}`)
      } else if (res.status === 400 && Array.isArray(d.pagos_sin_color) && d.pagos_sin_color.length) {
        setPagosSinColor(d.pagos_sin_color)
        alert(
          "Hay cheques de pagos a cuenta sin color asignado. Al volver a confirmar, elegí BLANCO o NEGRO en el modal."
        )
      } else if (res.status === 409 && d.requiere_forzar) {
        setForzarDiferencia(true)
        alert(
          `${d.error}\n\nSi la diferencia es real (faltante/sobrante), volvé a confirmar: quedará documentada en el kardex.`
        )
      } else {
        alert(d.error || "Error al confirmar rendición")
      }
    } finally {
      setConfirmando(false)
      setShowConfirm(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-red-500">No se encontró la rendición.</div>
    )
  }

  const { viaje, pagos, devoluciones, gastos, resumen } = data
  const yaConfirmado = viaje.estado === "completado"

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push(`/viajes/${viajeId}`)}
            className="text-blue-600 text-sm mb-1 hover:underline"
          >
            ← Volver al viaje
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            Rendición: {viaje.nombre}
          </h1>
          <p className="text-gray-500">
            {new Date(viaje.fecha).toLocaleDateString("es-AR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {viaje.usuarios && ` — ${viaje.usuarios.nombre}`}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
          yaConfirmado ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
        }`}>
          {yaConfirmado ? "✓ Confirmado" : "Pendiente de confirmación"}
        </span>
      </div>

      {/* Resumen financiero */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-green-50 rounded-xl p-4 text-center border border-green-200">
          <p className="text-green-700 font-bold text-xl">{formatCurrency(resumen.total_cobrado)}</p>
          <p className="text-xs text-green-600 mt-1">Total cobrado</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-200">
          <p className="text-amber-700 font-bold text-xl">{formatCurrency(resumen.total_devoluciones)}</p>
          <p className="text-xs text-amber-600 mt-1">Devoluciones</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4 text-center border border-red-200">
          <p className="text-red-700 font-bold text-xl">{formatCurrency(resumen.total_gastos)}</p>
          <p className="text-xs text-red-600 mt-1">Gastos del viaje</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 text-center border border-blue-200">
          <p className="text-blue-700 font-bold text-xl">{formatCurrency(resumen.efectivo_neto)}</p>
          <p className="text-xs text-blue-600 mt-1">Efectivo a recibir</p>
        </div>
      </div>

      {/* Desglose por método */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-bold text-gray-700 mb-4">Desglose de cobros por método</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(resumen.pagos_por_metodo).map(([tipo, monto]) => (
            <div key={tipo} className="text-center">
              <p className="text-lg font-bold text-gray-800">{formatCurrency(monto)}</p>
              <p className="text-sm text-gray-500 capitalize">{tipo}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabla de pagos */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="font-bold text-gray-700">
            Cobros registrados ({pagos.length})
          </h2>
          {resumen.pagos_pendientes > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
              {resumen.pagos_pendientes} pendientes
            </span>
          )}
        </div>
        {pagos.length === 0 ? (
          <p className="text-center py-8 text-gray-400">Sin cobros registrados</p>
        ) : (
          <div className="divide-y">
            {pagos.map((p: any) => {
              const esPendiente = p.estado === "pendiente_rendicion"
              return (
                <div key={p.id} className="px-5 py-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {esPendiente && !yaConfirmado && (
                      <input
                        type="checkbox"
                        checked={seleccionados.has(p.id)}
                        onChange={() => togglePago(p.id)}
                        className="mt-1.5 h-4 w-4 accent-green-600"
                        title="Verificado: la plata/valores de este cobro están en la rendición"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">
                        {p.clientes?.razon_social || p.clientes?.nombre || p.cliente_id}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(p.fecha_pago).toLocaleDateString("es-AR")}
                      </p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {(p.pagos_detalle || []).map((d: any, i: number) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {d.tipo_pago}: {formatCurrency(d.monto)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-gray-900">{formatCurrency(p.monto)}</p>
                    {p.estado === "confirmado" ? (
                      p.verificado_por ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          ✓ Verificado{p.verificacion_metodo ? ` (${p.verificacion_metodo})` : ""}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          Confirmado — sin verificar
                        </span>
                      )
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Sin rendir
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Tabla de devoluciones */}
      {devoluciones.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="font-bold text-gray-700">
              Devoluciones ({devoluciones.length})
            </h2>
            {resumen.devoluciones_pendientes > 0 && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                {resumen.devoluciones_pendientes} pendientes
              </span>
            )}
          </div>
          <div className="divide-y">
            {devoluciones.map((d: any) => (
              <div key={d.id} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {d.clientes?.razon_social || d.clientes?.nombre}
                    </p>
                    <p className="text-xs text-gray-400">{d.numero_devolucion}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-amber-700">{formatCurrency(d.monto_total)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      d.estado === "confirmado"
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {d.estado}
                    </span>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {(d.devoluciones_detalle || []).map((item: any, i: number) => (
                    <div key={i} className="text-xs text-gray-500 flex justify-between">
                      <span>{item.articulos?.descripcion || item.articulo_id} × {item.cantidad}</span>
                      <span className={item.es_vendible ? "text-green-600" : "text-red-500"}>
                        {item.condicion || (item.es_vendible ? "vendible" : "no vendible")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gastos del viaje */}
      {gastos.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50">
            <h2 className="font-bold text-gray-700">Gastos del chofer</h2>
          </div>
          <div className="divide-y">
            {gastos.map((g: any, i: number) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800">{g.concepto || "Gasto"}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(g.fecha).toLocaleDateString("es-AR")}
                  </p>
                </div>
                <p className="font-bold text-red-600">{formatCurrency(Math.abs(Number(g.monto)))}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conciliación y confirmación */}
      {!yaConfirmado && (
        <div className="bg-white rounded-xl border-2 border-green-200 p-5 space-y-4 mb-8">
          <h2 className="font-bold text-gray-700">Conciliación de efectivo</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Efectivo esperado (según cobros marcados)
              </label>
              <p className="text-lg font-bold text-gray-800 py-2">
                {formatCurrency(resumen.efectivo_pendiente_rendir ?? 0)}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Efectivo contado (real) *
              </label>
              <input
                type="number"
                min="0"
                value={efectivoContado}
                onChange={(e) => { setEfectivoContado(e.target.value); setForzarDiferencia(false) }}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-lg font-bold focus:border-green-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Caja destino *
              </label>
              <select
                value={cajaDestino}
                onChange={(e) => setCajaDestino(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 focus:border-green-500 outline-none"
              >
                <option value="">Seleccionar…</option>
                {(data.cajas || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
          </div>
          {efectivoContado !== "" &&
            Math.abs((parseFloat(efectivoContado) || 0) - (resumen.efectivo_pendiente_rendir ?? 0)) > 0.01 && (
            <p className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠ Diferencia de {formatCurrency((parseFloat(efectivoContado) || 0) - (resumen.efectivo_pendiente_rendir ?? 0))} entre lo contado y lo registrado. Si es real, quedará documentada en el kardex.
            </p>
          )}
          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-gray-500">
              {seleccionados.size} de {resumen.pagos_pendientes} cobros marcados como verificados.
              Las transferencias quedan para conciliación bancaria.
            </p>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={seleccionados.size === 0 || !cajaDestino}
              className="bg-green-600 text-white px-8 py-4 rounded-xl text-lg font-bold hover:bg-green-700 transition-colors disabled:opacity-40"
            >
              ✓ Confirmar Rendición
            </button>
          </div>
        </div>
      )}

      {/* Modal confirmación */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl">
            <h3 className="text-xl font-bold text-center">Confirmar Rendición</h3>
            <p className="text-gray-600 text-center text-sm">
              Al confirmar, se imputarán los pagos a las cuentas corrientes de los clientes
              y se generarán las notas de crédito por las devoluciones.
            </p>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Pagos a confirmar</span>
                <span className="font-bold">{seleccionados.size}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Devoluciones a confirmar</span>
                <span className="font-bold">{resumen.devoluciones_pendientes}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>Efectivo contado a caja</span>
                <span className="text-green-700">{formatCurrency(parseFloat(efectivoContado) || 0)}</span>
              </div>
              {forzarDiferencia && (
                <p className="text-xs text-amber-700 font-medium pt-1">
                  ⚠ Se confirmará CON diferencia de efectivo (queda documentada).
                </p>
              )}
            </div>
            {pagosSinColor.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2">
                <p className="text-xs text-amber-800 font-medium">
                  Cheques de pagos a cuenta sin color — elegí uno para continuar:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {["BLANCO", "NEGRO"].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColorCheques(colorCheques === c ? "" : c)}
                      className={`py-2 rounded-lg border-2 text-sm font-bold ${
                        colorCheques === c
                          ? "border-green-600 bg-green-600 text-white"
                          : "border-gray-300 text-gray-600"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="py-3 rounded-xl border-2 border-gray-300 font-bold text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmar}
                disabled={confirmando || (pagosSinColor.length > 0 && !colorCheques)}
                className="py-3 rounded-xl bg-green-600 text-white font-bold disabled:opacity-50"
              >
                {confirmando ? "Procesando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
