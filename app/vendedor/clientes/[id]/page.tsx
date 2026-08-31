"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { NuevaLocalidadSheet } from "@/components/vendedor/NuevaLocalidadSheet"
import { useBackTrap } from "@/lib/vendedor/use-back-trap"

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
    localidad_id: string | null
    provincia: string | null
    telefono: string | null
    mail: string | null
    condicion_iva: string | null
    condicion_pago: string | null
    condicion_entrega: string | null
    metodo_facturacion: string | null
    vendedor_id: string | null
    lista_precio_id: string | null
    lista?: { nombre: string } | null
    saldo_actual: number
    saldo_proyectado?: number
    actualizado_at: string | null
    actualizado_por_nombre: string | null
  }
  comprobantes: Comprobante[]
  pagos_recientes: Pago[]
}

// Campos de texto libre que el vendedor puede editar. Localidad/provincia y
// las condiciones de pago/entrega se editan con listas (catálogos), no texto.
const CAMPOS_TEXTO: Array<{ key: string; label: string; tipo?: "tel" | "email" }> = [
  { key: "nombre", label: "Nombre" },
  { key: "razon_social", label: "Razón social" },
  { key: "cuit", label: "CUIT" },
  { key: "direccion", label: "Dirección" },
  { key: "telefono", label: "Teléfono", tipo: "tel" },
  { key: "mail", label: "Email", tipo: "email" },
]

interface Catalogos {
  condiciones_pago: { id: string; nombre: string }[]
  condiciones_entrega: { id: string; codigo: string; nombre: string }[]
  localidades: { id: string; nombre: string; provincia: string | null }[]
  listas_precio: { id: string; nombre: string }[]
  vendedores: { id: string; nombre: string; lista_precio_id?: string | null; lista_nombre?: string | null }[]
  condiciones_iva: string[]
  metodos_facturacion: string[]
  puede_cambiar_lista?: boolean
  segmentos?: { key: string; label: string }[]
  zonas?: { id: string; nombre: string }[]
}

// Badges de doble firma según contrato docs/CONTRATO-API-VIAJANTES.md
function badgePago(estado: string, verificado: boolean) {
  if (estado === "pendiente_rendicion") return { label: "🟡 Sin rendir", cls: "bg-yellow-100 text-yellow-700" }
  // "Verificado" es SOLO con segunda firma real (verificado_por): un pago
  // recién confirmado por oficina se muestra "Confirmado", no "Verificado".
  if (estado === "confirmado" && !verificado) return { label: "🔵 Confirmado", cls: "bg-blue-100 text-blue-700" }
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
  const [reasignando, setReasignando] = useState(false)
  const [editando, setEditando] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [verNuevaLocalidad, setVerNuevaLocalidad] = useState(false)
  const [catalogos, setCatalogos] = useState<Catalogos>({
    condiciones_pago: [],
    condiciones_entrega: [],
    localidades: [],
    listas_precio: [],
    vendedores: [],
    condiciones_iva: [],
    metodos_facturacion: [],
  })
  // Viajantes del propio usuario: únicos destinos válidos de reasignación
  const vendedores = catalogos.vendedores
  // ¿El viajante actual del cliente impone la lista? → no se elige a mano
  const listaImpuesta = vendedores.find((v) => v.id === data?.cliente.vendedor_id)?.lista_nombre || null

  // Bonificaciones por segmento y tipo (viajante / mercadería)
  type BonifTipos = { viajante: Record<string, number>; mercaderia: Record<string, number> }
  const [bonif, setBonif] = useState<BonifTipos>({ viajante: {}, mercaderia: {} })
  // edición: { "viajante.limpieza_bazar": "10", ... }
  const [bonifEdit, setBonifEdit] = useState<Record<string, string> | null>(null)
  const [bonifGuardando, setBonifGuardando] = useState(false)

  // "Atrás" físico: cierra el alta de localidad / cancela la edición en curso
  // antes de abandonar la ficha
  useBackTrap(() => {
    if (verNuevaLocalidad) { setVerNuevaLocalidad(false); return true }
    if (bonifEdit) { setBonifEdit(null); return true }
    if (editando) { setEditando(false); return true }
    return false
  })
  const cargarBonif = () =>
    fetch(`/api/vendedor/cliente/${id}/bonificaciones`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return
        const b = d.bonificaciones || {}
        setBonif({ viajante: b.viajante || {}, mercaderia: b.mercaderia || {} })
      })
      .catch(() => {})
  const guardarBonif = async () => {
    if (!bonifEdit || bonifGuardando) return
    setBonifGuardando(true)
    try {
      const body: { viajante: Record<string, number>; mercaderia: Record<string, number> } = { viajante: {}, mercaderia: {} }
      for (const [k, v] of Object.entries(bonifEdit)) {
        const [tipo, seg] = k.split(".") as ["viajante" | "mercaderia", string]
        body[tipo][seg] = parseFloat(String(v).replace(",", ".")) || 0
      }
      const res = await fetch(`/api/vendedor/cliente/${id}/bonificaciones`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (d.error) alert(d.error)
      else {
        setBonifEdit(null)
        cargarBonif()
      }
    } finally {
      setBonifGuardando(false)
    }
  }

  // Eliminar un cobro propio no rendido (el server valida que siga en su poder)
  const [eliminando, setEliminando] = useState<string | null>(null)
  const eliminarCobro = async (pagoId: string, monto: number) => {
    if (!window.confirm(`¿Eliminar el cobro de ${formatCurrency(monto)}?\n\nSolo podés hacerlo mientras la plata siga en tu poder (sin rendir). Se revierte todo: billetera, imputaciones y cheques.`)) return
    setEliminando(pagoId)
    try {
      const res = await fetch(`/api/viajante/cobro/${pagoId}`, { method: "DELETE" })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "No se pudo eliminar el cobro")
      alert("Cobro eliminado. La plata salió de tu billetera y el cliente volvió a deber ese monto.")
      cargar()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setEliminando(null)
    }
  }

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
    cargarBonif()
    fetch("/api/vendedor/catalogos-ficha")
      .then((r) => r.json())
      .then((d) => !d.error && setCatalogos(d))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Nombre visible de la condición de entrega (en DB se guarda el código)
  const nombreEntrega = (codigo: string | null) =>
    catalogos.condiciones_entrega.find((c) => c.codigo === codigo)?.nombre || codigo

  const empezarEdicion = () => {
    if (!data) return
    const c = data.cliente as any
    const inicial: Record<string, string> = {}
    for (const campo of CAMPOS_TEXTO) inicial[campo.key] = c[campo.key] || ""
    inicial.localidad_id = c.localidad_id || ""
    inicial.localidad = c.localidad || ""
    inicial.provincia = c.provincia || ""
    inicial.condicion_pago = c.condicion_pago || ""
    inicial.condicion_entrega = c.condicion_entrega || ""
    inicial.condicion_iva = c.condicion_iva || ""
    inicial.metodo_facturacion = c.metodo_facturacion || ""
    if (catalogos.puede_cambiar_lista) inicial.lista_precio_id = c.lista_precio_id || ""
    setForm(inicial)
    setEditando(true)
  }

  // Elegir localidad completa localidad (texto) y provincia automáticamente
  const elegirLocalidad = (localidadId: string) => {
    const loc = catalogos.localidades.find((l) => l.id === localidadId)
    setForm((prev) => ({
      ...prev,
      localidad_id: localidadId,
      localidad: loc?.nombre || "",
      provincia: loc?.provincia || "",
    }))
  }

  const guardarFicha = async () => {
    if (!data || guardando) return
    if (!form.nombre?.trim()) {
      alert("El nombre no puede quedar vacío.")
      return
    }
    setGuardando(true)
    try {
      const res = await fetch(`/api/vendedor/cliente/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const d = await res.json()
      if (d.error) {
        alert(d.error)
        return
      }
      setEditando(false)
      cargar()
    } catch {
      alert("Error de conexión al guardar la ficha.")
    } finally {
      setGuardando(false)
    }
  }

  const reasignar = async (vendedorId: string) => {
    if (!vendedorId || vendedorId === data?.cliente.vendedor_id) return
    const destino = vendedores.find((v) => v.id === vendedorId)
    if (!confirm(`¿Asignar este cliente a ${destino?.nombre}?`)) return
    setReasignando(true)
    try {
      const res = await fetch(`/api/vendedor/cliente/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendedor_id: vendedorId }),
      })
      const d = await res.json()
      if (d.error) alert(d.error)
      else cargar() // sigue siendo un viajante del usuario: el cliente no desaparece
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
        {/* Saldo: PROYECTADO primero (lo que va a deber cuando el ERP confirme
            lo ya cobrado); el real, chiquito abajo. Si el vendedor acaba de
            cobrar, el número grande tiene que reflejarlo. */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
          {(() => {
            const proy = cliente.saldo_proyectado ?? cliente.saldo_actual
            const hayPendiente = Math.abs(cliente.saldo_actual - proy) > 0.01
            return (
              <>
                <p className="text-gray-500 text-sm">Saldo {hayPendiente ? "proyectado" : "de cuenta corriente"}</p>
                <p className={`text-3xl font-bold mt-1 ${proy > 0.01 ? "text-red-600" : "text-green-600"}`}>
                  {Math.abs(proy) < 0.01 ? "$ 0,00" : formatCurrency(proy)}
                </p>
                {proy > 0.01 && <p className="text-gray-400 text-sm mt-1">El cliente debe</p>}
                {hayPendiente && (
                  <p className="text-gray-400 text-xs mt-1">
                    Real: {formatCurrency(cliente.saldo_actual)} — la diferencia son cobros/devoluciones que el
                    ERP todavía no confirmó
                  </p>
                )}
              </>
            )
          })()}
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
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${badge.cls}`}>{badge.label}</span>
                      {(p as any).eliminable && (
                        <button
                          onClick={() => eliminarCobro(p.id, p.monto)}
                          disabled={eliminando === p.id}
                          className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-600 disabled:opacity-50"
                          title="Eliminar este cobro (solo mientras no lo rendiste)"
                        >
                          {eliminando === p.id ? "…" : "🗑 Eliminar"}
                        </button>
                      )}
                    </div>
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
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-700">Ficha</h2>
            {!editando && (
              <button onClick={empezarEdicion} className="text-emerald-700 text-sm font-bold">
                ✏️ Editar
              </button>
            )}
          </div>

          {editando ? (
            <div className="space-y-3">
              {CAMPOS_TEXTO.map((campo) => (
                <div key={campo.key}>
                  <label className="text-gray-500 text-sm block mb-1">{campo.label}</label>
                  <input
                    type={campo.tipo || "text"}
                    value={form[campo.key] || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, [campo.key]: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900"
                  />
                </div>
              ))}

              <div>
                <label className="text-gray-500 text-sm block mb-1">Localidad</label>
                <div className="flex gap-2">
                  <select
                    value={form.localidad_id || ""}
                    onChange={(e) => elegirLocalidad(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 bg-white"
                  >
                    <option value="">
                      {form.localidad ? `${form.localidad} (sin vincular)` : "Elegir localidad..."}
                    </option>
                    {catalogos.localidades.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nombre}
                        {l.provincia ? ` — ${l.provincia}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setVerNuevaLocalidad(true)}
                    className="shrink-0 bg-white border-2 border-emerald-600 text-emerald-700 rounded-xl px-3 font-bold text-sm"
                  >
                    + Nueva
                  </button>
                </div>
                {form.provincia && (
                  <p className="text-gray-400 text-xs mt-1">Provincia: {form.provincia} (se completa sola)</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-500 text-sm block mb-1">Condición IVA</label>
                  <select
                    value={form.condicion_iva || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, condicion_iva: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-3 text-gray-900 bg-white"
                  >
                    <option value="">Sin definir</option>
                    {catalogos.condiciones_iva.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-gray-500 text-sm block mb-1">Método facturación</label>
                  <select
                    value={form.metodo_facturacion || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, metodo_facturacion: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-3 text-gray-900 bg-white"
                  >
                    <option value="">Sin definir</option>
                    {catalogos.metodos_facturacion.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              {catalogos.puede_cambiar_lista && !listaImpuesta && (
                <div>
                  <label className="text-gray-500 text-sm block mb-1">Lista de precios</label>
                  <select
                    value={form.lista_precio_id || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, lista_precio_id: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 bg-white"
                  >
                    <option value="">Sin lista (cálculo estándar)</option>
                    {catalogos.listas_precio.map((l) => (
                      <option key={l.id} value={l.id}>{l.nombre}</option>
                    ))}
                  </select>
                  <p className="text-gray-400 text-xs mt-1">Cambiar la lista recalcula los precios de los próximos pedidos.</p>
                </div>
              )}

              <div>
                <label className="text-gray-500 text-sm block mb-1">Condición de pago</label>
                <select
                  value={form.condicion_pago || ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, condicion_pago: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 bg-white"
                >
                  <option value="">Sin definir</option>
                  {catalogos.condiciones_pago.map((c) => (
                    <option key={c.id} value={c.nombre}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-500 text-sm block mb-1">Condición de entrega</label>
                <select
                  value={form.condicion_entrega || ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, condicion_entrega: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 bg-white"
                >
                  <option value="">Sin definir</option>
                  {catalogos.condiciones_entrega.map((c) => (
                    <option key={c.id} value={c.codigo}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => setEditando(false)}
                  disabled={guardando}
                  className="bg-white border border-gray-300 text-gray-700 rounded-xl py-3 font-bold"
                >
                  Cancelar
                </button>
                <button
                  onClick={guardarFicha}
                  disabled={guardando}
                  className="bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-3 font-bold"
                >
                  {guardando ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          ) : (
            <>
              {cliente.razon_social && <Dato label="Razón social" valor={cliente.razon_social} />}
              <Dato label="CUIT" valor={cliente.cuit} />
              <Dato label="Condición IVA" valor={cliente.condicion_iva} />
              <Dato label="Método facturación" valor={cliente.metodo_facturacion} />
              <Dato
                label="Lista de precios"
                valor={
                  (cliente.lista?.nombre || (cliente.lista_precio_id ? "—" : "Estándar")) +
                  (listaImpuesta ? " (por viajante)" : "")
                }
              />
              <Dato label="Condición de pago" valor={cliente.condicion_pago} />
              <Dato label="Condición de entrega" valor={nombreEntrega(cliente.condicion_entrega)} />
              <Dato
                label="Dirección"
                valor={[cliente.direccion, cliente.localidad, cliente.provincia].filter(Boolean).join(", ")}
              />
              {cliente.telefono && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-gray-500 text-sm">Teléfono</span>
                  <a href={`tel:${cliente.telefono}`} className="text-emerald-700 font-bold">
                    📞 {cliente.telefono}
                  </a>
                </div>
              )}
              {cliente.mail && <Dato label="Email" valor={cliente.mail} />}
            </>
          )}

          {vendedores.length > 1 && (
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
                    {v.lista_nombre ? ` → lista ${v.lista_nombre}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-gray-400 text-xs mt-1">
                Solo entre los viajantes de tu usuario.
                {vendedores.some((v) => v.lista_nombre) ? " El viajante define la lista de precios del cliente." : ""}
              </p>
            </div>
          )}

          {/* Bonificación de viajante por segmento: descuento que el viajante le
              concede al cliente sobre el neto; el catálogo ya lo aplica en el
              precio y se descuenta de la comisión del viajante */}
          <div className="pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <label className="text-gray-500 text-sm">Descuentos por segmento (viajante y mercadería)</label>
              {!bonifEdit ? (
                <button
                  onClick={() => {
                    const init: Record<string, string> = {}
                    for (const s of catalogos.segmentos || []) {
                      init[`viajante.${s.key}`] = bonif.viajante[s.key] ? String(bonif.viajante[s.key]) : ""
                      init[`mercaderia.${s.key}`] = bonif.mercaderia[s.key] ? String(bonif.mercaderia[s.key]) : ""
                    }
                    setBonifEdit(init)
                  }}
                  className="text-emerald-700 text-sm font-bold"
                >
                  ✏️ Editar
                </button>
              ) : null}
            </div>
            {bonifEdit ? (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_5rem_5rem] gap-2 items-center text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <span>Segmento</span>
                  <span className="text-center text-orange-600">Viajante</span>
                  <span className="text-center text-green-700">Mercadería</span>
                </div>
                {(catalogos.segmentos || []).map((s) => (
                  <div key={s.key} className="grid grid-cols-[1fr_5rem_5rem] gap-2 items-center">
                    <span className="text-sm text-gray-700">{s.label}</span>
                    {(["viajante", "mercaderia"] as const).map((tipo) => (
                      <div key={tipo} className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={bonifEdit[`${tipo}.${s.key}`] ?? ""}
                          onChange={(e) =>
                            setBonifEdit((prev) => ({ ...(prev || {}), [`${tipo}.${s.key}`]: e.target.value.replace(/[^\d.,]/g, "") }))
                          }
                          placeholder="0"
                          className="w-full rounded-lg border border-gray-300 pl-2 pr-6 py-2 text-right font-bold"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
                      </div>
                    ))}
                  </div>
                ))}
                <p className="text-gray-400 text-xs">
                  <b>Viajante</b>: descuento sobre el neto de cada artículo del segmento; sale de tu comisión.{" "}
                  <b>Mercadería</b>: % del neto del segmento que se entrega en mercadería sin cargo (la arma depósito).
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button onClick={() => setBonifEdit(null)} className="bg-white border border-gray-300 text-gray-700 rounded-xl py-2.5 font-bold text-sm">
                    Cancelar
                  </button>
                  <button onClick={guardarBonif} disabled={bonifGuardando} className="bg-emerald-600 text-white rounded-xl py-2.5 font-bold text-sm disabled:bg-gray-300">
                    {bonifGuardando ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {(["viajante", "mercaderia"] as const).map((tipo) => (
                  <div key={tipo} className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-[11px] font-bold uppercase w-20 ${tipo === "viajante" ? "text-orange-600" : "text-green-700"}`}>
                      {tipo === "viajante" ? "Viajante" : "Mercadería"}
                    </span>
                    {(catalogos.segmentos || []).map((s) => (
                      <span
                        key={s.key}
                        className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          bonif[tipo][s.key] ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        {s.label}: {bonif[tipo][s.key] ? `${bonif[tipo][s.key]}%` : "—"}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {cliente.actualizado_at && (
            <p className="text-gray-400 text-xs pt-2">
              Última modificación:{" "}
              {new Date(cliente.actualizado_at).toLocaleString("es-AR", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {cliente.actualizado_por_nombre ? ` · por ${cliente.actualizado_por_nombre}` : ""}
            </p>
          )}
        </section>
      </div>

      {verNuevaLocalidad && (
        <NuevaLocalidadSheet
          zonas={catalogos.zonas || []}
          onCerrar={() => setVerNuevaLocalidad(false)}
          onCreada={(l) => {
            setCatalogos((prev) => ({ ...prev, localidades: [...prev.localidades, { id: l.id, nombre: l.nombre, provincia: l.provincia }] }))
            setForm((prev) => ({ ...prev, localidad_id: l.id, localidad: l.nombre, provincia: l.provincia || "" }))
            setVerNuevaLocalidad(false)
          }}
        />
      )}
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
