"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { NuevaLocalidadSheet } from "@/components/vendedor/NuevaLocalidadSheet"
import { useBackTrap } from "@/lib/vendedor/use-back-trap"

// Alta de cliente desde la calle. Al guardar, va directo a levantarle un
// pedido (o a la ficha). Nace asignado a un viajante del usuario.

interface Catalogos {
  condiciones_pago: { id: string; nombre: string }[]
  condiciones_entrega: { id: string; codigo: string; nombre: string }[]
  localidades: { id: string; nombre: string; provincia: string | null }[]
  listas_precio: { id: string; nombre: string }[]
  vendedores: { id: string; nombre: string; lista_precio_id?: string | null; lista_nombre?: string | null }[]
  condiciones_iva: string[]
  metodos_facturacion: string[]
  puede_cambiar_lista?: boolean
  zonas?: { id: string; nombre: string }[]
}

// Fuera del componente de página: si se define adentro, React lo trata como
// un componente nuevo en cada render y remonta los inputs (se pierde el foco
// a cada tecla, saltando al campo con autoFocus).
const inputCls = "w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 bg-white"

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-gray-500 text-sm block mb-1">{label}</label>
      {children}
    </div>
  )
}

const VACIO: Catalogos = {
  condiciones_pago: [],
  condiciones_entrega: [],
  localidades: [],
  listas_precio: [],
  vendedores: [],
  condiciones_iva: [],
  metodos_facturacion: [],
}

export default function VendedorClienteNuevoPage() {
  const router = useRouter()
  const [cat, setCat] = useState<Catalogos>(VACIO)
  const [f, setF] = useState({
    razon_social: "",
    nombre: "",
    cuit: "",
    condicion_iva: "",
    metodo_facturacion: "Factura",
    condicion_pago: "",
    condicion_entrega: "",
    direccion: "",
    localidad_id: "",
    telefono: "",
    mail: "",
    lista_precio_id: "",
    vendedor_id: "",
  })
  const [guardando, setGuardando] = useState(false)
  const [verNuevaLocalidad, setVerNuevaLocalidad] = useState(false)

  // "Atrás" físico: primero cierra el alta de localidad, después sale
  useBackTrap(() => {
    if (verNuevaLocalidad) { setVerNuevaLocalidad(false); return true }
    return false
  })

  useEffect(() => {
    fetch("/api/vendedor/catalogos-ficha")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return
        setCat(d)
        if (d.vendedores?.length === 1) setF((p) => ({ ...p, vendedor_id: d.vendedores[0].id }))
      })
      .catch(() => {})
  }, [])

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))

  // Lista impuesta por el viajante elegido (o el único del usuario)
  const viajanteSel = cat.vendedores.find((v) => v.id === f.vendedor_id) || (cat.vendedores.length === 1 ? cat.vendedores[0] : null)
  const listaImpuesta = viajanteSel?.lista_nombre || null

  const guardar = async (irAPedido: boolean) => {
    if (guardando) return
    if (!f.razon_social.trim() && !f.nombre.trim()) {
      alert("Ingresá la razón social o el nombre de fantasía.")
      return
    }
    setGuardando(true)
    try {
      const res = await fetch("/api/vendedor/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          nombre: f.nombre.trim() || f.razon_social.trim(),
          localidad: cat.localidades.find((l) => l.id === f.localidad_id)?.nombre || null,
        }),
      })
      const d = await res.json()
      if (res.status === 409 && d.cliente_existente_id) {
        if (confirm(`${d.error}. ¿Abrir la ficha de ese cliente?`)) router.push(`/vendedor/clientes/${d.cliente_existente_id}`)
        return
      }
      if (!res.ok || d.error) {
        alert(d.error || "No se pudo crear el cliente.")
        return
      }
      router.replace(irAPedido ? `/vendedor/pedido/nuevo?cliente=${d.cliente.id}` : `/vendedor/clientes/${d.cliente.id}`)
    } catch {
      alert("Error de conexión.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-36">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.back()} className="text-2xl leading-none px-1">←</button>
        <div>
          <h1 className="text-lg font-bold">➕ Nuevo cliente</h1>
          <p className="text-emerald-200 text-sm">Cargalo y arrancá el pedido al toque</p>
        </div>
      </header>

      <div className="p-4 space-y-3 max-w-2xl mx-auto">
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Identidad</p>
          <Campo label="Razón social *">
            <input value={f.razon_social} onChange={set("razon_social")} className={inputCls} placeholder="Ej: Distribuidora Urquiza S.R.L." autoFocus />
          </Campo>
          <Campo label="Nombre de fantasía">
            <input value={f.nombre} onChange={set("nombre")} className={inputCls} placeholder="Cómo lo conocés (opcional)" />
          </Campo>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="CUIT">
              <input value={f.cuit} onChange={set("cuit")} inputMode="numeric" className={inputCls} placeholder="20-12345678-9" />
            </Campo>
            <Campo label="Condición IVA">
              <select value={f.condicion_iva} onChange={set("condicion_iva")} className={inputCls}>
                <option value="">Elegir...</option>
                {cat.condiciones_iva.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Campo>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Comercial</p>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Método facturación">
              <select value={f.metodo_facturacion} onChange={set("metodo_facturacion")} className={inputCls}>
                {cat.metodos_facturacion.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Campo>
            {listaImpuesta ? (
              <Campo label="Lista de precios">
                <div className={`${inputCls} bg-gray-50 text-gray-600`}>
                  {listaImpuesta} <span className="text-xs text-gray-400">(por viajante)</span>
                </div>
              </Campo>
            ) : cat.puede_cambiar_lista ? (
              <Campo label="Lista de precios">
                <select value={f.lista_precio_id} onChange={set("lista_precio_id")} className={inputCls}>
                  <option value="">Estándar</option>
                  {cat.listas_precio.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              </Campo>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Condición de pago">
              <select value={f.condicion_pago} onChange={set("condicion_pago")} className={inputCls}>
                <option value="">Elegir...</option>
                {cat.condiciones_pago.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Condición de entrega">
              <select value={f.condicion_entrega} onChange={set("condicion_entrega")} className={inputCls}>
                <option value="">Elegir...</option>
                {cat.condiciones_entrega.map((c) => <option key={c.id} value={c.codigo}>{c.nombre}</option>)}
              </select>
            </Campo>
          </div>
          {cat.vendedores.length > 1 && (
            <Campo label="Viajante">
              <select value={f.vendedor_id} onChange={set("vendedor_id")} className={inputCls}>
                <option value="">Elegir viajante...</option>
                {cat.vendedores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}{v.lista_nombre ? ` → lista ${v.lista_nombre}` : ""}
                  </option>
                ))}
              </select>
            </Campo>
          )}
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Ubicación y contacto</p>
          <Campo label="Dirección">
            <input value={f.direccion} onChange={set("direccion")} className={inputCls} placeholder="Calle y número" />
          </Campo>
          <Campo label="Localidad">
            <div className="flex gap-2">
              <select value={f.localidad_id} onChange={set("localidad_id")} className={inputCls}>
                <option value="">Elegir localidad...</option>
                {cat.localidades.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre}{l.provincia ? ` — ${l.provincia}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setVerNuevaLocalidad(true)}
                className="shrink-0 bg-white border-2 border-emerald-600 text-emerald-700 rounded-xl px-3 font-bold text-sm"
              >
                + Nueva
              </button>
            </div>
          </Campo>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Teléfono">
              <input value={f.telefono} onChange={set("telefono")} type="tel" className={inputCls} />
            </Campo>
            <Campo label="Email">
              <input value={f.mail} onChange={set("mail")} type="email" className={inputCls} />
            </Campo>
          </div>
        </section>
      </div>

      {verNuevaLocalidad && (
        <NuevaLocalidadSheet
          zonas={cat.zonas || []}
          onCerrar={() => setVerNuevaLocalidad(false)}
          onCreada={(l) => {
            setCat((prev) => ({ ...prev, localidades: [...prev.localidades, { id: l.id, nombre: l.nombre, provincia: l.provincia }] }))
            setF((prev) => ({ ...prev, localidad_id: l.id }))
            setVerNuevaLocalidad(false)
          }}
        />
      )}

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-2xl mx-auto grid grid-cols-2 gap-2">
          <button
            onClick={() => guardar(false)}
            disabled={guardando}
            className="bg-white border-2 border-emerald-600 text-emerald-700 rounded-xl py-4 font-bold disabled:opacity-50"
          >
            Guardar
          </button>
          <button
            onClick={() => guardar(true)}
            disabled={guardando}
            className="bg-emerald-600 text-white rounded-xl py-4 font-bold disabled:bg-gray-300"
          >
            {guardando ? "Guardando..." : "Guardar y levantar pedido 🛒"}
          </button>
        </div>
      </div>
    </div>
  )
}
