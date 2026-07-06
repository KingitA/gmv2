"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

// Devolución en la calle — contrato docs/CONTRATO-API-VIAJANTES.md
// POST /api/viajante/devolucion (Fase E). Queda `pendiente` hasta la
// confirmación física de depósito.

interface Articulo {
  id: string
  sku: string | null
  descripcion: string
  marca: string | null
}

interface ItemDev {
  articulo: Articulo
  cantidad: number
  precio_venta_original: number
  motivo: string
  condicion: "vendible" | "dañado" | "mal_uso" | "cambio"
}

const CONDICIONES = [
  { key: "vendible", label: "Vendible" },
  { key: "dañado", label: "Dañado" },
  { key: "mal_uso", label: "Mal uso" },
  { key: "cambio", label: "Cambio" },
] as const

export default function VendedorDevolucionPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [clienteNombre, setClienteNombre] = useState("")
  const [q, setQ] = useState("")
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [items, setItems] = useState<ItemDev[]>([])
  const [obs, setObs] = useState("")
  const [enviando, setEnviando] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch(`/api/vendedor/cliente/${id}`)
      .then((r) => r.json())
      .then((d) => !d.error && setClienteNombre(d.cliente.nombre))
      .catch(() => {})
  }, [id])

  const buscar = (value: string) => {
    setQ(value)
    if (debounce.current) clearTimeout(debounce.current)
    if (!value) {
      setResultados([])
      return
    }
    debounce.current = setTimeout(() => {
      setBuscando(true)
      fetch(`/api/vendedor/articulos?vista=buscar&q=${encodeURIComponent(value)}`)
        .then((r) => r.json())
        .then((d) => setResultados(d.articulos || []))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false))
    }, 400)
  }

  const agregar = (a: Articulo) => {
    if (items.some((i) => i.articulo.id === a.id)) return
    setItems((prev) => [
      ...prev,
      { articulo: a, cantidad: 1, precio_venta_original: 0, motivo: "", condicion: "vendible" },
    ])
    setQ("")
    setResultados([])
  }

  const update = (idx: number, patch: Partial<ItemDev>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const total = items.reduce((s, i) => s + i.cantidad * i.precio_venta_original, 0)

  const confirmar = async () => {
    if (!items.length || enviando) return
    for (const it of items) {
      if (it.cantidad <= 0 || it.precio_venta_original <= 0 || !it.motivo.trim()) {
        alert("Cada ítem necesita cantidad, precio de venta original y motivo.")
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
          items: items.map((it) => ({
            articulo_id: it.articulo.id,
            cantidad: it.cantidad,
            precio_venta_original: it.precio_venta_original,
            comprobante_venta_id: null,
            motivo: it.motivo.trim(),
            condicion: it.condicion,
          })),
          observaciones: obs || null,
        }),
      })
      if (res.status === 404) {
        alert("El módulo de devoluciones todavía no está habilitado en el servidor (Fase E pendiente). La devolución NO se registró.")
        return
      }
      const d = await res.json()
      if (!res.ok || d.error) {
        alert(d.error || "Error al registrar la devolución.")
        return
      }
      alert(`✅ Devolución ${d.numero_devolucion} registrada por ${formatCurrency(d.monto_total)}. Queda pendiente de confirmación en depósito.`)
      router.push(`/vendedor/clientes/${id}`)
    } catch {
      alert("Error de conexión al registrar la devolución.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.back()} className="text-2xl leading-none px-1">←</button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold">📦 Devolución</h1>
          <p className="text-emerald-200 text-sm truncate">{clienteNombre}</p>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Buscador */}
        <section className="relative">
          <input
            type="search"
            value={q}
            onChange={(e) => buscar(e.target.value)}
            placeholder="Buscar artículo a devolver..."
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-lg bg-white"
          />
          {(resultados.length > 0 || buscando) && (
            <div className="absolute z-20 inset-x-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg max-h-72 overflow-y-auto">
              {buscando ? (
                <p className="p-4 text-gray-500 text-center">Buscando...</p>
              ) : (
                resultados.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => agregar(a)}
                    className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 active:bg-gray-50"
                  >
                    <p className="font-medium text-gray-900 text-sm">{a.descripcion}</p>
                    <p className="text-gray-400 text-xs">{[a.sku, a.marca].filter(Boolean).join(" · ")}</p>
                  </button>
                ))
              )}
            </div>
          )}
        </section>

        {/* Items */}
        {items.map((it, idx) => (
          <div key={it.articulo.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-bold text-gray-900 text-sm leading-snug flex-1">{it.articulo.descripcion}</p>
              <button
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                className="text-red-500 text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-gray-500 text-xs">Cantidad</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={it.cantidad}
                  onChange={(e) => update(idx, { cantidad: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs">Precio venta original *</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={it.precio_venta_original || ""}
                  onChange={(e) => update(idx, { precio_venta_original: Math.max(0, parseFloat(e.target.value) || 0) })}
                  placeholder="$"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-bold text-right"
                />
              </div>
            </div>
            <div>
              <label className="text-gray-500 text-xs">Condición</label>
              <div className="flex gap-2 mt-1">
                {CONDICIONES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => update(idx, { condicion: c.key })}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold ${
                      it.condicion === c.key ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-gray-500 text-xs">Motivo *</label>
              <input
                value={it.motivo}
                onChange={(e) => update(idx, { motivo: e.target.value })}
                placeholder="Ej: vencido, roto, no era lo pedido..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
            Buscá y agregá los artículos que el cliente devuelve.
          </div>
        )}

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

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex justify-between text-lg">
            <span className="text-gray-500">Total devolución</span>
            <span className="font-bold text-gray-900">{formatCurrency(total)}</span>
          </div>
          <button
            onClick={confirmar}
            disabled={enviando || !items.length}
            className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
          >
            {enviando ? "Registrando..." : "Registrar devolución"}
          </button>
        </div>
      </div>
    </div>
  )
}
