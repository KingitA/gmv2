"use client"

// Control de cuentas corrientes en lenguaje simple: por cada cliente
// desalineado muestra qué dice el libro, qué dicen los comprobantes y la
// diferencia. Reemplaza el "revisá /api/finanzas/reconciliacion" del banner
// de /caja (una URL técnica que abría JSON crudo).

import { useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, RefreshCw } from "lucide-react"

type Descuadre = {
  cliente_id: string
  cliente_nombre: string
  saldo_libro: number
  saldo_documentos: number
  pagos_a_cuenta: number
  diferencia: number
}

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ReconciliacionPage() {
  const [descuadres, setDescuadres] = useState<Descuadre[] | null>(null)
  const [mensaje, setMensaje] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch("/api/finanzas/reconciliacion")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error consultando la reconciliación")
      setDescuadres(data.descuadres || [])
      setMensaje(data.mensaje || "")
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Control de cuentas corrientes</h1>
        <button
          onClick={cargar}
          disabled={cargando}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualizar
        </button>
      </div>
      <p className="mb-5 text-sm text-slate-500">
        Compara, cliente por cliente, lo que dice el <b>libro</b> (la cuenta corriente oficial) contra lo
        que dicen sus <b>comprobantes</b> descontando la plata a cuenta. Si no coinciden, algo quedó a
        medias — resolvelo antes del cierre del día.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!cargando && !error && descuadres?.length === 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-6 text-center">
          <p className="text-base font-semibold text-green-800">✓ Todo cuadra</p>
          <p className="mt-1 text-sm text-green-700">{mensaje || "El libro y los comprobantes dicen lo mismo para todos los clientes."}</p>
        </div>
      )}

      <div className="space-y-3">
        {(descuadres || []).map((d) => (
          <div key={d.cliente_id} className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-slate-900">{d.cliente_nombre}</p>
              <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold text-amber-700">
                Diferencia $ {fmt(Math.abs(d.diferencia))}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              El libro dice que debe <b>$ {fmt(d.saldo_libro)}</b> · Los comprobantes dicen{" "}
              <b>$ {fmt(d.saldo_documentos)}</b>
              {d.pagos_a_cuenta > 0.01 ? (
                <> (con $ {fmt(d.pagos_a_cuenta)} a cuenta sin imputar)</>
              ) : null}
              .
            </p>
            <Link
              href={`/clientes/${d.cliente_id}/cuenta-corriente`}
              className="mt-2 inline-block rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Abrir su cuenta corriente
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
