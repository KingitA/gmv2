import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useNoEnviados, useOverlay, type ItemOutbox } from "@gm/core"
import { DS, SEGS, SEG_LABEL, type BonifSeg, type OpBonificaciones, type OpClienteEditar, type OpCobroAnular } from "../../datasets"
import { rechazosDe, useCatalogosFicha, useCliente, useCuenta, useEncolar } from "../../datos/hooks"
import { AvisosBcra, HojaConfirmar, Pantalla, Rechazos, SinEnviar, formatCurrency, useAvisoEntrante, useToast } from "../../ui"
import { HojaNuevaLocalidad, type LocalidadCreada } from "./ClienteNuevo"

// Port de app/vendedor/clientes/[id]/page.tsx. Lee la cuenta del cliente de la réplica
// (+ lo hecho acá sin enviar) y ENCOLA: cliente.editar (compare-and-set por campo),
// cliente.bonificaciones y cobro.anular.

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

const fechaLocal = (f: string) => new Date(`${String(f).slice(0, 10)}T00:00:00`).toLocaleDateString("es-AR")

/** Igual que el PATCH del servidor: texto recortado, "" = null. */
const normal = (v: unknown): unknown => {
  const x = typeof v === "string" ? v.trim() : v
  return x === "" || x === undefined ? null : x
}

/** ¿El rechazo es de ESTE cliente? */
function esDeCliente(it: ItemOutbox, id: string): boolean {
  const p = (it.payload || {}) as { cliente_id?: string; id?: string; clientes?: Array<{ cliente_id?: string }> }
  if (p.cliente_id) return p.cliente_id === id
  if (Array.isArray(p.clientes)) return p.clientes.some((c) => c.cliente_id === id)
  if (it.tipo === "cliente.crear") return p.id === id
  return false
}

export function ClienteFicha() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const encolar = useEncolar()
  const { cuenta, cargando } = useCuenta(id)
  const { cliente: enCartera, cargando: cargandoCartera } = useCliente(id)
  const cat = useCatalogosFicha()
  const ops = useNoEnviados()
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)

  const edicion = useOverlay("editar")
  const edicionBonif = useOverlay("bonif")
  const hojaLocalidad = useOverlay("localidad", "hoja")
  const confReasignar = useOverlay("reasignar", "conf")
  const confEliminar = useOverlay("eliminar", "conf")

  const [form, setForm] = useState<Record<string, string> | null>(null)
  // edición: { "viajante.limpieza_bazar": "10", ... }
  const [bonifEdit, setBonifEdit] = useState<Record<string, string> | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [localidadesNuevas, setLocalidadesNuevas] = useState<LocalidadCreada[]>([])
  const [destino, setDestino] = useState<{ id: string; nombre: string } | null>(null)
  const [aEliminar, setAEliminar] = useState<{ id: string; monto: number } | null>(null)

  // Viajantes del propio usuario: únicos destinos válidos de reasignación
  const vendedores = cat?.vendedores ?? []
  const segmentos = cat?.segmentos ?? SEGS.map((key) => ({ key, label: SEG_LABEL[key] }))
  const localidades = useMemo(
    () => [...(cat?.localidades ?? []), ...localidadesNuevas.filter((n) => !(cat?.localidades ?? []).some((l) => l.id === n.id))],
    [cat?.localidades, localidadesNuevas],
  )
  const cliente = cuenta?.cliente ?? null
  const bonif = { viajante: (enCartera?.bonificaciones?.viajante ?? {}) as BonifSeg, mercaderia: (enCartera?.bonificaciones?.mercaderia ?? {}) as BonifSeg }
  // ¿El viajante actual del cliente impone la lista? → no se elige a mano
  const listaImpuesta = vendedores.find((v) => v.id === cliente?.vendedor_id)?.lista_nombre || null

  const formInicial = (): Record<string, string> => {
    const c = (cliente ?? {}) as unknown as Record<string, string | null>
    const inicial: Record<string, string> = {}
    for (const campo of CAMPOS_TEXTO) inicial[campo.key] = c[campo.key] || ""
    inicial.localidad_id = c.localidad_id || ""
    inicial.localidad = c.localidad || ""
    inicial.provincia = c.provincia || ""
    inicial.condicion_pago = c.condicion_pago || ""
    inicial.condicion_entrega = c.condicion_entrega || ""
    inicial.condicion_iva = c.condicion_iva || ""
    inicial.metodo_facturacion = c.metodo_facturacion || ""
    if (cat?.puede_cambiar_lista) inicial.lista_precio_id = c.lista_precio_id || ""
    return inicial
  }
  const bonifInicial = (): Record<string, string> => {
    const init: Record<string, string> = {}
    for (const s of segmentos) {
      init[`viajante.${s.key}`] = bonif.viajante[s.key] ? String(bonif.viajante[s.key]) : ""
      init[`mercaderia.${s.key}`] = bonif.mercaderia[s.key] ? String(bonif.mercaderia[s.key]) : ""
    }
    return init
  }

  // Se entró directo con el overlay abierto (recarga): armar el formulario con lo que se ve
  useEffect(() => {
    if (edicion.abierto && !form && cliente) setForm(formInicial())
    if (edicionBonif.abierto && !bonifEdit && enCartera) setBonifEdit(bonifInicial())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edicion.abierto, edicionBonif.abierto, !!cliente, !!enCartera])
  // Confirmación abierta sin su dato (recarga): no hay nada que confirmar
  useEffect(() => {
    if (confReasignar.abierto && !destino) confReasignar.cerrar()
    if (confEliminar.abierto && !aEliminar) confEliminar.cerrar()
  }, [confReasignar, confEliminar, destino, aEliminar])

  const rechazos = useMemo(
    () => (id ? rechazosDe(ops, "cliente.").concat(rechazosDe(ops, "cobro.")).filter((it) => esDeCliente(it, id)) : []),
    [ops, id],
  )

  if (!cuenta || !cliente || !id) {
    if (cargando || cargandoCartera) return <Pantalla titulo="Cliente">{null}</Pantalla>
    return (
      <Pantalla titulo="Cliente">
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="space-y-4 text-center">
            <p className="text-xl text-red-500">Cliente no encontrado</p>
            <button onClick={() => navigate("/clientes", { replace: true })} className="rounded-xl bg-emerald-600 px-6 py-3 text-lg font-medium text-white">
              Volver a clientes
            </button>
          </div>
        </div>
      </Pantalla>
    )
  }

  const { comprobantes, pagos_recientes } = cuenta

  // Nombre visible de la condición de entrega (en DB se guarda el código)
  const nombreEntrega = (codigo: string | null) => cat?.condiciones_entrega.find((c) => c.codigo === codigo)?.nombre || codigo
  // La lista que se ve sale del catálogo (así refleja un cambio hecho acá que todavía no se envió)
  const nombreLista = cliente.lista_precio_id
    ? cat?.listas_precio.find((l) => l.id === cliente.lista_precio_id)?.nombre || cliente.lista?.nombre || "—"
    : "Estándar"

  const empezarEdicion = () => {
    setForm(formInicial())
    edicion.abrir()
  }

  // Elegir localidad completa localidad (texto) y provincia automáticamente
  const elegirLocalidad = (localidadId: string) => {
    const loc = localidades.find((l) => l.id === localidadId)
    setForm((prev) => ({ ...(prev || {}), localidad_id: localidadId, localidad: loc?.nombre || "", provincia: loc?.provincia || "" }))
  }

  const guardarFicha = async () => {
    if (!form || guardando) return
    if (!form.nombre?.trim()) {
      mostrar("El nombre no puede quedar vacío.", "err")
      return
    }
    // Compare-and-set por campo: viaja SOLO lo que cambió, con el valor que se estaba viendo
    const actual = cliente as unknown as Record<string, unknown>
    const cambios: OpClienteEditar["cambios"] = {}
    for (const [campo, valor] of Object.entries(form)) {
      const antes = normal(actual[campo])
      const despues = normal(valor)
      if (antes !== despues) cambios[campo] = { antes, despues }
    }
    if (!Object.keys(cambios).length) {
      edicion.cerrar()
      return
    }
    setGuardando(true)
    try {
      await encolar<OpClienteEditar>("cliente.editar", { cliente_id: id, cambios }, `Ficha de ${cliente.nombre}`)
      setForm(null)
      edicion.cerrar()
    } catch {
      mostrar("No se pudo guardar la ficha en el equipo.", "err")
    } finally {
      setGuardando(false)
    }
  }

  const pedirReasignar = (vendedorId: string) => {
    if (!vendedorId || vendedorId === cliente.vendedor_id) return
    const d = vendedores.find((v) => v.id === vendedorId)
    if (!d) return
    setDestino({ id: d.id, nombre: d.nombre })
    confReasignar.abrir()
  }
  const reasignar = async () => {
    if (!destino || guardando) return
    setGuardando(true)
    try {
      await encolar<OpClienteEditar>(
        "cliente.editar",
        { cliente_id: id, cambios: { vendedor_id: { antes: cliente.vendedor_id ?? null, despues: destino.id } } },
        `${cliente.nombre} → ${destino.nombre}`,
      )
      confReasignar.cerrar() // sigue siendo un viajante del usuario: el cliente no desaparece
    } catch {
      mostrar("No se pudo guardar el cambio en el equipo.", "err")
    } finally {
      setGuardando(false)
    }
  }

  const guardarBonif = async () => {
    if (!bonifEdit || guardando) return
    setGuardando(true)
    try {
      const body: { viajante: Record<string, number>; mercaderia: Record<string, number> } = { viajante: {}, mercaderia: {} }
      for (const [k, v] of Object.entries(bonifEdit)) {
        const [tipo, seg] = k.split(".") as ["viajante" | "mercaderia", string]
        body[tipo][seg] = parseFloat(String(v).replace(",", ".")) || 0
      }
      await encolar<OpBonificaciones>("cliente.bonificaciones", { cliente_id: id, viajante: body.viajante, mercaderia: body.mercaderia }, `Descuentos de ${cliente.nombre}`)
      setBonifEdit(null)
      edicionBonif.cerrar()
    } catch {
      mostrar("No se pudieron guardar los descuentos en el equipo.", "err")
    } finally {
      setGuardando(false)
    }
  }

  // Eliminar un cobro propio no rendido (el servidor valida que siga en su poder)
  const eliminarCobro = async () => {
    if (!aEliminar || guardando) return
    setGuardando(true)
    try {
      await encolar<OpCobroAnular>("cobro.anular", { pago_id: aEliminar.id, cliente_id: id }, `Eliminar cobro de ${formatCurrency(aEliminar.monto)} · ${cliente.nombre}`)
      confEliminar.cerrar()
      mostrar("Cobro eliminado. La plata salió de tu billetera y el cliente volvió a deber ese monto.")
    } catch {
      mostrar("No se pudo eliminar el cobro.", "err")
    } finally {
      setGuardando(false)
    }
  }

  const editando = edicion.abierto && !!form
  const editandoBonif = edicionBonif.abierto && !!bonifEdit
  const proy = cliente.saldo_proyectado ?? cliente.saldo_actual
  const hayPendiente = Math.abs(cliente.saldo_actual - proy) > 0.01

  return (
    <Pantalla titulo={cliente.nombre} dataset={DS.cc}>
      {toast}
      <Rechazos items={rechazos} ayuda="Lo que no se aplicó quedó como estaba en el sistema. Revisá la ficha y, si hace falta, volvé a cargarlo." />
      <AvisosBcra />

      <div className="mx-auto w-full max-w-2xl space-y-5 p-4">
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <span className="truncate">{[cliente.localidad, cliente.cuit].filter(Boolean).join(" · ")}</span>
          {cliente.sinEnviar && <SinEnviar />}
        </p>

        {/* Saldo: PROYECTADO primero (lo que va a deber cuando el ERP confirme lo ya cobrado);
            el real, chiquito abajo. Si el vendedor acaba de cobrar, el número grande lo refleja. */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm">
          <p className="text-sm text-gray-500">Saldo {hayPendiente ? "proyectado" : "de cuenta corriente"}</p>
          <p className={`mt-1 text-3xl font-bold ${proy > 0.01 ? "text-red-600" : "text-green-600"}`}>{Math.abs(proy) < 0.01 ? "$ 0,00" : formatCurrency(proy)}</p>
          {proy > 0.01 && <p className="mt-1 text-sm text-gray-400">El cliente debe</p>}
          {hayPendiente && (
            <p className="mt-1 text-xs text-gray-400">
              Real: {formatCurrency(cliente.saldo_actual)} — la diferencia son cobros/devoluciones que el ERP todavía no confirmó
            </p>
          )}
        </section>

        {/* Acciones */}
        <section className="grid grid-cols-3 gap-3">
          <button onClick={() => navigate(`/pedido/nuevo/${cliente.id}`)} className="rounded-2xl bg-emerald-600 p-4 text-center text-white">
            <p className="text-2xl">🛒</p>
            <p className="mt-1 text-sm font-bold">Pedido</p>
          </button>
          <button onClick={() => navigate(`/clientes/${cliente.id}/cobrar`)} className="rounded-2xl border-2 border-emerald-600 bg-white p-4 text-center text-emerald-700">
            <p className="text-2xl">💵</p>
            <p className="mt-1 text-sm font-bold">Cobrar</p>
          </button>
          <button onClick={() => navigate(`/clientes/${cliente.id}/devolucion`)} className="rounded-2xl border-2 border-orange-400 bg-white p-4 text-center text-orange-600">
            <p className="text-2xl">📦</p>
            <p className="mt-1 text-sm font-bold">Devolución</p>
          </button>
        </section>

        {/* Comprobantes con saldo */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-gray-700">Comprobantes pendientes</h2>
          {comprobantes.length ? (
            <div className="space-y-3">
              {comprobantes.map((cp) => (
                <div key={cp.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-gray-900">{cp.tipo_comprobante} {cp.numero_comprobante}</p>
                      <p className="text-sm text-gray-500">{fechaLocal(cp.fecha)} · Total {formatCurrency(cp.total_factura)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-red-600">{formatCurrency(cp.saldo_pendiente)}</p>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${cp.estado_pago === "parcial" ? "bg-orange-100 text-orange-700" : "bg-red-100 text-red-700"}`}>
                        {String(cp.estado_pago || "").toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <p className="mb-2 text-4xl">✅</p>
              <p className="text-gray-500">Sin comprobantes pendientes.</p>
            </div>
          )}
        </section>

        {/* Pagos recientes */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-gray-700">Pagos recientes</h2>
          {pagos_recientes.length ? (
            <div className="space-y-3">
              {pagos_recientes.map((p) => {
                const sinEnviar = p.estado === "sin_enviar"
                const badge = badgePago(p.estado, p.verificado)
                return (
                  <div key={p.id} className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-bold text-gray-900">{formatCurrency(p.monto)}</p>
                      <p className="text-sm text-gray-500">
                        {fechaLocal(p.fecha_pago)}
                        {p.forma_pago ? ` · ${p.forma_pago}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {sinEnviar ? <SinEnviar texto="Sin enviar" /> : <span className={`rounded-full px-2 py-1 text-xs font-bold ${badge.cls}`}>{badge.label}</span>}
                      {!sinEnviar && p.eliminable && (
                        <button
                          onClick={() => { setAEliminar({ id: p.id, monto: p.monto }); confEliminar.abrir() }}
                          className="min-h-11 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-600"
                          title="Eliminar este cobro (solo mientras no lo rendiste)"
                        >
                          🗑 Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center text-gray-500 shadow-sm">Sin pagos registrados.</div>
          )}
        </section>

        {/* Datos del cliente */}
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-700">Ficha</h2>
            {!editando && (
              <button onClick={empezarEdicion} className="min-h-11 text-sm font-bold text-emerald-700">
                ✏️ Editar
              </button>
            )}
          </div>

          {editando && form ? (
            <div className="space-y-3">
              {CAMPOS_TEXTO.map((campo) => (
                <div key={campo.key}>
                  <label className="mb-1 block text-sm text-gray-500">{campo.label}</label>
                  <input
                    type={campo.tipo || "text"}
                    value={form[campo.key] || ""}
                    onChange={(e) => setForm((prev) => ({ ...(prev || {}), [campo.key]: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900"
                  />
                </div>
              ))}

              <div>
                <label className="mb-1 block text-sm text-gray-500">Localidad</label>
                <div className="flex gap-2">
                  <select value={form.localidad_id || ""} onChange={(e) => elegirLocalidad(e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900">
                    <option value="">{form.localidad ? `${form.localidad} (sin vincular)` : "Elegir localidad..."}</option>
                    {localidades.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nombre}{l.provincia ? ` — ${l.provincia}` : ""}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={hojaLocalidad.abrir} className="min-h-11 shrink-0 rounded-xl border-2 border-emerald-600 bg-white px-3 text-sm font-bold text-emerald-700">
                    + Nueva
                  </button>
                </div>
                {form.provincia && <p className="mt-1 text-xs text-gray-400">Provincia: {form.provincia} (se completa sola)</p>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-sm text-gray-500">Condición IVA</label>
                  <select value={form.condicion_iva || ""} onChange={(e) => setForm((prev) => ({ ...(prev || {}), condicion_iva: e.target.value }))} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-gray-900">
                    <option value="">Sin definir</option>
                    {(cat?.condiciones_iva ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-500">Método facturación</label>
                  <select value={form.metodo_facturacion || ""} onChange={(e) => setForm((prev) => ({ ...(prev || {}), metodo_facturacion: e.target.value }))} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-gray-900">
                    <option value="">Sin definir</option>
                    {(cat?.metodos_facturacion ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {cat?.puede_cambiar_lista && !listaImpuesta && (
                <div>
                  <label className="mb-1 block text-sm text-gray-500">Lista de precios</label>
                  <select value={form.lista_precio_id || ""} onChange={(e) => setForm((prev) => ({ ...(prev || {}), lista_precio_id: e.target.value }))} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900">
                    <option value="">Sin lista (cálculo estándar)</option>
                    {cat.listas_precio.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">Cambiar la lista recalcula los precios de los próximos pedidos.</p>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm text-gray-500">Condición de pago</label>
                <select value={form.condicion_pago || ""} onChange={(e) => setForm((prev) => ({ ...(prev || {}), condicion_pago: e.target.value }))} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900">
                  <option value="">Sin definir</option>
                  {(cat?.condiciones_pago ?? []).map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-500">Condición de entrega</label>
                <select value={form.condicion_entrega || ""} onChange={(e) => setForm((prev) => ({ ...(prev || {}), condicion_entrega: e.target.value }))} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900">
                  <option value="">Sin definir</option>
                  {(cat?.condiciones_entrega ?? []).map((c) => <option key={c.id} value={c.codigo}>{c.nombre}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => { setForm(null); edicion.cerrar() }} disabled={guardando} className="rounded-xl border border-gray-300 bg-white py-3 font-bold text-gray-700">
                  Cancelar
                </button>
                <button onClick={() => void guardarFicha()} disabled={guardando} className="rounded-xl bg-emerald-600 py-3 font-bold text-white disabled:bg-gray-300">
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
              <Dato label="Lista de precios" valor={nombreLista + (listaImpuesta ? " (por viajante)" : "")} />
              <Dato label="Condición de pago" valor={cliente.condicion_pago} />
              <Dato label="Condición de entrega" valor={nombreEntrega(cliente.condicion_entrega)} />
              <Dato label="Dirección" valor={[cliente.direccion, cliente.localidad, cliente.provincia].filter(Boolean).join(", ")} />
              {cliente.telefono && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-500">Teléfono</span>
                  <a href={`tel:${cliente.telefono}`} className="font-bold text-emerald-700">📞 {cliente.telefono}</a>
                </div>
              )}
              {cliente.mail && <Dato label="Email" valor={cliente.mail} />}
            </>
          )}

          {vendedores.length > 1 && (
            <div className="border-t border-gray-100 pt-3">
              <label className="mb-2 block text-sm text-gray-500">Vendedor asignado</label>
              <select value={cliente.vendedor_id || ""} onChange={(e) => pedirReasignar(e.target.value)} disabled={guardando} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900">
                {vendedores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}{v.lista_nombre ? ` → lista ${v.lista_nombre}` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                Solo entre los viajantes de tu usuario.
                {vendedores.some((v) => v.lista_nombre) ? " El viajante define la lista de precios del cliente." : ""}
              </p>
            </div>
          )}

          {/* Bonificación por segmento: descuento que el viajante le concede al cliente sobre el
              neto; el catálogo ya lo aplica en el precio y se descuenta de la comisión del viajante */}
          <div className="border-t border-gray-100 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm text-gray-500">Descuentos por segmento (viajante y mercadería)</label>
              {!editandoBonif && (
                <button onClick={() => { setBonifEdit(bonifInicial()); edicionBonif.abrir() }} className="min-h-11 text-sm font-bold text-emerald-700">
                  ✏️ Editar
                </button>
              )}
            </div>
            {editandoBonif && bonifEdit ? (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <span>Segmento</span>
                  <span className="text-center text-orange-600">Viajante</span>
                  <span className="text-center text-green-700">Mercadería</span>
                </div>
                {segmentos.map((s) => (
                  <div key={s.key} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
                    <span className="text-sm text-gray-700">{s.label}</span>
                    {(["viajante", "mercaderia"] as const).map((tipo) => (
                      <div key={tipo} className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={bonifEdit[`${tipo}.${s.key}`] ?? ""}
                          onChange={(e) => setBonifEdit((prev) => ({ ...(prev || {}), [`${tipo}.${s.key}`]: e.target.value.replace(/[^\d.,]/g, "") }))}
                          placeholder="0"
                          className="min-h-11 w-full rounded-lg border border-gray-300 py-2 pl-2 pr-6 text-right font-bold"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                      </div>
                    ))}
                  </div>
                ))}
                <p className="text-xs text-gray-400">
                  <b>Viajante</b>: descuento sobre el neto de cada artículo del segmento; sale de tu comisión.{" "}
                  <b>Mercadería</b>: % del neto del segmento que se entrega en mercadería sin cargo (la arma depósito).
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button onClick={() => { setBonifEdit(null); edicionBonif.cerrar() }} className="min-h-11 rounded-xl border border-gray-300 bg-white py-2.5 text-sm font-bold text-gray-700">
                    Cancelar
                  </button>
                  <button onClick={() => void guardarBonif()} disabled={guardando} className="min-h-11 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:bg-gray-300">
                    {guardando ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {(["viajante", "mercaderia"] as const).map((tipo) => (
                  <div key={tipo} className="flex flex-wrap items-center gap-1.5">
                    <span className={`w-20 text-[11px] font-bold uppercase ${tipo === "viajante" ? "text-orange-600" : "text-green-700"}`}>{tipo === "viajante" ? "Viajante" : "Mercadería"}</span>
                    {segmentos.map((s) => (
                      <span key={s.key} className={`rounded-full px-2.5 py-1 text-xs font-bold ${bonif[tipo][s.key] ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
                        {s.label}: {bonif[tipo][s.key] ? `${bonif[tipo][s.key]}%` : "—"}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {cliente.actualizado_at && (
            <p className="pt-2 text-xs text-gray-400">
              Última modificación:{" "}
              {new Date(cliente.actualizado_at).toLocaleString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              {cliente.actualizado_por_nombre ? ` · por ${cliente.actualizado_por_nombre}` : ""}
            </p>
          )}
        </section>
      </div>

      <HojaNuevaLocalidad
        abierta={hojaLocalidad.abierto}
        zonas={cat?.zonas ?? []}
        onCerrar={hojaLocalidad.cerrar}
        onCreada={(l) => {
          setLocalidadesNuevas((prev) => [...prev.filter((x) => x.id !== l.id), { id: l.id, nombre: l.nombre, provincia: l.provincia }])
          setForm((prev) => ({ ...(prev || {}), localidad_id: l.id, localidad: l.nombre, provincia: l.provincia || "" }))
          hojaLocalidad.cerrar()
        }}
      />

      <HojaConfirmar abierta={confReasignar.abierto && !!destino} onCerrar={confReasignar.cerrar} titulo="Vendedor asignado" confirmar="Asignar" onConfirmar={() => void reasignar()}>
        ¿Asignar este cliente a {destino?.nombre}?
      </HojaConfirmar>

      <HojaConfirmar
        abierta={confEliminar.abierto && !!aEliminar}
        onCerrar={confEliminar.cerrar}
        titulo={`¿Eliminar el cobro de ${formatCurrency(aEliminar?.monto)}?`}
        confirmar="Eliminar"
        peligro
        onConfirmar={() => void eliminarCobro()}
      >
        Solo podés hacerlo mientras la plata siga en tu poder (sin rendir). Se revierte todo: billetera, imputaciones y cheques.
      </HojaConfirmar>
    </Pantalla>
  )
}

function Dato({ label, valor }: { label: string; valor: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-sm text-gray-500">{label}</span>
      <span className="text-right text-sm font-medium text-gray-900">{valor || "—"}</span>
    </div>
  )
}
