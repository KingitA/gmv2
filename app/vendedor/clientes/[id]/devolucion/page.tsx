"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { previewPrecioArticulo } from "@/lib/actions/pedidos"
import { useBackTrap } from "@/lib/vendedor/use-back-trap"

// Devolución en la calle — la devolución NO es sobre un pedido: se busca en
// las COMPRAS FACTURADAS del cliente y se devuelve al último precio al que se
// LE FACTURÓ. Si el artículo nunca se le vendió, cartel explícito y opción de
// agregarlo igual al precio actual del cliente (o rechazar la devolución).
// Condiciones: vendible (repone stock al confirmar) / dañado / vencido (no
// reponen). Sin campo motivo; observaciones libre a nivel devolución.

interface Comprado {
  articulo_id: string
  sku: string | null
  descripcion: string
  imagen_url: string | null
  ultimo_precio: number
  ultima_fecha: string
  comprobante_venta_id: string
  numero_comprobante: string
  tipo_comprobante: string
  cantidad_total: number
}

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

export default function VendedorDevolucionPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [clienteNombre, setClienteNombre] = useState("")
  const [comprados, setComprados] = useState<Comprado[]>([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState("")

  // "Nunca vendido": búsqueda en catálogo para agregar igual
  const [modoCatalogo, setModoCatalogo] = useState(false)
  const [qCat, setQCat] = useState("")
  const [resultadosCat, setResultadosCat] = useState<any[]>([])
  const [buscandoCat, setBuscandoCat] = useState(false)
  const debounceCat = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [items, setItems] = useState<ItemDev[]>([])
  const [obs, setObs] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState<string | null>(null)

  // "Atrás" físico: sale del modo catálogo ("nunca vendido") o limpia la
  // búsqueda antes de abandonar la pantalla
  useBackTrap(() => {
    if (ok) return false // pantalla de éxito: salir normal
    if (modoCatalogo) { setModoCatalogo(false); setQCat(""); setResultadosCat([]); return true }
    if (q) { setQ(""); return true }
    return false
  })

  useEffect(() => {
    Promise.all([
      fetch(`/api/vendedor/cliente/${id}`).then((r) => r.json()),
      fetch(`/api/vendedor/cliente/${id}/comprados`).then((r) => r.json()),
    ])
      .then(([cli, comp]) => {
        if (!cli.error) setClienteNombre(cli.cliente?.nombre || "")
        if (!comp.error) setComprados(comp.comprados || [])
      })
      .catch(() => {})
      .finally(() => setCargando(false))
  }, [id])

  const filtrados = q.trim()
    ? comprados.filter(
        (c) =>
          c.descripcion?.toLowerCase().includes(q.toLowerCase()) ||
          (c.sku || "").toLowerCase().includes(q.toLowerCase())
      )
    : comprados

  const buscarCatalogo = (valor: string) => {
    setQCat(valor)
    if (debounceCat.current) clearTimeout(debounceCat.current)
    if (!valor.trim()) {
      setResultadosCat([])
      return
    }
    setBuscandoCat(true)
    debounceCat.current = setTimeout(() => {
      fetch(`/api/vendedor/articulos?vista=buscar&cliente=${id}&q=${encodeURIComponent(valor)}`)
        .then((r) => r.json())
        .then((d) => setResultadosCat(d.articulos || []))
        .catch(() => setResultadosCat([]))
        .finally(() => setBuscandoCat(false))
    }, 400)
  }

  const agregarComprado = (c: Comprado) => {
    if (items.some((i) => i.articulo_id === c.articulo_id)) return
    setItems((prev) => [
      ...prev,
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
    ])
  }

  // Artículo nunca facturado a este cliente: entra al precio ACTUAL
  const agregarDeCatalogo = async (a: any) => {
    if (items.some((i) => i.articulo_id === a.id)) return
    let precio = 0
    try {
      const p = await previewPrecioArticulo(id, a.id, {})
      precio = p.precio
    } catch {}
    setItems((prev) => [
      ...prev,
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
    ])
    setModoCatalogo(false)
    setQCat("")
    setResultadosCat([])
    setQ("")
  }

  const updateItem = (idx: number, patch: Partial<ItemDev>) =>
    setItems((prev) => prev.map((i, n) => (n === idx ? { ...i, ...patch } : i)))

  const total = items.reduce((s, i) => s + i.cantidad * i.precio_venta_original, 0)

  const registrar = async () => {
    if (!items.length || enviando) return
    for (const i of items) {
      if (i.cantidad <= 0 || i.precio_venta_original <= 0) {
        alert("Todos los ítems necesitan cantidad y precio mayores a cero.")
        return
      }
    }
    setEnviando(true)
    try {
      const res = await fetch("/api/viajante/devolucion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      })
      const d = await res.json()
      if (!res.ok || d.error) {
        alert(d.error || "Error al registrar la devolución.")
        return
      }
      setOk(d.numero_devolucion)
    } catch {
      alert("Error de conexión.")
    } finally {
      setEnviando(false)
    }
  }

  if (ok) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center max-w-md w-full space-y-4">
          <p className="text-6xl">🔄</p>
          <h1 className="text-2xl font-bold text-gray-900">Devolución registrada</h1>
          <p className="text-gray-500">
            {ok} por {formatCurrency(total)}. Podés descontarla en el próximo cobro; la NC la emite la
            oficina al confirmarla.
          </p>
          <button
            onClick={() => router.push(`/vendedor/clientes/${id}`)}
            className="w-full bg-emerald-600 text-white rounded-xl py-4 text-lg font-bold"
          >
            Volver al cliente
          </button>
        </div>
      </div>
    )
  }

  const sinResultados = !cargando && q.trim() && filtrados.length === 0

  return (
    <div className="min-h-screen bg-gray-50 pb-40">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.back()} className="text-2xl leading-none px-1">←</button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold">🔄 Devolución</h1>
          <p className="text-emerald-200 text-sm truncate">{clienteNombre}</p>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* ══ Ítems ya agregados ══ */}
        {items.map((i, idx) => (
          <div key={i.articulo_id} className="bg-white rounded-2xl border-2 border-emerald-500 p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-gray-900 text-sm leading-snug">{i.descripcion}</p>
                <p className="text-gray-400 text-xs mt-0.5">
                  {i.sku ? `SKU ${i.sku} · ` : ""}
                  {i.nunca_facturado ? (
                    <span className="text-amber-600 font-bold">NUNCA FACTURADO · precio actual</span>
                  ) : (
                    `último facturado ${i.fecha_venta_original ? new Date(i.fecha_venta_original + "T00:00:00").toLocaleDateString("es-AR") : ""}`
                  )}
                </p>
              </div>
              <button onClick={() => setItems((prev) => prev.filter((_, n) => n !== idx))} className="text-red-500 text-xl px-1">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-gray-400 block mb-0.5">Cantidad</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={i.cantidad || ""}
                  onChange={(e) => updateItem(idx, { cantidad: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center font-bold"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-0.5">Precio unitario</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={i.precio_venta_original || ""}
                  onChange={(e) => updateItem(idx, { precio_venta_original: Math.max(0, parseFloat(e.target.value) || 0) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-right font-bold"
                />
              </div>
            </div>

            <div className="flex gap-1.5">
              {CONDICIONES.map((c) => (
                <button
                  key={c.valor}
                  onClick={() => updateItem(idx, { condicion: c.valor })}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 ${
                    i.condicion === c.valor
                      ? "bg-emerald-600 border-emerald-600 text-white"
                      : "bg-white border-gray-200 text-gray-500"
                  }`}
                >
                  {c.label}
                  <span className={`block text-[9px] font-medium ${i.condicion === c.valor ? "text-emerald-100" : "text-gray-400"}`}>
                    {c.hint}
                  </span>
                </button>
              ))}
            </div>

            <p className="text-right text-sm text-gray-600">
              Subtotal: <span className="font-bold text-gray-900">{formatCurrency(i.cantidad * i.precio_venta_original)}</span>
            </p>
          </div>
        ))}

        {/* ══ Buscador sobre las COMPRAS del cliente ══ */}
        {!modoCatalogo ? (
          <section className="space-y-2">
            <h2 className="text-lg font-bold text-gray-700">¿Qué devuelve?</h2>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar en lo que le vendimos..."
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-lg bg-white outline-none"
            />
            {cargando ? (
              <div className="text-center py-8">
                <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : sinResultados ? (
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3">
                <p className="text-amber-800 font-bold">⚠️ Este artículo nunca fue vendido a este cliente.</p>
                <p className="text-amber-700 text-sm">
                  Podés agregarlo igual al precio actual del cliente, o rechazar la devolución.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setModoCatalogo(true)
                      buscarCatalogo(q)
                    }}
                    className="bg-emerald-600 text-white rounded-xl py-3 font-bold text-sm"
                  >
                    Agregar igual
                  </button>
                  <button
                    onClick={() => setQ("")}
                    className="bg-white border-2 border-gray-300 text-gray-600 rounded-xl py-3 font-bold text-sm"
                  >
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
                    <button
                      key={c.articulo_id}
                      onClick={() => agregarComprado(c)}
                      className="w-full bg-white rounded-xl border border-gray-200 p-3 text-left flex items-center gap-3 active:scale-[0.98]"
                    >
                      {c.imagen_url ? (
                        <img src={c.imagen_url} alt="" className="w-11 h-11 rounded-lg object-cover bg-gray-100 shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-lg bg-gray-100 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 text-sm leading-snug">{c.descripcion}</p>
                        <p className="text-gray-400 text-xs">
                          {c.tipo_comprobante} {c.numero_comprobante} ·{" "}
                          {c.ultima_fecha ? new Date(c.ultima_fecha.slice(0, 10) + "T00:00:00").toLocaleDateString("es-AR") : ""}
                          {` · llevó ${c.cantidad_total}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-gray-400">facturado</p>
                        <p className="font-bold text-emerald-700">{formatCurrency(c.ultimo_precio)}</p>
                      </div>
                    </button>
                  ))}
                {!comprados.length && (
                  <div className="bg-white rounded-2xl border border-gray-200 p-5 text-center text-gray-500 text-sm">
                    Este cliente no tiene compras facturadas. Si igual trae mercadería, buscala en el
                    catálogo:
                    <button
                      onClick={() => setModoCatalogo(true)}
                      className="block w-full mt-3 bg-emerald-600 text-white rounded-xl py-3 font-bold"
                    >
                      Buscar en el catálogo
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        ) : (
          /* ══ Catálogo (nunca facturado) ══ */
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-700">Catálogo — nunca facturado</h2>
              <button onClick={() => setModoCatalogo(false)} className="text-emerald-700 text-sm font-bold">
                ← Volver a sus compras
              </button>
            </div>
            <input
              type="search"
              value={qCat}
              onChange={(e) => buscarCatalogo(e.target.value)}
              placeholder="Buscar artículo, SKU o EAN..."
              autoFocus
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-lg bg-white outline-none"
            />
            {buscandoCat ? (
              <div className="text-center py-8">
                <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : (
              <div className="space-y-2">
                {resultadosCat.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => agregarDeCatalogo(a)}
                    className="w-full bg-white rounded-xl border border-gray-200 p-3 text-left flex items-center gap-3 active:scale-[0.98]"
                  >
                    {a.imagen_url ? (
                      <img src={a.imagen_url} alt="" className="w-11 h-11 rounded-lg object-cover bg-gray-100 shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-gray-100 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 text-sm leading-snug">{a.descripcion}</p>
                      <p className="text-amber-600 text-xs font-bold">NUNCA FACTURADO · entra al precio actual</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Observaciones */}
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-gray-500 text-sm block mb-1">Observaciones</label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            placeholder="Opcional: estado de la mercadería, acuerdo con el cliente..."
          />
        </section>
      </div>

      {/* Resumen fijo */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex justify-between text-sm text-gray-500">
            <span>{items.length} artículo(s)</span>
            <span>
              Total: <span className="font-bold text-gray-900">{formatCurrency(total)}</span>
            </span>
          </div>
          <button
            onClick={registrar}
            disabled={enviando || !items.length}
            className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
          >
            {enviando ? "Registrando..." : `Registrar devolución ${formatCurrency(total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
