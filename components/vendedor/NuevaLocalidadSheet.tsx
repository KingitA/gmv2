"use client"

import { useState } from "react"

// Alta de localidad desde la app del vendedor (abre una zona nueva sin pasar
// por oficina): nombre + provincia + CP + zona. También permite dar de alta la
// zona ahí mismo (solo nombre; flete y costos quedan pendientes para el ERP).

export interface LocalidadCreada {
  id: string
  nombre: string
  provincia: string | null
}

const PROVINCIAS = [
  "Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones",
  "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe",
  "Santiago del Estero", "Tierra del Fuego", "Tucumán",
]

const inputCls = "w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 bg-white"

export function NuevaLocalidadSheet({
  zonas,
  onCreada,
  onCerrar,
}: {
  zonas: { id: string; nombre: string }[]
  onCreada: (l: LocalidadCreada) => void
  onCerrar: () => void
}) {
  const [nombre, setNombre] = useState("")
  const [provincia, setProvincia] = useState("Buenos Aires")
  const [cp, setCp] = useState("")
  const [zonaId, setZonaId] = useState("")
  const [zonasLocal, setZonasLocal] = useState(zonas)
  const [nuevaZona, setNuevaZona] = useState<string | null>(null) // null = cerrado
  const [guardando, setGuardando] = useState(false)

  // Crea la zona y devuelve su id (o el de la existente si ya estaba).
  // null = falló (ya se mostró el alert).
  const postZona = async (nz: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/vendedor/zonas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nz }),
      })
      const d = await res.json()
      if (res.status === 409 && d.zona_existente) {
        setZonasLocal((prev) => (prev.some((z) => z.id === d.zona_existente.id) ? prev : [...prev, d.zona_existente]))
        setZonaId(d.zona_existente.id)
        setNuevaZona(null)
        return d.zona_existente.id
      }
      if (!res.ok || d.error) { alert(d.error || "No se pudo crear la zona."); return null }
      setZonasLocal((prev) => [...prev, d.zona])
      setZonaId(d.zona.id)
      setNuevaZona(null)
      return d.zona.id
    } catch {
      alert("Error de conexión.")
      return null
    }
  }

  const crearZona = async () => {
    const nz = (nuevaZona || "").trim()
    if (!nz || guardando) return
    setGuardando(true)
    try { await postZona(nz) } finally { setGuardando(false) }
  }

  const guardar = async () => {
    if (!nombre.trim()) { alert("Ingresá el nombre de la localidad."); return }
    if (guardando) return
    setGuardando(true)
    try {
      // Si quedó una zona tipeada sin confirmar con "Crear", se crea acá
      // mismo: guardar la localidad nunca descarta lo que se escribió.
      let zonaFinal = zonaId || null
      const nz = (nuevaZona || "").trim()
      if (nz) {
        const idZona = await postZona(nz)
        if (!idZona) return // el alert ya explicó; no guardamos a medias
        zonaFinal = idZona
      }
      const res = await fetch("/api/vendedor/localidades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), provincia, codigo_postal: cp.trim(), zona_id: zonaFinal }),
      })
      const d = await res.json()
      if (res.status === 409 && d.localidad_existente) {
        if (confirm(`${d.error} ¿Usar esa?`)) onCreada(d.localidad_existente)
        return
      }
      if (!res.ok || d.error) { alert(d.error || "No se pudo crear la localidad."); return }
      onCreada(d.localidad)
    } catch {
      alert("Error de conexión.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={onCerrar}>
      <div className="bg-white w-full rounded-t-3xl p-5 max-w-2xl mx-auto space-y-3 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <p className="font-bold text-gray-900 text-lg">➕ Nueva localidad</p>
        <div>
          <label className="text-gray-500 text-sm block mb-1">Nombre *</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} placeholder="Ej: PEDRO LURO" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-gray-500 text-sm block mb-1">Provincia *</label>
            <select value={provincia} onChange={(e) => setProvincia(e.target.value)} className={inputCls}>
              {PROVINCIAS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-sm block mb-1">Código postal</label>
            <input value={cp} onChange={(e) => setCp(e.target.value)} inputMode="numeric" className={inputCls} placeholder="8148" />
          </div>
        </div>
        <div>
          <label className="text-gray-500 text-sm block mb-1">Zona</label>
          {nuevaZona === null ? (
            <div className="flex gap-2">
              <select value={zonaId} onChange={(e) => setZonaId(e.target.value)} className={inputCls}>
                <option value="">Sin zona</option>
                {zonasLocal.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
              </select>
              <button onClick={() => setNuevaZona("")} className="shrink-0 bg-white border-2 border-emerald-600 text-emerald-700 rounded-xl px-3 font-bold text-sm">
                + Zona
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={nuevaZona}
                onChange={(e) => setNuevaZona(e.target.value)}
                className={inputCls}
                placeholder="Nombre de la zona nueva"
                autoFocus
              />
              <button onClick={crearZona} disabled={guardando} className="shrink-0 bg-emerald-600 text-white rounded-xl px-4 font-bold text-sm disabled:bg-gray-300">
                Crear
              </button>
              <button onClick={() => setNuevaZona(null)} className="shrink-0 text-gray-400 px-1 text-xl">✕</button>
            </div>
          )}
          <p className="text-gray-400 text-xs mt-1">El tipo de flete y los costos de la zona se cargan después desde el ERP.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={onCerrar} className="bg-white border border-gray-300 text-gray-700 rounded-xl py-3.5 font-bold">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando} className="bg-emerald-600 text-white rounded-xl py-3.5 font-bold disabled:bg-gray-300">
            {guardando ? "Guardando..." : "Guardar localidad"}
          </button>
        </div>
      </div>
    </div>
  )
}
