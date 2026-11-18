"use client"

// Evolución del costo de compra de un artículo (ficha del artículo). Tanda 2-C.
// Se carga recién cuando se abre: no agrega nada a la carga de la ficha.

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { History, Loader2 } from "lucide-react"
import { fecha, moneda, porcentaje } from "@/lib/formato"
import { cant } from "@/lib/deposito/unidades"

interface Fila {
  id: string; fecha: string | null; origen: string; detalle: string | null; proveedor: string | null; usuario: string | null
  precio_compra: number; descuentos: number[]; neto: number
  antes: { precio_compra: number; descuentos: number[]; neto: number } | null
  ultimo_costo: number | null; lista_proveedor_id: string | null; orden_compra_id: string | null
}

const dto = (d: number[]) => (d.some((x) => x > 0) ? d.filter((x) => x > 0).map((x) => `${cant(x)} %`).join(" + ") : "sin desc.")

export function HistorialCosto({ articuloId }: { articuloId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const abrir = async () => {
    setAbierto((a) => !a)
    if (filas || cargando) return
    setCargando(true)
    try {
      const res = await fetch(`/api/articulos/${articuloId}/historial-costo`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `No se pudo cargar (error ${res.status})`); return }
      setFilas(data.historial || [])
    } catch {
      setError("No se pudo cargar: sin conexión.")
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl border px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-neutro-600">Evolución del costo de compra</div>
          <div className="text-[13px] text-neutro-400">Cada cambio de precio de lista, descuentos o último costo: de dónde salió, quién y cuándo.</div>
        </div>
        <Button type="button" variant="outline" onClick={abrir} className="gap-2">
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />} {abierto ? "Ocultar" : "Ver historial"}
        </Button>
      </div>

      {abierto && error && <p className="mt-3 text-[13px] text-red-700">{error}</p>}
      {abierto && filas && filas.length === 0 && <p className="mt-3 text-[13px] text-neutro-400">Todavía no hay cambios de costo registrados para este artículo.</p>}
      {abierto && filas && filas.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-neutro-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Fecha</th>
                <th className="py-1 pr-3 font-medium">De dónde salió</th>
                <th className="py-1 pr-3 font-medium text-right">Antes</th>
                <th className="py-1 pr-3 font-medium text-right">Después</th>
                <th className="py-1 pr-3 font-medium text-right">Cambio</th>
                <th className="py-1 font-medium">Quién</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const variacion = f.antes && f.antes.neto > 0 ? ((f.neto - f.antes.neto) / f.antes.neto) * 100 : null
                return (
                  <tr key={f.id} className="border-t align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fecha(f.fecha)}</td>
                    <td className="py-1.5 pr-3">
                      <div className="font-medium">{f.origen}{f.proveedor ? ` — ${f.proveedor}` : ""}</div>
                      {f.detalle && <div className="text-neutro-400">{f.detalle}</div>}
                      {f.lista_proveedor_id && <Link className="text-blue-600 underline" href={`/listas-proveedores/${f.lista_proveedor_id}`}>ver la lista</Link>}
                      {f.orden_compra_id && <Link className="text-blue-600 underline" href={`/ordenes-compra/${f.orden_compra_id}/verificacion`}>ver la orden</Link>}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {f.antes ? <><div>{moneda(f.antes.precio_compra)}</div><div className="text-neutro-400">{dto(f.antes.descuentos)} = {moneda(f.antes.neto)}</div></> : <span className="text-neutro-400">—</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      <div>{moneda(f.precio_compra)}</div>
                      <div className="text-neutro-400">{dto(f.descuentos)} = {moneda(f.neto)}</div>
                      {f.ultimo_costo != null && <div className="text-neutro-600">último costo {moneda(f.ultimo_costo)}</div>}
                    </td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums ${variacion == null ? "text-neutro-400" : variacion > 0 ? "text-red-600" : variacion < 0 ? "text-green-700" : ""}`}>
                      {variacion == null ? "—" : `${variacion > 0 ? "+" : ""}${porcentaje(variacion, 1)}`}
                    </td>
                    <td className="py-1.5">{f.usuario || <span className="text-neutro-400">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
