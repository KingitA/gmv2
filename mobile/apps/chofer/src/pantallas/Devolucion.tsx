import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { indiceHistorial, useNoEnviados, useOnline, useRuntime } from "@gm/core"
import { DS, esEnCurso, MOTIVOS_DEVOLUCION, type Articulo, type DetallePedido, type ItemDevolucion, type OpDevolucion } from "../datasets"
import { guardarBorrador, useBorradorDevolucion } from "../datos/borrador-devolucion"
import { buscarArticulos, useArticulos, useClienteViaje, useEncolar, useViaje, uuidv4 } from "../datos/hooks"
import { parseMonto } from "@gm/formato"
import { valorEstimadoDevolucion } from "../datos/cuenta-cobro"
import { excedenteSistemaViejo, frena, primerExceso, textoExcedente, textoTope, topeDevolucion, type RenglonParaTope } from "../datos/devolucion-tope"
import { elegirOrigenDevolucion, origenDesdeComprado, type OrigenDevolucion } from "@gm/vendedor"
import { dejarAviso, formatCurrency, GRACIA_TECLADO_MS, MontoInput, Pantalla, useBloqueoSalida, useBusqueda, useToast } from "../ui"
import { CLAVE_VOLVER_A_PARADA } from "./Cobrar"

// Devolución en el reparto (= el sheet "Registrar Devolución" de la ficha web, ahora ruta
// propia). Artículos del pedido entran deslizando el renglón en la ficha; cualquier otro
// se busca en el catálogo replicado. Precio de la mercadería vieja = último precio
// facturado a ESTE cliente (replicado en la ficha); si nunca se le facturó, con señal se
// pide el precio vigente al ERP y sin señal se carga a mano.
// La lista en curso vive en sessionStorage: sobrevive a "atrás" y a cambiar de pantalla.
// Atrás con ítems cargados pide confirmación antes de descartar.

export function Devolucion() {
  const navigate = useNavigate()
  const { viajeId = "", clienteId = "" } = useParams<{ viajeId: string; clienteId: string }>()
  const { api } = useRuntime()
  const online = useOnline()
  const encolar = useEncolar()
  const { cliente: data, cargando } = useClienteViaje(viajeId, clienteId)
  const { viaje } = useViaje(viajeId)
  const { filas: articulos, cargando: cargandoArt } = useArticulos()
  const { toast, mostrar } = useToast()
  const [q, setQ] = useBusqueda("q")
  const [borrador, setBorrador] = useBorradorDevolucion(viajeId, clienteId)
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState(false)
  const enviandoRef = useRef(false)
  const items = borrador.items
  // #25: lo devuelto desde este equipo que todavía no salió también cuenta para el tope
  const ops = useNoEnviados()
  const sinEnviar = useMemo<RenglonParaTope[]>(
    () => ops.filter((o) => o.tipo === "viaje.devolucion" && o.estado !== "rechazado" && (o.payload as OpDevolucion).cliente_id === clienteId).flatMap((o) => (o.payload as OpDevolucion).items),
    [ops, clienteId],
  )
  const tope = (r: RenglonParaTope) => topeDevolucion(data?.devolvible, r, sinEnviar)

  // Un "atrás" justo después de elegir un artículo (el teclado se acaba de cerrar solo) no cuenta
  const graciaTeclado = useRef(0)
  const { hoja: hojaDescartar } = useBloqueoSalida(items.length > 0 && !listo, {
    titulo: "¿Descartar la devolución?",
    detalle: `Tenés ${items.length} artículo(s) cargados que todavía no se registraron.`,
    confirmar: "Descartar",
  }, { ignorarHasta: graciaTeclado })
  // Registrada: volver a donde se entró (ficha o parada del viaje) sin dejar el formulario en el historial
  useEffect(() => {
    if (!listo) return
    try { sessionStorage.setItem(CLAVE_VOLVER_A_PARADA, clienteId) } catch { /* noop */ }
    if (indiceHistorial() >= 1) navigate(-1)
    else navigate(`/viajes/${viajeId}/clientes/${clienteId}`, { replace: true })
  }, [listo, navigate, viajeId, clienteId])

  const resultados = useMemo(() => (q.trim().length >= 2 ? buscarArticulos(articulos, q, 8) : []), [articulos, q])
  const clienteNombre = data?.cliente?.razon_social || data?.cliente?.nombre || "Cliente"
  const estadoViaje = viaje?.viaje.estado || data?.viaje_estado || ""
  const enCurso = esEnCurso(estadoViaje)

  // P2-31 (URQUIZA, 28/10): lo que entra desde la ficha (deslizar → "Devolver") llega SIN comprobante
  // de origen; sin origen no hay tope (C2) ni aviso de "sistema viejo" (C8). Se resuelve acá, igual
  // que el botón "Devolver" de esta pantalla (una vez por artículo).
  const resolviendo = useRef(new Set<string>())
  useEffect(() => {
    if (!data) return
    const faltan = items.filter((x) => x.origen === "pedido" && !x.comprobante_venta_id && !x.origen_comp && !resolviendo.current.has(x.articulo_id))
    for (const x of faltan) {
      resolviendo.current.add(x.articulo_id)
      const enPedido = data.pedido?.detalle.find((d) => d.articulo_id === x.articulo_id)
      void resolverItem(x.articulo_id, enPedido).then(({ precio, origenComp, aviso }) => {
        setBorrador((prev) => ({
          items: prev.items.map((y) => (y.articulo_id === x.articulo_id && !y.origen_comp ? { ...y, precio_venta_original: precio > 0 ? precio : y.precio_venta_original, comprobante_venta_id: origenComp.comprobante_venta_id, origen_comp: origenComp } : y)),
        }))
        if (aviso) mostrar(aviso, "err")
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, data])

  const agregarArticulo = async (a: Articulo) => {
    setQ("")
    graciaTeclado.current = Date.now() + GRACIA_TECLADO_MS
    if (items.some((x) => x.articulo_id === a.id)) return
    const enPedido = data?.pedido?.detalle.find((d) => d.articulo_id === a.id)
    const { precio, origenComp, aviso } = await resolverItem(a.id, enPedido)
    const t = tope({ articulo_id: a.id, cantidad: 0, origen_comp: origenComp })
    if (frena(t) && t.maximo <= 0) return mostrar(textoTope(t, a.descripcion), "err")
    const cantidad = Math.min(enPedido ? enPedido.cantidad : 1, frena(t) ? t.maximo : Infinity)
    setBorrador((prev) => ({
      items: [
        ...prev.items,
        {
          articulo_id: a.id,
          sku: a.sku,
          descripcion: a.descripcion,
          cantidad,
          precio_venta_original: precio,
          motivo: "otro",
          condicion: "vendible",
          origen: enPedido ? "pedido" : "vieja",
          comprobante_venta_id: origenComp.comprobante_venta_id,
          origen_comp: origenComp,
        },
      ],
    }))
    if (aviso) mostrar(aviso, "err")
  }

  // Precio y comprobante de origen (regla del dueño 21/10/2026, = servidor): con señal lo
  // resuelve el ERP (lo del pedido contra la factura de ESE pedido, al neto facturado); sin
  // señal, el último comprobante replicado del artículo; si no hay, precio a mano y el
  // comprobante más reciente del cliente. Al sincronizar, el servidor lo vuelve a resolver.
  async function resolverItem(articuloId: string, enPedido: DetallePedido | undefined) {
    let precio = 0
    let origenComp: OrigenDevolucion | null = null
    let aviso: string | null = null
    if (online) {
      try {
        const pedidoQ = data?.pedido?.id ? `&pedidoId=${data.pedido.id}` : ""
        const d = await api.get<{ precio?: number | null; origen?: OrigenDevolucion | null }>(`/api/chofer/articulo/precio-historico?clienteId=${clienteId}&articuloId=${articuloId}${pedidoQ}`, { timeoutMs: 15_000 })
        precio = Number(d?.precio) || 0
        origenComp = d?.origen ?? null
      } catch {
        aviso = "No se pudo consultar el precio de factura: se usa el del equipo."
      }
    }
    if (!origenComp) {
      const comprado = data?.comprados.find((c) => c.articulo_id === articuloId)
      if (comprado) {
        origenComp = origenDesdeComprado(comprado)
        precio = origenComp.precio ?? comprado.ultimo_precio
      } else {
        origenComp = elegirOrigenDevolucion(null, data?.contexto_devolucion, "factura")
        aviso = aviso ?? "Sin ventas previas de este artículo en el equipo: cargá el precio NETO a mano."
      }
    }
    // Presupuesto: el precio final del pedido es el facturado
    if (!(precio > 0) && enPedido && !origenComp.fiscal) precio = enPedido.precio_final
    return { precio, origenComp, aviso }
  }

  // Del pedido de esta entrega: entra con la cantidad facturada y el precio de la factura (después se ajusta)
  const agregarDelPedido = async (it: DetallePedido) => {
    if (items.some((x) => x.articulo_id === it.articulo_id)) return
    const { precio, origenComp, aviso } = await resolverItem(it.articulo_id, it)
    const t = tope({ articulo_id: it.articulo_id, cantidad: 0, origen_comp: origenComp })
    if (frena(t) && t.maximo <= 0) return mostrar(textoTope(t, it.articulos?.descripcion || undefined), "err")
    setBorrador((prev) => ({
      items: [...prev.items, { articulo_id: it.articulo_id, sku: it.articulos?.sku ?? null, descripcion: it.articulos?.descripcion || "Artículo", cantidad: Math.min(it.cantidad, frena(t) ? t.maximo : Infinity), precio_venta_original: precio, motivo: "otro", condicion: "vendible", origen: "pedido", comprobante_venta_id: origenComp.comprobante_venta_id, origen_comp: origenComp }],
    }))
    if (aviso) mostrar(aviso, "err")
  }
  const delPedidoSinAgregar = (data?.pedido?.detalle ?? []).filter((it) => !items.some((x) => x.articulo_id === it.articulo_id))

  const updateItem = (idx: number, patch: Partial<ItemDevolucion>) => setBorrador((prev) => ({ items: prev.items.map((i, n) => (n === idx ? { ...i, ...patch } : i)) }))
  const total = items.reduce((s, i) => s + i.cantidad * i.precio_venta_original, 0)
  const valorEstimado = valorEstimadoDevolucion(items, data?.comprados ?? [], data?.contexto_devolucion?.alicuota_iibb ?? 0)

  const registrar = async () => {
    if (!items.length || enviandoRef.current) return
    if (!enCurso) return mostrar("El viaje no está en curso.", "err")
    for (const i of items) {
      if (i.cantidad <= 0) return mostrar("Todos los artículos necesitan cantidad mayor a cero.", "err")
    }
    const exceso = primerExceso(data?.devolvible, items, sinEnviar)
    if (exceso) return mostrar(exceso, "err")
    enviandoRef.current = true
    setEnviando(true)
    try {
      // Valor con la regla única (= lo que descontará el cobro y valdrá la NC): el overlay lo usa sin señal
      const payload: OpDevolucion = { viaje_id: viajeId, id: uuidv4(), cliente_id: clienteId, pedido_id: data?.pedido?.id || null, items, valor_estimado: valorEstimado }
      await encolar("viaje.devolucion", payload, `Devolución ${clienteNombre} ${formatCurrency(valorEstimado)}`)
      guardarBorrador(viajeId, clienteId, null)
      dejarAviso(online ? `↩ Devolución registrada por ${formatCurrency(valorEstimado)}. Depósito la revisa; la nota de crédito la emite oficina.` : `↩ Devolución por ${formatCurrency(valorEstimado)} guardada en el equipo: se envía al volver la señal.`)
      setBorrador(() => ({ items: [] }))
      setListo(true)
    } catch {
      enviandoRef.current = false
      setEnviando(false)
      mostrar("No se pudo guardar la devolución en el equipo.", "err")
    }
  }

  if (!cargando && !data) {
    return (
      <Pantalla titulo="Registrar Devolución">
        <div className="flex flex-1 items-center justify-center p-8 text-center"><p className="text-xl text-red-500">No se encontraron datos del cliente.</p></div>
      </Pantalla>
    )
  }

  return (
    <Pantalla
      titulo="Registrar Devolución"
      dataset={DS.articulos}
      etiquetaFrescura="Catálogo al"
      pie={
        items.length > 0 ? (
          <div className="border-t border-gray-200 bg-white p-4">
            {/* Lo que vale para el cliente = precio final de la factura (con el 10 % contado si lo tuvo):
                el mismo número que descuenta el cobro y que llevará la nota de crédito (dueño, 21/10) */}
            <div className="mb-2 rounded-xl bg-green-50 px-4 py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-green-700">Vale para el cliente:</span>
                <span className="text-xl font-bold text-green-700">{formatCurrency(valorEstimado)}</span>
              </div>
              {Math.abs(valorEstimado - total) > 0.005 && (
                <p className="text-xs text-green-700">Neto {formatCurrency(total)} · tal cual fue facturado: + IVA + percepciones, − 10 % si fue contado. Es lo que descuenta el cobro y el importe de la NC.</p>
              )}
            </div>
            <button onClick={() => void registrar()} disabled={enviando || !enCurso} className="min-h-14 w-full rounded-2xl bg-amber-500 py-4 text-xl font-bold text-white active:scale-95 disabled:opacity-50">
              {enviando ? "Guardando..." : "Registrar Devolución"}
            </button>
          </div>
        ) : undefined
      }
    >
      {toast}
      {hojaDescartar}
      <p className="truncate bg-blue-700 px-5 pb-3 text-sm text-blue-200">{clienteNombre}</p>
      {!enCurso && <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-sm text-amber-800">El viaje no está en curso: no se pueden registrar devoluciones.</div>}
      <div className="space-y-5 p-4">
        {/* Primero, el pedido de esta entrega: todo listo para devolver */}
        {data?.pedido && delPedidoSinAgregar.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium text-gray-600">Artículos del pedido #{data.pedido.numero}</p>
            <p className="mb-2 text-xs text-gray-400">Tocá "Devolver" en lo que vuelve; después ajustá la cantidad si no es todo.</p>
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
              {delPedidoSinAgregar.map((it) => (
                <div key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-800">{it.articulos?.descripcion || "Artículo"}</p>
                    <p className="text-xs text-gray-400">{it.articulos?.sku} · {it.cantidad} × {formatCurrency(it.precio_final)}</p>
                  </div>
                  <button onClick={() => agregarDelPedido(it)} disabled={!enCurso} className="min-h-11 shrink-0 rounded-xl bg-amber-500 px-3 text-sm font-bold text-white active:scale-95 disabled:opacity-40">↩ Devolver</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-600">Otro artículo (que no está en este pedido)</label>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU o descripción..." className="min-h-12 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg focus:border-blue-500 focus:outline-none" />
          {q.trim().length >= 2 && !cargandoArt && articulos.length === 0 && <p className="mt-2 text-sm text-amber-700">El catálogo todavía no se descargó en este equipo. Deslizá un renglón del pedido en la ficha para devolverlo.</p>}
          {resultados.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-xl border border-gray-200">
              {resultados.map((art) => (
                <button key={art.id} onClick={() => void agregarArticulo(art)} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 active:bg-blue-50">
                  {art.imagen_url ? <img src={art.imagen_url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg bg-gray-100 object-cover" /> : <div className="h-10 w-10 shrink-0 rounded-lg bg-gray-100" />}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800">{art.descripcion}</p>
                    <p className="text-xs text-gray-400">{art.sku}{art.marca ? ` · ${art.marca}` : ""}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {items.map((item, idx) => (
          <div key={item.articulo_id} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-gray-800">{item.descripcion}</p>
                <p className="text-xs text-gray-400">{item.sku}</p>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{item.origen === "pedido" ? "De este pedido" : "Mercadería vieja"}</span>
              </div>
              <button onClick={() => setBorrador((prev) => ({ items: prev.items.filter((_, i) => i !== idx) }))} aria-label="Quitar" className="min-h-11 min-w-11 text-2xl leading-none text-red-400">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Cantidad</label>
                <input
                  type="text" inputMode="numeric" value={item.cantidad || ""}
                  onChange={(e) => {
                    const n = Math.max(0, Math.trunc(parseMonto(e.target.value.replace(/\D/g, "")) ?? 0))
                    const t = tope(item)
                    if (frena(t) && n > t.maximo) { mostrar(textoTope(t, item.descripcion), "err"); return updateItem(idx, { cantidad: t.maximo }) }
                    updateItem(idx, { cantidad: n })
                  }}
                  className="min-h-11 w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-center text-lg font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Precio unit. {item.origen_comp?.fiscal === false ? "final" : "neto"}{item.precio_venta_original <= 0 ? <span className="font-bold text-amber-700"> · cargalo</span> : null}</label>
                {item.origen_comp?.exacto ? (
                  // Facturado en el sistema: el precio es el de la factura y no se toca
                  <p className="min-h-11 w-full rounded-xl border-2 border-gray-100 bg-gray-50 px-3 py-2 text-center text-lg font-bold text-gray-700">{formatCurrency(item.precio_venta_original)}</p>
                ) : (
                  <MontoInput valor={item.precio_venta_original || 0} onCambio={(n) => updateItem(idx, { precio_venta_original: n })} className={`min-h-11 w-full rounded-xl border-2 px-3 py-2 text-center text-lg font-bold ${item.precio_venta_original <= 0 ? "border-amber-400 bg-amber-50" : "border-gray-200"}`} />
                )}
                {item.origen_comp?.numero_comprobante ? <p className="mt-1 text-[11px] text-gray-400">{item.origen_comp.tipo_comprobante} {item.origen_comp.numero_comprobante}</p> : null}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs text-gray-500">Condición</label>
              <div className="grid grid-cols-2 gap-2">
                {(["vendible", "no_vendible"] as const).map((c) => (
                  <button key={c} onClick={() => updateItem(idx, { condicion: c })} className={`min-h-11 rounded-xl border-2 py-3 text-sm font-bold ${item.condicion === c ? (c === "vendible" ? "border-green-500 bg-green-100 text-green-700" : "border-red-500 bg-red-100 text-red-700") : "border-gray-200 text-gray-400"}`}>
                    {c === "vendible" ? "✓ Vendible" : "✗ No vendible"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs text-gray-500">Motivo</label>
              <div className="flex flex-wrap gap-2">
                {MOTIVOS_DEVOLUCION.map((m) => (
                  <button key={m} onClick={() => updateItem(idx, { motivo: m })} className={`min-h-11 rounded-xl border-2 px-3 py-2 text-sm font-medium ${item.motivo === m ? "border-blue-500 bg-blue-100 text-blue-700" : "border-gray-200 text-gray-500"}`}>
                    {m.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
            {(() => {
              const t = tope(item)
              if (!t) return null
              const exc = excedenteSistemaViejo(t, item.cantidad)
              return (
                <>
                  <p className={`text-xs ${!exc && item.cantidad >= t.maximo ? "font-medium text-amber-700" : "text-gray-500"}`}>{t.presupuesto ? `Presupuesto: se vendieron ${t.vendido}${t.devuelto > 0 ? `, ya se devolvieron ${t.devuelto}` : ""}.` : textoTope(t)}</p>
                  {exc > 0 ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">🕰 {textoExcedente(exc)}</p> : null}
                </>
              )
            })()}
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-right">
              <span className="text-sm text-gray-500">Subtotal: </span>
              <span className="font-bold text-green-600">{formatCurrency(item.cantidad * item.precio_venta_original)}</span>
            </div>
          </div>
        ))}
        {items.length === 0 && !q.trim() && delPedidoSinAgregar.length === 0 && <p className="py-6 text-center text-sm text-gray-400">Buscá el artículo arriba.</p>}
      </div>
    </Pantalla>
  )
}
