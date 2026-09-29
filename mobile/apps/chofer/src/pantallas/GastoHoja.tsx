import { useEffect, useRef, useState } from "react"
import { useOnline, useRuntime } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { CATEGORIAS_GASTO, type OpGasto } from "../datasets"
import { useEncolar } from "../datos/hooks"
import { formatCurrency } from "../ui"

// Hoja "Cargar un gasto" (= components/chofer/gasto-sheet.tsx): a mano o por foto del
// ticket. El gasto se ENCOLA (`viaje.gasto`) y sale cuando hay señal; la foto + OCR del
// ticket son online-only (el importe y la categoría se cargan a mano sin señal).
// Se abre con ?ver=gasto (entrada de historial: atrás la cierra).

export function GastoHoja({ viajeId, viajeNombre, abierta, onCerrar, onGuardado }: {
  viajeId: string | null
  viajeNombre?: string | null
  abierta: boolean
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
}) {
  const { api } = useRuntime()
  const online = useOnline()
  const encolar = useEncolar()
  const fileRef = useRef<HTMLInputElement>(null)
  const [categoria, setCategoria] = useState("nafta")
  const [monto, setMonto] = useState("")
  const [obs, setObs] = useState("")
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [aviso, setAviso] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => { vivo.current = false }
  }, [])
  // Cada apertura arranca limpia
  useEffect(() => {
    if (abierta) { setCategoria("nafta"); setMonto(""); setObs(""); setFotoUrl(null); setAviso(""); setLeyendo(false); setOcupado(false) }
  }, [abierta])

  const leerTicket = async (file: File) => {
    setLeyendo(true)
    setAviso("")
    try {
      const fd = new FormData()
      fd.append("file", file)
      const d = await api.postForm<{ success?: boolean; error?: string; foto_url?: string | null; categoria?: string; monto?: number; detalle?: string | null }>("/api/chofer/billetera/gasto/ocr", fd, { timeoutMs: 45_000 })
      if (!vivo.current) return
      if (d.error) throw new Error(d.error)
      if (d.foto_url) setFotoUrl(d.foto_url)
      if (d.success && d.categoria && d.monto) {
        setCategoria(d.categoria)
        setMonto(String(d.monto))
        if (d.detalle) setObs(d.detalle)
        setAviso(`✓ Ticket leído: ${d.categoria} ${formatCurrency(d.monto)}. Revisá y guardá.`)
      } else {
        setAviso("No pude leer el importe del ticket. La foto quedó adjunta: cargalo a mano.")
      }
    } catch (e: any) {
      if (vivo.current) setAviso(e?.message || "No se pudo leer el ticket. Cargalo a mano.")
    } finally {
      if (vivo.current) setLeyendo(false)
    }
  }

  const guardar = async () => {
    const m = Number(String(monto).replace(",", "."))
    if (!m || m <= 0) { setAviso("Poné el importe del gasto"); return }
    setOcupado(true)
    setAviso("")
    try {
      const payload: OpGasto = { viaje_id: viajeId, viaje_nombre: viajeNombre || undefined, categoria, monto: Math.round(m * 100) / 100, observaciones: obs.trim() || null, foto_url: fotoUrl }
      const etiqueta = `Gasto ${categoria} ${formatCurrency(payload.monto)}`
      await encolar("viaje.gasto", payload, etiqueta)
      onGuardado(online ? `✓ ${etiqueta} registrado.` : `✓ ${etiqueta} guardado en el equipo: se envía al volver la señal.`)
      onCerrar()
    } catch (e: any) {
      setAviso(e?.message || "No se pudo guardar")
    } finally {
      if (vivo.current) setOcupado(false)
    }
  }

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Cargar un gasto">
      <div className="space-y-4">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={leyendo || !online}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50 py-3 text-lg font-bold text-blue-700 active:scale-95 disabled:opacity-50"
        >
          {leyendo ? (
            <><span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /> Leyendo el ticket…</>
          ) : (
            <>📷 Sacar foto al ticket</>
          )}
        </button>
        <input
          ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerTicket(f); e.target.value = "" }}
        />
        {!online && <p className="text-center text-xs text-amber-700">📡 Sin señal: la foto del ticket necesita conexión. Cargá el gasto a mano y sacale la foto después desde el ERP si hace falta.</p>}
        {fotoUrl && <p className="text-center text-xs text-green-700">✓ Foto adjunta</p>}

        <div className="grid grid-cols-2 gap-2">
          {CATEGORIAS_GASTO.map(([valor, texto]) => (
            <button
              key={valor}
              onClick={() => setCategoria(valor)}
              className={`min-h-12 rounded-xl border-2 py-3 font-bold ${categoria === valor ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-200 text-gray-700"}`}
            >
              {texto}
            </button>
          ))}
        </div>
        <input
          type="number" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Importe"
          className="min-h-12 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg"
        />
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Detalle (opcional)" className="min-h-12 w-full rounded-xl border-2 border-gray-200 px-4 py-3" />
        <p className="text-center text-xs text-gray-500">Oficina aprueba cada gasto al rendir el viaje.</p>
        {aviso && (
          <p className={`rounded-xl px-4 py-3 text-sm font-medium ${aviso.startsWith("✓") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{aviso}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={onCerrar} className="min-h-12 rounded-2xl border-2 border-gray-300 py-3 font-bold text-gray-600 active:scale-95">Cancelar</button>
          <button onClick={() => void guardar()} disabled={ocupado || leyendo} className="min-h-12 rounded-2xl bg-blue-600 py-3 font-bold text-white active:scale-95 disabled:opacity-50">
            {ocupado ? "Guardando…" : "Guardar gasto"}
          </button>
        </div>
      </div>
    </Hoja>
  )
}
