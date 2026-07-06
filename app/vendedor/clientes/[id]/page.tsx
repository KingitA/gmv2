"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface Comprobante {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  total_factura: number
  saldo_pendiente: number
  estado_pago: string
}

interface Pago {
  id: string
  fecha_pago: string
  monto: number
  estado: string
  forma_pago: string | null
  verificado: boolean
}

interface Ficha {
  cliente: {
    id: string
    nombre: string
    razon_social: string | null
    cuit: string | null
    direccion: string | null
    localidad: string | null
    telefono: string | null
    mail: string | null
    condicion_iva: string | null
    condicion_pago: string | null
    metodo_facturacion: string | null
    vendedor_id: string | null
    saldo_actual: number
  }
  comprobantes: Comprobante[]
  pagos_recientes: Pago[]
}

// Badges de doble firma según contrato docs/CONTRATO-API-VIAJANTES.md
function badgePago(estado: string, verificado: boolean) {
  if (estado === "pendiente_rendicion") return { label: "🟡 Sin rendir", cls: "bg-yellow-100 text-yellow-700" }
  if (estado === "confirmado" && !verificado) return { label: "🔵 Rendido s/verif.", cls: "bg-blue-100 text-blue-700" }
  if (estado === "confirmado") return { label: "🟢 Verificado", cls: "bg-green-100 text-green-700" }
  if (estado === "rechazado") return { label: "🔴 Rechazado", cls: "bg-red-100 text-red-700" }
  if (estado === "anulado") return { label: "⚫ Anulado", cls: "bg-gray-200 text-gray-600" }
  return { label: estado, cls: "bg-gray-100 text-gray-600" }
}

export default function VendedorClienteFichaPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Ficha | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vendedores, setVendedores] = useState<{ id: string; nombre: string }[]>([])
  const [reasignando, setReasignando] = useState(false)

  const cargar = () => {
    fetch(`/api/vendedor/cliente/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError("Error al cargar el cliente"))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    cargar()
    fetch("/api/vendedores")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setVendedores(d))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const reasignar = async (vendedorId: string) => {
    if (!vendedorId || vendedorId === data?.cliente.vendedor_id) return
    const destino = vendedores.find((v) => v.id === vendedorId)
    if (!confirm(`¿Reasignar este cliente a ${destino?.nombre}? Va a dejar de aparecer en tu lista.`)) return
    setReasignando(true)
    try {
      const res = await fetch(`/api/vendedor/cliente/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendedor_id: vendedorId }),
      })
      const d = await res.json()
      if (d.error) alert(d.error)
      else {
        alert(`Cliente reasignado a ${d.vendedor.nombre}.`)
        router.push("/vendedor/clientes")
      }
    } finally {
      setReasignando(false)
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
      <div className="flex items-center justify-center min-h-screen p-8">
        <div className="text-center space-y-4">
          <p className="text-red-500 text-xl">{error || "Cliente no encontrado"}</p>
          <button
            onClick={() => router.push("/vendedor/clientes")}
            className="bg-emerald-600 text-white px-6 py-3 rounded-xl text-lg font-medium"
          >
            Volver a clientes
          </button>
        </div>
      </div>
    )
  }

  const { cliente, comprobantes, pagos_recientes } = data

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.push("/vendedor/clientes")} className="text-2xl leading-none px-1">
          ←
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate">{cliente.nombre}</h1>
          <p className="text-emerald-200 text-sm truncate">
            {[cliente.localidad, cliente.cuit].filter(Boolean).join(" · ")}
          </p>
        </div>
      </header>

      <div className="p-4 space-y-5 max-w-2xl mx-auto">
        {/* Saldo */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
          <p className="text-gray-500 text-sm">Saldo de cuenta corriente</p>
          <p className={`text-3xl font-bold mt-1 ${cliente.saldo_actual > 0 ? "text-red-600" : "text-green-600"}`}>
            {formatCurrency(cliente.saldo_actual)}
          </p>
          {cliente.saldo_actual > 0 && <p className="text-gray-400 text-sm mt-1">El cliente debe</p>}
        </section>

        {/* Acciones */}
        <section className="grid grid-cols-3 gap-3">
          <button
            onClick={() => router.push(`/vendedor/pedido/nuevo?cliente=${cliente.id}`)}
            className="bg-emerald-600 text-white rounded-2xl p-4 text-center active:scale-95 transition-transform"
          >
            <p className="text-2xl">🛒</p>
            <p className="font-bold text-sm mt-1">Pedido</p>
          </button>
          <button
            onClick={() => router.push(`/vendedor/clientes/${cliente.id}/cobrar`)}
            className="bg-white border-2 border-emerald-600 text-emerald-700 rounded-2xl p-4 text-center active:scale-95 transition-transform"
          >
            <p className="text-2xl">💵</p>
            <p className="font-bold text-sm mt-1">Cobrar</p>
          </button>
          <button
            onClick={() => router.push(`/vendedor/clientes/${cliente.id}/devolucion`)}
            className="bg-white border-2 border-orange-400 text-orange-600 rounded-2xl p-4 text-center active:scale-95 transition-transform"
          >
            <p className="text-2xl">📦</p>
            <p className="font-bold text-sm mt-1">Devolución</p>
          </button>
        </section>

        {/* Comprobantes con saldo */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-3">Comprobantes pendientes</h2>
          {comprobantes.length ? (
            <div className="space-y-3">
              {comprobantes.map((cp) => (
                <div key={cp.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-gray-900">
                        {cp.tipo_comprobante} {cp.numero_comprobante}
                      </p>
                      <p className="text-gray-500 text-sm">
                        {new Date(cp.fecha + "T00:00:00").toLocaleDateString("es-AR")} · Total{" "}
                        {formatCurrency(cp.total_factura)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-red-600">{formatCurrency(cp.saldo_pendiente)}</p>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                          cp.estado_pago === "parcial"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {cp.estado_pago.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
              <p className="text-4xl mb-2">✅</p>
              <p className="text-gray-500">Sin comprobantes pendientes.</p>
            </div>
          )}
        </section>

        {/* Pagos recientes */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-3">Pagos recientes</h2>
          {pagos_recientes.length ? (
            <div className="space-y-3">
              {pagos_recientes.map((p) => {
                const badge = badgePago(p.estado, p.verificado)
                return (
                  <div
                    key={p.id}
                    className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-gray-900">{formatCurrency(p.monto)}</p>
                      <p className="text-gray-500 text-sm">
                        {new Date(p.fecha_pago + "T00:00:00").toLocaleDateString("es-AR")}
                        {p.forma_pago ? ` · ${p.forma_pago}` : ""}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${badge.cls}`}>{badge.label}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center text-gray-500">
              Sin pagos registrados.
            </div>
          )}
        </section>

        {/* Datos del cliente */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-2">
          <h2 className="text-lg font-bold text-gray-700 mb-1">Ficha</h2>
          {cliente.razon_social && <Dato label="Razón social" valor={cliente.razon_social} />}
          <Dato label="CUIT" valor={cliente.cuit} />
          <Dato label="Condición IVA" valor={cliente.condicion_iva} />
          <Dato label="Método facturación" valor={cliente.metodo_facturacion} />
          <Dato label="Condición de pago" valor={cliente.condicion_pago} />
          <Dato label="Dirección" valor={[cliente.direccion, cliente.localidad].filter(Boolean).join(", ")} />
          {cliente.telefono && (
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500 text-sm">Teléfono</span>
              <a href={`tel:${cliente.telefono}`} className="text-emerald-700 font-bold">
                📞 {cliente.telefono}
              </a>
            </div>
          )}
          {cliente.mail && <Dato label="Email" valor={cliente.mail} />}

          <div className="pt-3 border-t border-gray-100">
            <label className="text-gray-500 text-sm block mb-2">Vendedor asignado</label>
            <select
              value={cliente.vendedor_id || ""}
              onChange={(e) => reasignar(e.target.value)}
              disabled={reasignando}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 bg-white"
            >
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre}
                </option>
              ))}
            </select>
          </div>
        </section>
      </div>
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor: string | null }) {
  return (
    <div className="flex justify-between items-start gap-3 py-1">
      <span className="text-gray-500 text-sm shrink-0">{label}</span>
      <span className="text-gray-900 text-sm font-medium text-right">{valor || "—"}</span>
    </div>
  )
}
