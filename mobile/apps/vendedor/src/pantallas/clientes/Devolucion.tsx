import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"
import { useNoEnviados, useParamEstado } from "@gm/core"
import { COND_VACIA, DS, type Articulo, type Comprado } from "../../datasets"
import { buscarCatalogo } from "../../datos/busqueda"
import { rechazosDe, useCatalogo, useCliente, useCuenta, useEncolar, uuidv4 } from "../../datos/hooks"
import { useMotorCliente } from "../../datos/precios"
import { Pantalla, Rechazos, SinDescargar, formatCurrency, useToast, useVolver, useBusqueda } from "../../ui"

// Port de app/vendedor/clientes/[id]/devolucion/page.tsx.
// Devolución en la calle — la devolución NO es sobre un pedido: se busca en las COMPRAS
// FACTURADAS del cliente y se devuelve al último precio al que se LE FACTURÓ. Si el artículo
// nunca se le vendió, cartel explícito y opción de agregarlo igual al precio actual del cliente
// (o rechazar la devolución). Condiciones: vendible (repone stock al confirmar) / dañado /
// vencido (no reponen). Sin campo motivo; observaciones libre a nivel devolución.
//
// En la app, el "modo catálogo" de la web es la ruta /clientes/:id/devolucion/catalogo. Las dos
// rutas comparten la lista en curso, que vive en sessionStorage por cliente: sobrevive al cambio
// de ruta y a un "atrás" accidental.

interface ItemDev {
  articulo_id: string
  descripcion: string
  sku: string | null
  cantidad: number
  precio_venta_original: number
  condicion: "vendible" | "dañado" | "vencido"
  comprobante_venta_id: string | null
  fecha_venta_original: string | null
  nunca_facturado: boolean
}

const CONDICIONES: { valor: ItemDev["condicion"]; label: string; hint: string }[] = [
  { valor: "vendible", label: "✅ Vendible", hint: "vuelve al stock" },
  { valor: "dañado", label: "💥 Dañado", hint: "no repone stock" },
  { valor: "vencido", label: "⌛ Vencido", hint: "no repone stock" },
]

// ─── Devolución en curso (sessionStorage por cliente) ────────────────────────

interface Borrador {
  items: ItemDev[]
  obs: string
  /** El catálogo agregó un artículo: al volver, la búsqueda "nunca vendido" ya no corresponde */
  limpiarQ?: boolean
}
const BORRADOR_VACIO: Borrador = { items: [], obs: "" }
const claveBorrador = (clienteId: string) => `gm.vendedor.devolucion.${clienteId}`
const claveOk = (clienteId: string) => `gm.vendedor.devolucion.ok.${clienteId}`

function leerBorrador(clienteId: string | undefined): Borrador {
  if (!clienteId) return BORRADOR_VACIO
  try {
    const b = JSON.parse(sessionStorage.getItem(claveBorrador(clienteId)) || "null") as Borrador | null
    return b && Array.isArray(b.items) ? { items: b.items, obs: b.obs || "", limpiarQ: !!b.limpiarQ } : BORRADOR_VACIO
  } catch {
    return BORRADOR_VACIO
  }
}
function guardarBorrador(clienteId: string, b: Borrador | null) {
  try {
    if (!b || (!b.items.length && !b.obs && !b.limpiarQ)) sessionStorage.removeItem(claveBorrador(clienteId))
    else sessionStorage.setItem(claveBorrador(clienteId), JSON.stringify(b))
  } catch { /* noop */ }
}

function useBorrador(clienteId: string | undefined) {
  const [borrador, setBorradorEstado] = useState<Borrador>(() => leerBorrador(clienteId))
  const actual = useRef(borrador)
  // Se persiste EN EL ACTO (no dentro del updater de React): si enseguida se cambia de ruta,
  // el componente se desmonta y un updater diferido no llegaría a correr.
  const setBorrador = useCallback(
    (f: (prev: Borrador) => Borrador) => {
      const next = f(actual.current)
      actual.current = next
      if (clienteId) guardarBorrador(clienteId, next)
      setBorradorEstado(next)
    },
    [clienteId],
  )
  return [borrador, setBorrador] as const
}

const fechaLocal = (f: string | null | undefined) => (f ? new Date(`${f.slice(0, 10)}T00:00:00`).toLocaleDateString("es-AR") : "")

const Foto = ({ url }: { url: string | null }) =>
  url ? <img src={url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg bg-gray-100 object-cover" /> : <div className="h-11 w-11 shrink-0 rounded-lg bg-gray-100" />

// ─── /clientes/:id/devolucion ────────────────────────────────────────────────

export function Devolucion() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [sp] = useSearchParams()
  const encolar = useEncolar()
  const { cuenta, cargando, descargada } = useCuenta(id)
  const ops = useNoEnviados()
  const { toast, mostrar } = useToast()
  const [q, setQ] = useBusqueda("q")
  const [borrador, setBorrador] = useBorrador(id)
  const [enviando, setEnviando] = useState(false)
  const enviandoRef = useRef(false)
  const ok = sp.get("ok") === "1"

  const { items, obs } = borrador
  const comprados: Comprado[] = useMemo(() => cuenta?.comprados ?? [], [cuenta?.comprados])

  // Se volvió del catálogo con un artículo agregado: limpiar la búsqueda (= la web al agregar)
  useEffect(() => {
    if (!borrador.limpiarQ) return
    setQ("")
    setBorrador((prev) => ({ ...prev, limpiarQ: false }))
  }, [borrador.limpiarQ, setQ, setBorrador])

  const rechazos = useMemo(() => rechazosDe(ops, "devolucion.").filter((it) => (it.payload as { cliente_id?: string } | null)?.cliente_id === id), [ops, id])

  if (ok) {
    let total = 0
    try { total = Number(sessionStorage.getItem(claveOk(id || ""))) || 0 } catch { /* noop */ }
    return (
      <Pantalla titulo="🔄 Devolución">
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <p className="text-6xl">🔄</p>
            <h1 className="text-2xl font-bold text-gray-900">Devolución registrada</h1>
            <p className="text-gray-500">
              {total > 0 ? `Por ${formatCurrency(total)}. ` : ""}Podés descontarla en el próximo cobro; la NC la emite la oficina al confirmarla.
            </p>
            <button onClick={() => navigate(`/clientes/${id}`, { replace: true })} className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white">
              Volver al cliente
            </button>
          </div>
        </div>
      </Pantalla>
    )
  }

  if (!cuenta || !id) {
    return (
      <Pantalla titulo="🔄 Devolución">
        {!cargando && (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="text-xl text-red-500">Cliente no encontrado</p>
          </div>
        )}
      </Pantalla>
    )
  }

  const filtrados = q.trim()
    ? comprados.filter((c) => c.descripcion?.toLowerCase().includes(q.toLowerCase()) || (c.sku || "").toLowerCase().includes(q.toLowerCase()))
    : comprados

  const agregarComprado = (c: Comprado) => {
    if (items.some((i) => i.articulo_id === c.articulo_id)) return
    setBorrador((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          articulo_id: c.articulo_id,
          descripcion: c.descripcion,
          sku: c.sku,
          cantidad: 1,
          precio_venta_original: c.ultimo_precio,
          condicion: "vendible",
          comprobante_venta_id: c.comprobante_venta_id,
          fecha_venta_original: c.ultima_fecha?.slice(0, 10) || null,
          nunca_facturado: false,
        },
      ],
    }))
  }

  const updateItem = (idx: number, patch: Partial<ItemDev>) => setBorrador((prev) => ({ ...prev, items: prev.items.map((i, n) => (n === idx ? { ...i, ...patch } : i)) }))

  const total = items.reduce((s, i) => s + i.cantidad * i.precio_venta_original, 0)

  const irAlCatalogo = (texto: string) => navigate(`/clientes/${id}/devolucion/catalogo${texto.trim() ? `?q=${encodeURIComponent(texto.trim())}` : ""}`)

  const registrar = async () => {
    if (!items.length || enviandoRef.current) return
    for (const i of items) {
      if (i.cantidad <= 0 || i.precio_venta_original <= 0) {
        mostrar("Todos los ítems necesitan cantidad y precio mayores a cero.", "err")
        return
      }
    }
    enviandoRef.current = true
    setEnviando(true)
    try {
      await encolar(
        "devolucion.registrar",
        {
          id: uuidv4(),
          cliente_id: id,
          pedido_id: null,
          items: items.map((i) => ({
            articulo_id: i.articulo_id,
            cantidad: i.cantidad,
            precio_venta_original: i.precio_venta_original,
            condicion: i.condicion,
            comprobante_venta_id: i.comprobante_venta_id,
            fecha_venta_original: i.fecha_venta_original,
          })),
          observaciones: obs || null,
        },
        `Devolución ${cuenta.cliente.nombre} ${formatCurrency(total)}`,
      )
      try { sessionStorage.setItem(claveOk(id), String(total)) } catch { /* noop */ }
      guardarBorrador(id, null)
      navigate(`/clientes/${id}/devolucion?ok=1`, { replace: true })
    } catch {
      mostrar("No se pudo guardar la devolución en el equipo.", "err")
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  const sinResultados = !!q.trim() && filtrados.length === 0

  return (
    <Pantalla
      titulo="🔄 Devolución"
      dataset={DS.cc}
      pie={
        <div className="border-t border-gray-200 bg-white p-4">
          <div className="mx-auto max-w-2xl space-y-2">
            <div className="flex justify-between text-sm text-gray-500">
              <span>{items.length} artículo(s)</span>
              <span>
                Total: <span className="font-bold text-gray-900">{formatCurrency(total)}</span>
              </span>
            </div>
            <button onClick={() => void registrar()} disabled={enviando || !items.length} className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:bg-gray-300">
              {enviando ? "Registrando..." : `Registrar devolución ${formatCurrency(total)}`}
            </button>
          </div>
        </div>
      }
    >
      {toast}
      <Rechazos items={rechazos} ayuda="La devolución rechazada NO quedó registrada. Revisá el motivo y, si corresponde, volvé a cargarla." />
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        <p className="truncate text-sm text-gray-500">{cuenta.cliente.nombre}</p>

        {/* ══ Ítems ya agregados ══ */}
        {items.map((i, idx) => (
          <div key={i.articulo_id} className="space-y-2.5 rounded-2xl border-2 border-emerald-500 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold leading-snug text-gray-900">{i.descripcion}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {i.sku ? `SKU ${i.sku} · ` : ""}
                  {i.nunca_facturado ? <span className="font-bold text-amber-600">NUNCA FACTURADO · precio actual</span> : `último facturado ${fechaLocal(i.fecha_venta_original)}`}
                </p>
              </div>
              <button onClick={() => setBorrador((prev) => ({ ...prev, items: prev.items.filter((_, n) => n !== idx) }))} aria-label="Quitar" className="min-h-11 min-w-11 px-1 text-xl text-red-500">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-[11px] text-gray-400">Cantidad</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={i.cantidad || ""}
                  onChange={(e) => updateItem(idx, { cantidad: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-center font-bold"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-gray-400">Precio unitario</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={i.precio_venta_original || ""}
                  onChange={(e) => updateItem(idx, { precio_venta_original: Math.max(0, parseFloat(e.target.value) || 0) })}
                  className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-right font-bold"
                />
              </div>
            </div>

            <div className="flex gap-1.5">
              {CONDICIONES.map((c) => (
                <button
                  key={c.valor}
                  onClick={() => updateItem(idx, { condicion: c.valor })}
                  className={`min-h-11 flex-1 rounded-xl border-2 py-2 text-xs font-bold ${i.condicion === c.valor ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-200 bg-white text-gray-500"}`}
                >
                  {c.label}
                  <span className={`block text-[9px] font-medium ${i.condicion === c.valor ? "text-emerald-100" : "text-gray-400"}`}>{c.hint}</span>
                </button>
              ))}
            </div>

            <p className="text-right text-sm text-gray-600">
              Subtotal: <span className="font-bold text-gray-900">{formatCurrency(i.cantidad * i.precio_venta_original)}</span>
            </p>
          </div>
        ))}

        {/* ══ Buscador sobre las COMPRAS del cliente ══ */}
        <section className="space-y-2">
          <h2 className="text-lg font-bold text-gray-700">¿Qué devuelve?</h2>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar en lo que le vendimos..."
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-lg outline-none"
          />
          {cargando ? null : sinResultados ? (
            <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <p className="font-bold text-amber-800">⚠️ Este artículo nunca fue vendido a este cliente.</p>
              <p className="text-sm text-amber-700">Podés agregarlo igual al precio actual del cliente, o rechazar la devolución.</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => irAlCatalogo(q)} className="rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white">
                  Agregar igual
                </button>
                <button onClick={() => setQ("")} className="rounded-xl border-2 border-gray-300 bg-white py-3 text-sm font-bold text-gray-600">
                  Rechazar devolución
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filtrados
                .filter((c) => !items.some((i) => i.articulo_id === c.articulo_id))
                .slice(0, 30)
                .map((c) => (
                  <button key={c.articulo_id} onClick={() => agregarComprado(c)} className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left">
                    <Foto url={c.imagen_url} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-snug text-gray-900">{c.descripcion}</p>
                      <p className="text-xs text-gray-400">
                        {c.tipo_comprobante} {c.numero_comprobante} · {fechaLocal(c.ultima_fecha)}
                        {` · llevó ${c.cantidad_total}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] text-gray-400">facturado</p>
                      <p className="font-bold text-emerald-700">{formatCurrency(c.ultimo_precio)}</p>
                    </div>
                  </button>
                ))}
              {!comprados.length && (
                <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center text-sm text-gray-500">
                  {descargada || cuenta.cliente.sinEnviar
                    ? "Este cliente no tiene compras facturadas. Si igual trae mercadería, buscala en el catálogo:"
                    : "Todavía no se descargaron las compras de este cliente en este equipo. Si igual trae mercadería, buscala en el catálogo:"}
                  <button onClick={() => irAlCatalogo("")} className="mt-3 block w-full rounded-xl bg-emerald-600 py-3 font-bold text-white">
                    Buscar en el catálogo
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Observaciones */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <label className="mb-1 block text-sm text-gray-500">Observaciones</label>
          <textarea
            value={obs}
            onChange={(e) => setBorrador((prev) => ({ ...prev, obs: e.target.value }))}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            placeholder="Opcional: estado de la mercadería, acuerdo con el cliente..."
          />
        </section>
      </div>
    </Pantalla>
  )
}

// ─── /clientes/:id/devolucion/catalogo — artículo NUNCA facturado a este cliente ─

export function DevolucionCatalogo() {
  const { id } = useParams<{ id: string }>()
  const volver = useVolver()
  const { cliente } = useCliente(id)
  const { indice, cargando, vacio } = useCatalogo()
  const [q, setQ] = useBusqueda("q")
  const [borrador, setBorrador] = useBorrador(id)
  // Cliente dado de alta acá (todavía sin insumos de precio replicados): nace con su lista y método
  const fichaLocal = useMemo(
    () => (cliente?.sinEnviar ? { lista_precio_id: cliente.lista_precio_id, metodo_facturacion: cliente.metodo_facturacion } : null),
    [cliente?.sinEnviar, cliente?.lista_precio_id, cliente?.metodo_facturacion],
  )
  const motor = useMotorCliente(id, COND_VACIA, fichaLocal)

  const resultados = useMemo(() => buscarCatalogo(indice, q), [indice, q])

  // Artículo nunca facturado a este cliente: entra al precio ACTUAL (motor local = previewPrecioArticulo)
  const agregarDeCatalogo = (a: Articulo) => {
    if (!borrador.items.some((i) => i.articulo_id === a.id)) {
      const precio = motor.precio(a.id)?.precio ?? 0
      setBorrador((prev) => ({
        ...prev,
        limpiarQ: true,
        items: [
          ...prev.items,
          {
            articulo_id: a.id,
            descripcion: a.descripcion,
            sku: a.sku,
            cantidad: 1,
            precio_venta_original: precio,
            condicion: "vendible",
            comprobante_venta_id: null,
            fecha_venta_original: null,
            nunca_facturado: true,
          },
        ],
      }))
    }
    volver()
  }

  return (
    <Pantalla titulo="🔄 Devolución" dataset={DS.articulos}>
      <div className="mx-auto w-full max-w-2xl space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-gray-700">Catálogo — nunca facturado</h2>
          <button onClick={() => volver()} className="min-h-11 text-sm font-bold text-emerald-700">
            ← Volver a sus compras
          </button>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar artículo, SKU o EAN..."
          autoFocus
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-lg outline-none"
        />
        {cargando ? null : vacio ? (
          <SinDescargar que="el catálogo" />
        ) : (
          <div className="space-y-2">
            {resultados.map((a) => (
              <button key={a.id} onClick={() => agregarDeCatalogo(a)} className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left">
                <Foto url={a.imagen_url} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-snug text-gray-900">{a.descripcion}</p>
                  <p className="text-xs font-bold text-amber-600">NUNCA FACTURADO · entra al precio actual</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Pantalla>
  )
}
