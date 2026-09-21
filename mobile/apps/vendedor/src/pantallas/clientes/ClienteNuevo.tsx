import { useEffect, useState, type ChangeEvent, type ReactNode } from "react"
import { useNavigate } from "react-router"
import { ErrorHttp, useOnline, useOverlay, useRuntime } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { DS } from "../../datasets"
import { useCatalogosFicha, useClientes, useEncolar, uuidv4 } from "../../datos/hooks"
import { HojaConfirmar, Pantalla, useToast } from "../../ui"

// Port de app/vendedor/clientes/nuevo/page.tsx + components/vendedor/NuevaLocalidadSheet.tsx.
// Alta de cliente desde la calle: se ENCOLA (`cliente.crear`) con el id generado en el
// equipo, así se le puede levantar un pedido en el momento aunque no haya señal.

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

// Fuera del componente de pantalla: si se define adentro, React lo remonta en cada
// render y los inputs pierden el foco a cada tecla.
const inputCls = "w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 bg-white"

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm text-gray-500">{label}</label>
      {children}
    </div>
  )
}

const mensajeDe = (e: unknown, porDefecto: string) =>
  e instanceof ErrorHttp ? e.body?.error || porDefecto : e instanceof Error && e.message ? e.message : "Error de conexión."

// ─── Alta de localidad (ONLINE-ONLY: POST /api/vendedor/zonas y /localidades) ─

export function HojaNuevaLocalidad({ abierta, zonas, onCreada, onCerrar }: {
  abierta: boolean
  zonas: Array<{ id: string; nombre: string }>
  onCreada: (l: LocalidadCreada) => void
  onCerrar: () => void
}) {
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="➕ Nueva localidad">
      {abierta && <FormLocalidad zonas={zonas} onCreada={onCreada} onCerrar={onCerrar} />}
    </Hoja>
  )
}

function FormLocalidad({ zonas, onCreada, onCerrar }: { zonas: Array<{ id: string; nombre: string }>; onCreada: (l: LocalidadCreada) => void; onCerrar: () => void }) {
  const { api, sync } = useRuntime()
  const online = useOnline()
  const [nombre, setNombre] = useState("")
  const [provincia, setProvincia] = useState("Buenos Aires")
  const [cp, setCp] = useState("")
  const [zonaId, setZonaId] = useState("")
  const [zonasLocal, setZonasLocal] = useState(zonas)
  const [nuevaZona, setNuevaZona] = useState<string | null>(null) // null = cerrado
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 409 del servidor: ya existe esa localidad (la web preguntaba con confirm()) */
  const [existente, setExistente] = useState<{ mensaje: string; localidad: LocalidadCreada } | null>(null)

  // Crea la zona y devuelve su id (o el de la existente si ya estaba). null = falló (ya se mostró el error).
  const postZona = async (nz: string): Promise<string | null> => {
    const usar = (z: { id: string; nombre: string }) => {
      setZonasLocal((prev) => (prev.some((x) => x.id === z.id) ? prev : [...prev, z]))
      setZonaId(z.id)
      setNuevaZona(null)
      return z.id
    }
    try {
      const d = await api.post<{ zona: { id: string; nombre: string } }>("/api/vendedor/zonas", { nombre: nz })
      return usar(d.zona)
    } catch (e) {
      if (e instanceof ErrorHttp && e.status === 409 && e.body?.zona_existente) return usar(e.body.zona_existente)
      setError(mensajeDe(e, "No se pudo crear la zona."))
      return null
    }
  }

  const crearZona = async () => {
    const nz = (nuevaZona || "").trim()
    if (!nz || guardando || !online) return
    setGuardando(true)
    setError(null)
    try { await postZona(nz) } finally { setGuardando(false) }
  }

  /** La localidad ya está en el servidor: traerla a la réplica (para que aparezca en toda la app) y elegirla. */
  const terminar = async (l: LocalidadCreada) => {
    try { await sync.dataset(DS.catalogos) } catch { /* igual queda elegida en este formulario */ }
    onCreada(l)
  }

  const guardar = async () => {
    if (!nombre.trim()) { setError("Ingresá el nombre de la localidad."); return }
    if (guardando || !online) return
    setGuardando(true)
    setError(null)
    try {
      // Si quedó una zona tipeada sin confirmar con "Crear", se crea acá mismo:
      // guardar la localidad nunca descarta lo que se escribió.
      let zonaFinal = zonaId || null
      const nz = (nuevaZona || "").trim()
      if (nz) {
        const idZona = await postZona(nz)
        if (!idZona) return // el error ya se mostró; no guardamos a medias
        zonaFinal = idZona
      }
      try {
        const d = await api.post<{ localidad: LocalidadCreada }>("/api/vendedor/localidades", { nombre: nombre.trim(), provincia, codigo_postal: cp.trim(), zona_id: zonaFinal })
        await terminar(d.localidad)
      } catch (e) {
        if (e instanceof ErrorHttp && e.status === 409 && e.body?.localidad_existente) {
          setExistente({ mensaje: e.body.error || "Esa localidad ya existe.", localidad: e.body.localidad_existente })
          return
        }
        setError(mensajeDe(e, "No se pudo crear la localidad."))
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-3">
      {!online && <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">📡 Necesitás conexión para dar de alta una localidad o una zona.</p>}
      <div>
        <label className="mb-1 block text-sm text-gray-500">Nombre *</label>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} placeholder="Ej: PEDRO LURO" autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-sm text-gray-500">Provincia *</label>
          <select value={provincia} onChange={(e) => setProvincia(e.target.value)} className={inputCls}>
            {PROVINCIAS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-500">Código postal</label>
          <input value={cp} onChange={(e) => setCp(e.target.value)} inputMode="numeric" className={inputCls} placeholder="8148" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm text-gray-500">Zona</label>
        {nuevaZona === null ? (
          <div className="flex gap-2">
            <select value={zonaId} onChange={(e) => setZonaId(e.target.value)} className={inputCls}>
              <option value="">Sin zona</option>
              {zonasLocal.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
            </select>
            <button onClick={() => setNuevaZona("")} className="min-h-11 shrink-0 rounded-xl border-2 border-emerald-600 bg-white px-3 text-sm font-bold text-emerald-700">
              + Zona
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input value={nuevaZona} onChange={(e) => setNuevaZona(e.target.value)} className={inputCls} placeholder="Nombre de la zona nueva" autoFocus />
            <button onClick={crearZona} disabled={guardando || !online} className="min-h-11 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:bg-gray-300">
              Crear
            </button>
            <button onClick={() => setNuevaZona(null)} aria-label="Cancelar zona nueva" className="min-h-11 min-w-11 shrink-0 px-1 text-xl text-gray-400">✕</button>
          </div>
        )}
        <p className="mt-1 text-xs text-gray-400">El tipo de flete y los costos de la zona se cargan después desde el ERP.</p>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

      {existente ? (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">{existente.mensaje} ¿Usar esa?</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setExistente(null)} className="min-h-12 rounded-xl border border-gray-300 bg-white font-bold text-gray-700">Cancelar</button>
            <button onClick={() => void terminar(existente.localidad)} className="min-h-12 rounded-xl bg-emerald-600 font-bold text-white">Usar esa</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={onCerrar} className="rounded-xl border border-gray-300 bg-white py-3.5 font-bold text-gray-700">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando || !online} className="rounded-xl bg-emerald-600 py-3.5 font-bold text-white disabled:bg-gray-300">
            {guardando ? "Guardando..." : "Guardar localidad"}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── /clientes/nuevo ─────────────────────────────────────────────────────────

export function ClienteNuevo() {
  const navigate = useNavigate()
  const encolar = useEncolar()
  const cat = useCatalogosFicha()
  const { clientes } = useClientes()
  const { toast, mostrar } = useToast()
  const hojaLocalidad = useOverlay("localidad")
  const hojaDuplicado = useOverlay("duplicado")
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
  /** Localidades dadas de alta recién (por si el refresco del catálogo todavía no llegó) */
  const [localidadesNuevas, setLocalidadesNuevas] = useState<LocalidadCreada[]>([])
  const [duplicado, setDuplicado] = useState<{ id: string; nombre: string } | null>(null)

  const vendedores = cat?.vendedores ?? []
  const unicoVendedor = vendedores.length === 1 ? vendedores[0]!.id : ""
  useEffect(() => {
    if (unicoVendedor) setF((p) => (p.vendedor_id ? p : { ...p, vendedor_id: unicoVendedor }))
  }, [unicoVendedor])

  // Overlay de duplicado abierto sin dato (recarga): no hay nada que confirmar
  useEffect(() => {
    if (hojaDuplicado.abierto && !duplicado) hojaDuplicado.cerrar()
  }, [hojaDuplicado, duplicado])

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }))

  const localidades = [...(cat?.localidades ?? []), ...localidadesNuevas.filter((n) => !(cat?.localidades ?? []).some((l) => l.id === n.id))]

  // Lista impuesta por el viajante elegido (o el único del usuario)
  const viajanteSel = vendedores.find((v) => v.id === f.vendedor_id) || (vendedores.length === 1 ? vendedores[0]! : null)
  const listaImpuesta = viajanteSel?.lista_nombre || null

  const guardar = async (irAPedido: boolean) => {
    if (guardando) return
    if (!f.razon_social.trim() && !f.nombre.trim()) {
      mostrar("Ingresá la razón social o el nombre de fantasía.", "err")
      return
    }
    // Mismo control que el 409 del servidor, contra la cartera del equipo. El servidor
    // vuelve a controlar contra TODOS los clientes (los de otros viajantes) al sincronizar.
    const cuitLimpio = f.cuit.trim()
    if (cuitLimpio) {
      const dup = clientes.find((c) => (c.cuit || "").trim() === cuitLimpio)
      if (dup) {
        setDuplicado({ id: dup.id, nombre: dup.nombre })
        hojaDuplicado.abrir()
        return
      }
    }
    setGuardando(true)
    try {
      const id = uuidv4()
      // Misma regla que el servidor (POST /api/vendedor/clientes): el cliente nace asignado al
      // viajante elegido (o al primero) y la lista la impone ese viajante; si no impone, la elige
      // quien tiene permiso. Va resuelta en el payload para que el precio sin señal sea el mismo.
      const viajante = vendedores.find((v) => v.id === f.vendedor_id) ?? vendedores[0] ?? null
      const lista_precio_id = viajante?.lista_precio_id || (cat?.puede_cambiar_lista ? f.lista_precio_id || null : null)
      const nombre = f.nombre.trim() || f.razon_social.trim()
      await encolar(
        "cliente.crear",
        {
          ...f,
          id,
          nombre,
          localidad: localidades.find((l) => l.id === f.localidad_id)?.nombre || null,
          vendedor_id: viajante?.id ?? f.vendedor_id,
          lista_precio_id,
        },
        `Cliente nuevo: ${nombre}`,
      )
      navigate(irAPedido ? `/pedido/nuevo/${id}` : `/clientes/${id}`, { replace: true })
    } catch {
      mostrar("No se pudo guardar el cliente en el equipo.", "err")
      setGuardando(false)
    }
  }

  return (
    <Pantalla
      titulo="➕ Nuevo cliente"
      pie={
        <div className="border-t border-gray-200 bg-white p-4">
          <div className="mx-auto grid max-w-2xl grid-cols-2 gap-2">
            <button onClick={() => void guardar(false)} disabled={guardando} className="rounded-xl border-2 border-emerald-600 bg-white py-4 font-bold text-emerald-700 disabled:opacity-50">
              Guardar
            </button>
            <button onClick={() => void guardar(true)} disabled={guardando} className="rounded-xl bg-emerald-600 py-4 font-bold text-white disabled:bg-gray-300">
              {guardando ? "Guardando..." : "Guardar y levantar pedido 🛒"}
            </button>
          </div>
        </div>
      }
    >
      {toast}
      <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
        <p className="text-sm text-gray-500">Cargalo y arrancá el pedido al toque</p>
        {!cat && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            Todavía no se descargaron las listas de opciones (condiciones, localidades) en este equipo. Conectate una vez para tenerlas sin señal.
          </p>
        )}

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
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
                {(cat?.condiciones_iva ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Campo>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Comercial</p>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Método facturación">
              <select value={f.metodo_facturacion} onChange={set("metodo_facturacion")} className={inputCls}>
                {(cat?.metodos_facturacion ?? ["Factura"]).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Campo>
            {listaImpuesta ? (
              <Campo label="Lista de precios">
                <div className={`${inputCls} bg-gray-50 text-gray-600`}>
                  {listaImpuesta} <span className="text-xs text-gray-400">(por viajante)</span>
                </div>
              </Campo>
            ) : cat?.puede_cambiar_lista ? (
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
                {(cat?.condiciones_pago ?? []).map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Condición de entrega">
              <select value={f.condicion_entrega} onChange={set("condicion_entrega")} className={inputCls}>
                <option value="">Elegir...</option>
                {(cat?.condiciones_entrega ?? []).map((c) => <option key={c.id} value={c.codigo}>{c.nombre}</option>)}
              </select>
            </Campo>
          </div>
          {vendedores.length > 1 && (
            <Campo label="Viajante">
              <select value={f.vendedor_id} onChange={set("vendedor_id")} className={inputCls}>
                <option value="">Elegir viajante...</option>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}{v.lista_nombre ? ` → lista ${v.lista_nombre}` : ""}
                  </option>
                ))}
              </select>
            </Campo>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Ubicación y contacto</p>
          <Campo label="Dirección">
            <input value={f.direccion} onChange={set("direccion")} className={inputCls} placeholder="Calle y número" />
          </Campo>
          <Campo label="Localidad">
            <div className="flex gap-2">
              <select value={f.localidad_id} onChange={set("localidad_id")} className={inputCls}>
                <option value="">Elegir localidad...</option>
                {localidades.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre}{l.provincia ? ` — ${l.provincia}` : ""}
                  </option>
                ))}
              </select>
              <button type="button" onClick={hojaLocalidad.abrir} className="min-h-11 shrink-0 rounded-xl border-2 border-emerald-600 bg-white px-3 text-sm font-bold text-emerald-700">
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

      <HojaNuevaLocalidad
        abierta={hojaLocalidad.abierto}
        zonas={cat?.zonas ?? []}
        onCerrar={hojaLocalidad.cerrar}
        onCreada={(l) => {
          setLocalidadesNuevas((prev) => [...prev.filter((x) => x.id !== l.id), { id: l.id, nombre: l.nombre, provincia: l.provincia }])
          setF((prev) => ({ ...prev, localidad_id: l.id }))
          hojaLocalidad.cerrar()
        }}
      />

      <HojaConfirmar
        abierta={hojaDuplicado.abierto && !!duplicado}
        onCerrar={hojaDuplicado.cerrar}
        titulo="Cliente existente"
        confirmar="Abrir la ficha"
        onConfirmar={() => duplicado && navigate(`/clientes/${duplicado.id}`, { replace: true })}
      >
        Ya existe un cliente con ese CUIT: {duplicado?.nombre}. ¿Abrir la ficha de ese cliente?
      </HojaConfirmar>
    </Pantalla>
  )
}
