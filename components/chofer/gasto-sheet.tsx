"use client"

import { useRef, useState } from "react"
import { formatCurrency } from "@/lib/utils"

// Hoja "Cargar un gasto" del chofer: a mano o por foto del ticket (OCR:
// detecta tipo e importe, la foto queda adjunta al gasto). Se usa desde el
// viaje y desde la billetera.

export const CATEGORIAS_GASTO = [
  ["nafta", "⛽ Nafta"], ["peon", "💪 Peón"], ["hotel", "🛏 Hotel"], ["peaje", "🛣 Peaje"],
  ["comida", "🍽 Comida"], ["cubierta", "🛞 Cubierta"], ["otro", "• Otro"],
] as const

export function GastoSheet({ viajeId, onClose, onGuardado }: { viajeId: string | null; onClose: () => void; onGuardado: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [categoria, setCategoria] = useState("nafta")
  const [monto, setMonto] = useState("")
  const [obs, setObs] = useState("")
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [aviso, setAviso] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const clave = useRef(crypto.randomUUID())

  const leerTicket = async (file: File) => {
    setLeyendo(true)
    setAviso("")
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/chofer/billetera/gasto/ocr", { method: "POST", body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      if (d.foto_url) setFotoUrl(d.foto_url)
      if (d.success) {
        setCategoria(d.categoria)
        setMonto(String(d.monto))
        if (d.detalle) setObs(d.detalle)
        setAviso(`✓ Ticket leído: ${d.categoria} ${formatCurrency(d.monto)}. Revisá y guardá.`)
      } else {
        setAviso("No pude leer el importe del ticket. La foto quedó adjunta: cargalo a mano.")
      }
    } catch (e: any) {
      setAviso(e?.message || "No se pudo leer el ticket. Cargalo a mano.")
    } finally {
      setLeyendo(false)
    }
  }

  const guardar = async () => {
    const m = Number(String(monto).replace(",", "."))
    if (!m || m <= 0) { setAviso("Poné el importe del gasto"); return }
    setOcupado(true)
    setAviso("")
    try {
      const res = await fetch("/api/chofer/billetera/gasto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viaje_id: viajeId, categoria, monto: m, observaciones: obs, foto_url: fotoUrl, idempotency_key: clave.current }),
      })
      const d = await res.json()
      if (!res.ok || !d.success) throw new Error(d.error || "No se pudo guardar")
      onGuardado()
      onClose()
    } catch (e: any) {
      setAviso(e?.message || "No se pudo guardar")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div className="max-h-[92vh] w-full space-y-4 overflow-y-auto rounded-t-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-center text-xl font-bold">Cargar un gasto</h3>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={leyendo}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50 py-4 text-lg font-bold text-blue-700 active:scale-95 transition-transform disabled:opacity-50"
        >
          {leyendo ? (
            <><span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /> Leyendo el ticket…</>
          ) : (
            <>📷 Sacar foto al ticket</>
          )}
        </button>
        <input
          ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) leerTicket(f); e.target.value = "" }}
        />
        {fotoUrl && <p className="text-center text-xs text-green-700">✓ Foto adjunta</p>}

        <div className="grid grid-cols-2 gap-2">
          {CATEGORIAS_GASTO.map(([valor, texto]) => (
            <button
              key={valor}
              onClick={() => setCategoria(valor)}
              className={`rounded-xl border-2 py-3 font-bold ${categoria === valor ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-200 text-gray-700"}`}
            >
              {texto}
            </button>
          ))}
        </div>
        <input
          type="number" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Importe"
          className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg"
        />
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Detalle (opcional)" className="w-full rounded-xl border-2 border-gray-200 px-4 py-3" />
        <p className="text-center text-xs text-gray-500">Oficina aprueba cada gasto al rendir el viaje.</p>
        {aviso && (
          <p className={`rounded-xl px-4 py-3 text-sm font-medium ${aviso.startsWith("✓") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{aviso}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={onClose} className="rounded-2xl border-2 border-gray-300 py-4 font-bold text-gray-600 active:scale-95">Cancelar</button>
          <button onClick={guardar} disabled={ocupado || leyendo} className="rounded-2xl bg-blue-600 py-4 font-bold text-white active:scale-95 disabled:opacity-50">
            {ocupado ? "Guardando…" : "Guardar gasto"}
          </button>
        </div>
      </div>
    </div>
  )
}
