import { useRef, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router"
import { useNoEnviados, useOnline, useRuntime } from "@gm/core"
import { DS, esEnCurso, ESTADOS_COBRABLES, idClienteViaje, type DetallePedido, type OpCobroAnular } from "../datasets"
import { agregarAlBorrador } from "../datos/borrador-devolucion"
import { esIdLocal, keyDeIdLocal } from "../datos/overlay"
import { rechazosDe, useClienteViaje, useEncolar, useRefrescarFilas, useViaje } from "../datos/hooks"
import { AvisosBcra, fechaHora, formatCurrency, formatDateAR, HojaConfirmar, Pantalla, Rechazos, SinEnviar, useAvisoEntrante, useOverlayDinamico, useToast } from "../ui"

// Ficha del cliente en el viaje (= app/chofer/[viajeId]/cliente/[clienteId]/page.tsx):
// pedido con sus renglones (deslizar para devolver), saldo y devoluciones, cobros
// registrados (con anulación mientras no se rindió), y las dos acciones: Devolución y Cobrar.
// Las dos "hojas" de la web son RUTAS acá: /cobrar y /devolucion (la jerarquía es real).
// Anular un cobro: ?ver=anular:<pagoId>. Un cobro que todavía no salió del equipo se
// anula SIN viajar al servidor (se retira de la cola).

export function Cliente() {
  const navigate = useNavigate()
  const { viajeId = "", clienteId = "" } = useParams<{ viajeId: string; clienteId: string }>()
  const rt = useRuntime()
  const online = useOnline()
  const encolar = useEncolar()
  const ops = useNoEnviados()
  const { cliente: data, cargando } = useClienteViaje(viajeId, clienteId)
  const { viaje } = useViaje(viajeId)
  const { toast, mostrar } = useToast()
  const anular = useOverlayDinamico("anular")
  const [ocupado, setOcupado] = useState(false)
  useAvisoEntrante(mostrar)
  // Con señal, re-leer SOLO esta ficha al entrar
  useRefrescarFilas(DS.clientesViaje, [idClienteViaje(viajeId, clienteId)])

  if (!cargando && !data) {
    return (
      <Pantalla titulo="Cliente" dataset={DS.clientesViaje}>
        <div className="flex flex-1 items-center justify-center p-8 text-center"><p className="text-xl text-red-500">No se encontraron datos del cliente.</p></div>
      </Pantalla>
    )
  }
  if (!data) return <Pantalla titulo="Cliente" dataset={DS.clientesViaje}>{null}</Pantalla>

  const { cliente, pedido, resumen, comprobantes_pendientes, devoluciones, pagos_registrados } = data
  const clienteNombre = cliente?.razon_social || cliente?.nombre || "Cliente"
  const estadoViaje = viaje?.viaje.estado || data.viaje_estado
  const esReadOnly = estadoViaje === "completado"
  const enCurso = esEnCurso(estadoViaje)
  const puedeCobrar = !esReadOnly && ESTADOS_COBRABLES.includes(estadoViaje)
  const rechazos = rechazosDe(ops, "viaje.", viajeId).filter((it) => {
    const p = it.payload as { cliente_id?: string; cobros_extra?: Array<{ cliente_id?: string }> } | null
    return p?.cliente_id === clienteId || !!p?.cobros_extra?.some((c) => c.cliente_id === clienteId)
  })
  const pagoAnular = anular.valor ? pagos_registrados.find((p) => p.id === anular.valor) ?? null : null

  const irADevolucionCon = (item: DetallePedido) => {
    agregarAlBorrador(viajeId, clienteId, {
      articulo_id: item.articulo_id,
      sku: item.articulos?.sku ?? null,
      descripcion: item.articulos?.descripcion || "Artículo",
      // Del pedido: por defecto vuelve TODO lo facturado (se corrige si es parcial)
      cantidad: item.cantidad,
      precio_venta_original: item.precio_final,
      motivo: "otro",
      condicion: "vendible",
      origen: "pedido",
    })
    navigate(`/viajes/${viajeId}/clientes/${clienteId}/devolucion`)
  }

  const confirmarAnulacion = async () => {
    if (!pagoAnular) return
    setOcupado(true)
    try {
      if (esIdLocal(pagoAnular.id)) {
        // Nunca salió del equipo: se resuelve acá, sin viajar al servidor
        const retirado = await rt.outbox.retirar(keyDeIdLocal(pagoAnular.id))
        if (!retirado) return mostrar("Ese cobro se está enviando ahora: esperá unos segundos y volvé a intentar.", "err")
        mostrar("Cobro descartado: nunca llegó al sistema.")
      } else {
        const payload: OpCobroAnular = { viaje_id: viajeId, pago_id: pagoAnular.id, cliente_id: clienteId }
        await encolar("viaje.cobro_anular", payload, `Anular cobro ${clienteNombre} ${formatCurrency(pagoAnular.monto)}`)
        mostrar(online ? "Cobro anulado." : "Anulación guardada en el equipo: se envía al volver la señal.")
      }
      anular.cerrar()
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Pantalla
      titulo={clienteNombre}
      dataset={DS.clientesViaje}
      etiquetaFrescura="Ficha al"
      pie={
        puedeCobrar ? (
          <div className="border-t border-gray-200 bg-white p-4">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => navigate(`/viajes/${viajeId}/clientes/${clienteId}/devolucion`)} disabled={!enCurso} className="min-h-14 rounded-2xl border-2 border-amber-200 bg-amber-100 py-4 text-lg font-bold text-amber-800 active:scale-95 disabled:opacity-40">↩ Devolución</button>
              <button onClick={() => navigate(`/viajes/${viajeId}/clientes/${clienteId}/cobrar`)} className="min-h-14 rounded-2xl bg-blue-600 py-4 text-lg font-bold text-white active:scale-95">💵 Cobrar</button>
            </div>
          </div>
        ) : undefined
      }
    >
      {toast}
      {cliente?.direccion && <div className="truncate bg-blue-700 px-5 pb-3 text-sm text-blue-200">📍 {cliente.direccion}{cliente.telefono ? ` · 📞 ${cliente.telefono}` : ""}</div>}
      {esReadOnly && <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-center text-sm font-medium text-amber-800">Viaje finalizado — solo consulta</div>}
      {data.parcial && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          ⚠ La ficha completa de este cliente todavía no está en el equipo (se ve lo de la hoja de ruta). {online ? "Se está descargando…" : "Con señal se completa sola."}
        </div>
      )}
      <Rechazos items={rechazos} ayuda="Eso NO quedó registrado en el sistema. Revisalo y, si corresponde, cargalo de nuevo." />
      <AvisosBcra />

      <div className="mx-4 mt-4 rounded-2xl bg-blue-700 p-4 text-white">
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div><p className="text-xs text-blue-200">Saldo anterior</p><p className="font-bold text-red-300">{formatCurrency(resumen.saldo_anterior)}</p></div>
          <div><p className="text-xs text-blue-200">Este pedido</p><p className="font-bold">{formatCurrency(resumen.total_pedido)}</p></div>
          <div><p className="text-xs text-blue-200">A cobrar</p><p className="font-bold text-yellow-200">{formatCurrency(resumen.total_a_cobrar)}</p></div>
        </div>
      </div>

      <div className="space-y-4 p-4 pb-6">
        {/* Artículos del pedido — deslizar a la izquierda para devolver */}
        {pedido && (
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <h3 className="font-bold text-gray-700">Pedido #{pedido.numero}</h3>
              {!esReadOnly && enCurso && <span className="text-xs text-gray-400">← deslizá para devolver</span>}
            </div>
            <div className="divide-y divide-gray-100">
              {pedido.detalle.map((item) => (
                <SwipeableItem key={item.id} onDevolver={() => irADevolucionCon(item)} disabled={esReadOnly || !enCurso}>
                  <div className="flex items-center justify-between px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-800">{item.articulos?.descripcion || "Artículo"}</p>
                      <p className="text-xs text-gray-400">{item.articulos?.sku}</p>
                    </div>
                    <div className="ml-3 shrink-0 text-right">
                      <p className="text-xs text-gray-500">{item.cantidad} × {formatCurrency(item.precio_final)}</p>
                      <p className="font-bold text-gray-800">{formatCurrency(item.subtotal)}</p>
                    </div>
                  </div>
                </SwipeableItem>
              ))}
            </div>
            <div className="mx-4 mt-1 flex justify-between border-t py-3 text-sm font-bold">
              <span className="text-gray-700">Total pedido</span>
              <span>{formatCurrency(pedido.total)}</span>
            </div>
          </section>
        )}

        {/* Saldo pendiente + devoluciones juntos */}
        {(comprobantes_pendientes.length > 0 || devoluciones.length > 0) && (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 font-bold text-gray-700">Saldo y Devoluciones</h3>
            <div className="space-y-2">
              {comprobantes_pendientes.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-gray-700">{c.tipo_comprobante} {c.numero_comprobante}</p>
                    <p className="text-xs text-gray-400">{formatDateAR(c.fecha)}</p>
                  </div>
                  <p className="font-bold text-red-600">−{formatCurrency(c.saldo_pendiente)}</p>
                </div>
              ))}
              {devoluciones.map((dev) => (
                <div key={dev.id} className="flex items-center justify-between rounded-xl bg-green-50 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-green-800">↩ Devolución {dev.local ? "" : dev.numero_devolucion}</p>
                    {dev.local ? (
                      <SinEnviar />
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${dev.estado === "pendiente" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                        {dev.estado === "pendiente" ? "pendiente confirmación" : dev.estado === "descontada_sin_enviar" ? "descontada en un cobro sin enviar" : "confirmada"}
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-green-600">+{formatCurrency(dev.monto_total)}</p>
                </div>
              ))}
              {comprobantes_pendientes.length > 0 && devoluciones.length > 0 && (
                <div className="flex justify-between border-t pt-2 text-sm font-bold">
                  <span className="text-gray-700">Neto a cobrar</span>
                  <span className={resumen.total_a_cobrar > 0 ? "text-red-600" : "text-green-600"}>{formatCurrency(resumen.total_a_cobrar)}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {pagos_registrados.length > 0 && (
          <section className="rounded-2xl border border-green-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 font-bold text-green-700">Cobros Registrados</h3>
            {pagos_registrados.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  {p.local ? (
                    <SinEnviar rechazado={p.local.estado === "rechazado"} texto={p.local.estado === "rechazado" ? "rechazado" : p.local.estado === "enviando" ? "enviando…" : "sin enviar"} />
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700">{p.estado === "pendiente_rendicion" ? "Pendiente rendición" : "Confirmado"}</span>
                  )}
                  <p className="mt-0.5 text-xs text-gray-400">{fechaHora(p.created_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="font-bold text-green-700">{formatCurrency(p.monto)}</p>
                  {puedeCobrar && p.estado === "pendiente_rendicion" && (!p.local || p.local.estado !== "rechazado") && (
                    <button onClick={() => anular.abrir(p.id)} className="min-h-10 rounded-lg border border-red-200 px-3 text-xs font-bold text-red-600">Anular</button>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <HojaConfirmar abierta={!!pagoAnular} onCerrar={anular.cerrar} titulo="¿Anular este cobro?" confirmar="Anular cobro" peligro ocupado={ocupado} onConfirmar={() => void confirmarAnulacion()}>
        {pagoAnular && (
          <>
            {formatCurrency(pagoAnular.monto)} de {clienteNombre}.{" "}
            {esIdLocal(pagoAnular.id)
              ? "Todavía no salió del equipo: se descarta acá mismo y no llega al sistema."
              : "Se revierte completo (imputaciones, cheques, billetera). Solo se puede mientras oficina no confirmó la rendición."}
          </>
        )}
      </HojaConfirmar>
    </Pantalla>
  )
}

// ─── SwipeableItem (= web): deslizá a la izquierda para revelar "Devolver" ────

function SwipeableItem({ children, onDevolver, disabled }: { children: ReactNode; onDevolver: () => void; disabled?: boolean }) {
  const [offset, setOffset] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const startX = useRef(0)
  const THRESHOLD = 70
  const BUTTON_W = 90

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return
    startX.current = e.touches[0]!.clientX
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (disabled) return
    const dx = e.touches[0]!.clientX - startX.current
    if (dx < 0) setOffset(Math.max(dx, -BUTTON_W))
  }
  const handleTouchEnd = () => {
    if (disabled) return
    if (offset < -THRESHOLD) { setOffset(-BUTTON_W); setRevealed(true) } else { setOffset(0); setRevealed(false) }
  }
  return (
    <div className="relative overflow-hidden">
      <div className="absolute bottom-0 right-0 top-0 flex items-center justify-center bg-amber-500" style={{ width: BUTTON_W }}>
        <button onClick={() => { setOffset(0); setRevealed(false); onDevolver() }} className="flex h-full w-full flex-col items-center justify-center text-white">
          <span className="text-xl">↩</span>
          <span className="text-xs font-bold">Devolver</span>
        </button>
      </div>
      <div
        className="relative bg-white"
        style={{ transform: `translateX(${offset}px)` }}
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
