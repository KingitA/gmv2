import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useOnline, useRuntime } from "@gm/core"
import { DS, esEnCurso, MOTIVOS_DEVOLUCION, type Articulo, type ItemDevolucion, type OpDevolucion } from "../datasets"
import { guardarBorrador, useBorradorDevolucion } from "../datos/borrador-devolucion"
import { buscarArticulos, useArticulos, useClienteViaje, useEncolar, useViaje, uuidv4 } from "../datos/hooks"
import { dejarAviso, formatCurrency, Pantalla, useBloqueoSalida, useBusqueda, useToast } from "../ui"

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

  const { hoja: hojaDescartar } = useBloqueoSalida(items.length > 0 && !listo, {
    titulo: "¿Descartar la devolución?",
    detalle: `Tenés ${items.length} artículo(s) cargados que todavía no se registraron.`,
    confirmar: "Descartar",
  })
  // Registrada: salir a la ficha sin dejar el formulario en el historial
  useEffect(() => {
    if (listo) navigate(`/viajes/${viajeId}/clientes/${clienteId}`, { replace: true })
  }, [listo, navigate, viajeId, clienteId])

  const resultados = useMemo(() => (q.trim().length >= 2 ? buscarArticulos(articulos, q, 8) : []), [articulos, q])
  const clienteNombre = data?.cliente?.razon_social || data?.cliente?.nombre || "Cliente"
  const estadoViaje = viaje?.viaje.estado || data?.viaje_estado || ""
  const enCurso = esEnCurso(estadoViaje)

  const agregarArticulo = async (a: Articulo) => {
    setQ("")
    if (items.some((x) => x.articulo_id === a.id)) return
    const enPedido = data?.pedido?.detalle.find((d) => d.articulo_id === a.id)
    let precio = 0
    let origen: ItemDevolucion["origen"] = "vieja"
    let aviso: string | null = null
    if (enPedido) {
      precio = enPedido.precio_final
      origen = "pedido"
    } else {
      // Último precio facturado a este cliente (replicado en la ficha)
      const comprado = data?.comprados.find((c) => c.articulo_id === a.id)
      if (comprado) precio = comprado.ultimo_precio
      else if (online) {
        // Nunca se le facturó: el precio al que le iría facturado hoy (= web)
        try {
          const d = await api.get<{ precio?: number | null }>(`/api/chofer/articulo/precio-historico?clienteId=${clienteId}&articuloId=${a.id}`, { timeoutMs: 15_000 })
          precio = Number(d?.precio) || 0
        } catch {
          aviso = "No se pudo consultar el precio: cargalo a mano."
        }
      } else aviso = "Sin señal y sin ventas previas de este artículo al cliente: cargá el precio a mano."
    }
    setBorrador((prev) => ({
      items: [
        ...prev.items,
        {
          articulo_id: a.id,
          sku: a.sku,
          descripcion: a.descripcion,
          cantidad: origen === "pedido" ? enPedido!.cantidad : 1,
          precio_venta_original: precio,
          motivo: "otro",
          condicion: "vendible",
          origen,
          comprobante_venta_id: data?.comprados.find((c) => c.articulo_id === a.id)?.comprobante_venta_id ?? null,
        },
      ],
    }))
    if (aviso) mostrar(aviso, "err")
  }

  const updateItem = (idx: number, patch: Partial<ItemDevolucion>) => setBorrador((prev) => ({ items: prev.items.map((i, n) => (n === idx ? { ...i, ...patch } : i)) }))
  const total = items.reduce((s, i) => s + i.cantidad * i.precio_venta_original, 0)

  const registrar = async () => {
    if (!items.length || enviandoRef.current) return
    if (!enCurso) return mostrar("El viaje no está en curso.", "err")
    for (const i of items) {
      if (i.cantidad <= 0) return mostrar("Todos los artículos necesitan cantidad mayor a cero.", "err")
    }
    enviandoRef.current = true
    setEnviando(true)
    try {
      const payload: OpDevolucion = { viaje_id: viajeId, id: uuidv4(), cliente_id: clienteId, pedido_id: data?.pedido?.id || null, items }
      await encolar("viaje.devolucion", payload, `Devolución ${clienteNombre} ${formatCurrency(total)}`)
      guardarBorrador(viajeId, clienteId, null)
      dejarAviso(online ? `↩ Devolución registrada por ${formatCurrency(total)}. Se procesará al confirmar la rendición.` : `↩ Devolución por ${formatCurrency(total)} guardada en el equipo: se envía al volver la señal.`)
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
            <div className="mb-2 flex items-center justify-between rounded-xl bg-green-50 px-4 py-2">
              <span className="font-medium text-green-700">Total devolución:</span>
              <span className="text-xl font-bold text-green-700">{formatCurrency(total)}</span>
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
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-600">Buscar artículo adicional</label>
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
                <input type="number" inputMode="numeric" min="1" value={item.cantidad || ""} onChange={(e) => updateItem(idx, { cantidad: Math.max(0, parseInt(e.target.value) || 0) })} className="min-h-11 w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-center text-lg font-bold" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Precio unit.{item.precio_venta_original <= 0 ? <span className="font-bold text-amber-700"> · cargalo</span> : null}</label>
                <input type="number" inputMode="decimal" value={item.precio_venta_original || ""} onChange={(e) => updateItem(idx, { precio_venta_original: Math.max(0, parseFloat(e.target.value) || 0) })} className={`min-h-11 w-full rounded-xl border-2 px-3 py-2 text-center text-lg font-bold ${item.precio_venta_original <= 0 ? "border-amber-400 bg-amber-50" : "border-gray-200"}`} />
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
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-right">
              <span className="text-sm text-gray-500">Subtotal: </span>
              <span className="font-bold text-green-600">{formatCurrency(item.cantidad * item.precio_venta_original)}</span>
            </div>
          </div>
        ))}
        {items.length === 0 && !q.trim() && <p className="py-6 text-center text-sm text-gray-400">Deslizá un renglón del pedido en la ficha, o buscá el artículo arriba.</p>}
      </div>
    </Pantalla>
  )
}
