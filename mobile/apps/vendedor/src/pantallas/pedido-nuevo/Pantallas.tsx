import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router"
import { useContadoresOutbox, useOverlay, useParamEstado, useRuntime } from "@gm/core"
import { ListaVirtual } from "@gm/core/ui"
import { localMatch } from "@gm/vendedor"
import { DS, type Articulo, type CatalogoRubro, type OpPedido } from "../../datasets"
import { buscarCatalogo, filtrarLocal, vistaHabituales, vistaNovedades, vistaOfertas } from "../../datos/busqueda"
import { useCatalogosFicha, useClientes, useCuenta, useEncolar, useProveedores, useTaxonomia } from "../../datos/hooks"
import { preciosAl, usePreciosVencidos } from "../../datos/precios"
import { formatCurrency, HojaConfirmar, Pantalla, SinDescargar, useBusqueda, useFotoZoom, useVolver, Vacio } from "../../ui"
import { IconoCategoria, TINTE_HABITUALES, TINTE_NOVEDADES, TINTE_OFERTAS, tinteRubro, type Tinte } from "./catalogo-ui"
import { usePedidoEnCurso, useVer } from "./contexto"
import { condParaServidor, fmtSeg } from "./Marco"
import { agruparEnArbol, BuscadorLocal, CatalogoArbol, claveSubcategoria, FilaArticulo, OrdenSelector, posicionSubcategorias } from "./piezas"

type Filtro = "novedades" | "ofertas" | "habituales"
const TINTE_PROVEEDORES: Tinte = { bg: "#F0F1F7", bgSoft: "#F7F8FC", ink: "#31354A", accent: "#5E6480", border: "#E3E5EF" }
const FILTROS: Record<Filtro, { label: string; sub: string; tinte: Tinte; icono: string }> = {
  novedades: { label: "Novedades", sub: "Últimos ingresos", tinte: TINTE_NOVEDADES, icono: "✨" },
  ofertas: { label: "Ofertas", sub: "Con descuento", tinte: TINTE_OFERTAS, icono: "🏷" },
  habituales: { label: "Habituales", sub: "Lo de siempre", tinte: TINTE_HABITUALES, icono: "⭐" },
}
const tinteArbol = (nombre: string) => {
  const t = tinteRubro(nombre)
  return { bg: t.bg, border: t.border, ink: t.ink, accent: t.accent }
}

// ─── Elegir cliente (/pedido/nuevo) ──────────────────────────────────────────

export function ElegirCliente() {
  const navigate = useNavigate()
  const { clientes, cargando } = useClientes()
  const [q, setQ] = useBusqueda("q")
  // Mismos campos que el buscador del ERP: nombre, razón social, dirección, localidad, CUIT y código
  const filtrados = useMemo(() => (q ? clientes.filter((c) => localMatch(q, c.nombre, c.razon_social, c.direccion, c.localidad, c.cuit, c.codigo_cliente)) : clientes), [clientes, q])
  return (
    <Pantalla titulo="Nuevo pedido — Elegir cliente" dataset={DS.clientes}>
      <div className="bg-slate-900 px-4 pb-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente..." className="w-full rounded-xl bg-white px-4 py-3 text-lg text-gray-900 outline-none" />
      </div>
      {!cargando && clientes.length === 0 ? (
        <SinDescargar que="tu cartera de clientes" />
      ) : (
        <ListaVirtual
          items={filtrados}
          alto={84}
          clave={(c) => c.id}
          vacio={`Sin resultados para "${q}".`}
          render={(c) => (
            <div className="px-4 pt-2">
              {/* replace: atrás desde el catálogo vuelve a donde estaba el vendedor, no al selector (igual que la web) */}
              <button onClick={() => navigate(`/pedido/nuevo/${c.id}`, { replace: true })} className="h-[76px] w-full rounded-xl border border-gray-200 bg-white px-4 text-left shadow-sm">
                <p className="truncate font-bold text-gray-900">{c.nombre}</p>
                <p className="truncate text-sm text-gray-500">{[c.direccion, c.localidad].filter(Boolean).join(" · ") || "—"}</p>
              </button>
            </div>
          )}
        />
      )}
    </Pantalla>
  )
}

// ─── Marco visual de las pantallas del catálogo ──────────────────────────────

const METODO_CORTO: Record<string, string> = { Factura: "C/IVA", Final: "FINAL", Presupuesto: "PRES" }

function PantallaCatalogo({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  const p = usePedidoEnCurso()
  const { abrir } = useVer()
  const catFicha = useCatalogosFicha()
  const nombreLista = (id: string | null | undefined) => catFicha?.listas_precio.find((l) => l.id === id)?.nombre
  const listaChip = (p.cond.lista ? nombreLista(p.cond.lista) : p.cliente?.lista?.nombre || nombreLista(p.cliente?.lista_precio_id)) || "STD"
  const metodoRaw = p.cond.metodo || p.cliente?.metodo_facturacion || ""
  const chip = `${listaChip.toUpperCase()} ${METODO_CORTO[metodoRaw] || metodoRaw.toUpperCase() || "—"}`
  const vencidos = usePreciosVencidos()
  if (!p.cliente) {
    return (
      <Pantalla titulo="Nuevo pedido">
        {p.cargandoCliente ? null : <Vacio icono="🤷">Este cliente ya no está en tu cartera.</Vacio>}
      </Pantalla>
    )
  }
  return (
    <Pantalla
      titulo={titulo}
      dataset={DS.preciosArticulos}
      etiquetaFrescura="Precios al"
      viejoTrasMin={30}
      preciosVencidos={vencidos}
      derecha={
        <>
          {/* Chip lista + método vigentes (cortito: NECO FINAL). Ámbar = "solo este pedido" */}
          <button onClick={() => abrir("cliente")} className={`mr-1 min-h-9 shrink-0 rounded-xl border px-2.5 text-[11px] font-bold ${p.cond.metodo || p.cond.lista ? "border-amber-300 bg-amber-400 text-amber-950" : "border-white/30 bg-white/10 text-white"}`}>{chip}</button>
          <button onClick={() => abrir("cliente")} className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/30 bg-white/10 text-lg" aria-label="Cliente: ficha, cuenta corriente y método">👤</button>
        </>
      }
    >
      {subtitulo && <p className="truncate bg-slate-800 px-4 py-1 text-xs text-slate-200">{subtitulo}</p>}
      {p.catalogoVacio ? <SinDescargar que="el catálogo" /> : <div className="mx-auto w-full max-w-2xl p-4 pb-28">{children}</div>}
    </Pantalla>
  )
}

/** Fila estándar de artículo: MISMO formato en todos los listados (árbol, categorías, proveedor, filtros y búsqueda). */
function useFilaDe() {
  const p = usePedidoEnCurso()
  const { abrir } = useVer()
  const foto = useFotoZoom()
  return (a: Articulo) => (
    <FilaArticulo
      key={a.id}
      a={a}
      precio={p.motor.precio(a.id)}
      enCarrito={p.enCarrito(a.id)}
      onAbrir={() => abrir(`articulo:${a.id}`)}
      onZoom={() => foto.abrir(a.imagen_url)}
      onAgregar={(u) => p.agregar(a, u)}
      onActualizar={(u) => p.setCantidad(a.id, u)}
      onQuitar={() => p.quitar(a.id)}
    />
  )
}

/** Listado plano largo: se pinta de a tandas a medida que se baja (las filas tienen alto variable). */
function ListaCreciente({ items, render }: { items: Articulo[]; render: (a: Articulo) => ReactNode }) {
  const [tope, setTope] = useState(40)
  const fin = useRef<HTMLDivElement>(null)
  useEffect(() => setTope(40), [items])
  useEffect(() => {
    const el = fin.current
    if (!el) return
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) setTope((t) => t + 40) }, { rootMargin: "600px" })
    io.observe(el)
    return () => io.disconnect()
  }, [items, tope])
  return (
    <div className="space-y-2">
      {items.slice(0, tope).map(render)}
      {tope < items.length && <div ref={fin} className="h-8" />}
    </div>
  )
}

// ─── Home del catálogo (/pedido/nuevo/:clienteId) ────────────────────────────

export function CatalogoHome() {
  const p = usePedidoEnCurso()
  const navigate = useNavigate()
  const { abrir } = useVer()
  const taxonomia = useTaxonomia()
  const filaDe = useFilaDe()
  const [q, setQ] = useBusqueda("q")
  const qDiferida = useDeferredValue(q)
  const base = `/pedido/nuevo/${p.clienteId}`
  const { indice, ordenar } = p
  const resultados = useMemo(() => ordenar(buscarCatalogo(indice, qDiferida)), [indice, ordenar, qDiferida])

  const subtitulo = p.borrador?.numeroPedido
    ? `Pedido Nº ${p.borrador.numeroPedido}${p.borrador.estadoPedido && p.borrador.estadoPedido !== "en_venta" ? " · editando" : " · se guarda en el equipo"}`
    : p.lineas.length
      ? "Pedido en curso · se guarda en el equipo"
      : p.cliente?.metodo_facturacion ? `Facturación: ${p.cliente.metodo_facturacion}` : "Nuevo pedido"

  return (
    <PantallaCatalogo titulo={q ? "Buscar artículos" : p.cliente?.nombre || "Nuevo pedido"} subtitulo={q ? p.cliente?.nombre : subtitulo}>
      <div className="-mx-4 -mt-4 mb-4 flex gap-2 bg-slate-900 px-4 pb-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar artículo, SKU o EAN..." className="w-full flex-1 rounded-xl bg-white px-4 py-3 text-lg text-gray-900 outline-none" />
        <button onClick={() => abrir("buscar-foto")} className="w-[52px] shrink-0 rounded-xl border border-white/30 bg-white/10 text-xl" aria-label="Buscar con la cámara: código de barras o foto del producto">📷</button>
      </div>

      {q ? (
        resultados.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">Sin resultados para “{q}”. Probá con otra palabra, SKU o EAN.</div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <p className="text-xs text-gray-400">{resultados.length} resultados</p>
              <OrdenSelector value={p.orden} onChange={p.setOrden} />
            </div>
            {resultados.map(filaDe)}
          </div>
        )
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(FILTROS) as Filtro[]).map((tipo) => {
              const f = FILTROS[tipo]
              return (
                <button key={tipo} onClick={() => navigate(`${base}/filtro/${tipo}`)} className="rounded-2xl border p-2.5 text-left" style={{ background: f.tinte.bg, borderColor: f.tinte.border, color: f.tinte.ink }}>
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-lg">{f.icono}</div>
                  <p className="text-[13px] font-bold leading-tight">{f.label}</p>
                  <p className="mt-0.5 text-[10px] opacity-70">{f.sub}</p>
                </button>
              )
            })}
            <button onClick={() => navigate(`${base}/proveedores`)} className="rounded-2xl border p-2.5 text-left" style={{ background: TINTE_PROVEEDORES.bg, borderColor: TINTE_PROVEEDORES.border, color: TINTE_PROVEEDORES.ink }}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-lg">📦</div>
              <p className="text-[13px] font-bold leading-tight">Proveedores</p>
              <p className="mt-0.5 text-[10px] opacity-70">Catálogo completo</p>
            </button>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Catálogo por rubro</p>
              <OrdenSelector value={p.orden} onChange={p.setOrden} />
            </div>
            {taxonomia.length === 0 ? (
              <SinDescargar que="el catálogo por rubro" />
            ) : (
              <CatalogoArbol
                clave="home"
                rubros={taxonomia}
                articulosDe={(catId) => p.indice.porCategoria.get(catId) || []}
                renderArticulo={filaDe}
                ordenar={p.ordenar}
                onVerRubro={(r) => navigate(`${base}/rubro/${r.id}`)}
                tinte={tinteArbol}
              />
            )}
          </div>
        </div>
      )}
    </PantallaCatalogo>
  )
}

// ─── Selector de proveedor (/…/proveedores) ──────────────────────────────────

export function Proveedores() {
  const p = usePedidoEnCurso()
  const navigate = useNavigate()
  const proveedores = useProveedores()
  const [q, setQ] = useBusqueda("q")
  const visibles = proveedores.filter((x) => !q.trim() || x.nombre.toLowerCase().includes(q.toLowerCase()) || (x.sigla || "").toLowerCase().includes(q.toLowerCase()))
  return (
    <PantallaCatalogo titulo="Por proveedor" subtitulo={p.cliente?.nombre}>
      <div className="space-y-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor..." className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-lg outline-none" />
        <div className="grid grid-cols-2 gap-2.5">
          {visibles.map((x) => (
            <button key={x.id} onClick={() => navigate(`/pedido/nuevo/${p.clienteId}/proveedor/${x.id}`)} className="rounded-2xl border p-3.5 text-left" style={{ background: TINTE_PROVEEDORES.bgSoft, borderColor: TINTE_PROVEEDORES.border }}>
              <p className="text-[13px] font-bold leading-snug text-gray-900">{x.nombre}</p>
              <p className="mt-1 text-xs" style={{ color: TINTE_PROVEEDORES.accent }}>{x.cantidad} {x.cantidad === 1 ? "artículo" : "artículos"}</p>
            </button>
          ))}
          {proveedores.length === 0 && <div className="col-span-2 rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">No hay proveedores con artículos activos.</div>}
        </div>
      </div>
    </PantallaCatalogo>
  )
}

// ─── Árbol de un filtro o de un proveedor (/…/filtro/:tipo · /…/proveedor/:provId) ──
// La búsqueda de ESTA pantalla es sobre la lista del filtro activo, nunca sobre todo el
// catálogo: dentro de un proveedor, "shampoo" solo trae shampoo de ese proveedor.

function ArbolDeLista({ titulo, lista, clave, vacio }: { titulo: string; lista: Articulo[]; clave: string; vacio: string }) {
  const p = usePedidoEnCurso()
  const navigate = useNavigate()
  const taxonomia = useTaxonomia()
  const filaDe = useFilaDe()
  const [q, setQ] = useBusqueda("q")
  const qDiferida = useDeferredValue(q)
  const arbol = useMemo(() => agruparEnArbol(filtrarLocal(lista, qDiferida), taxonomia), [lista, qDiferida, taxonomia])
  return (
    <PantallaCatalogo titulo={titulo} subtitulo={p.cliente?.nombre}>
      <div className="space-y-3">
        <BuscadorLocal valor={q} onCambio={setQ} placeholder={`Buscar en ${titulo}...`} orden={p.orden} onOrden={p.setOrden} />
        {arbol.rubros.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">
            {q.trim() ? (
              <>Nada con “{q}” acá. <button onClick={() => navigate(`/pedido/nuevo/${p.clienteId}?q=${encodeURIComponent(q)}`)} className="min-h-11 font-bold text-emerald-700 underline">Buscar en todo el catálogo</button></>
            ) : vacio}
          </div>
        ) : (
          <CatalogoArbol
            // Con búsqueda activa el árbol se muestra abierto (pocos resultados, a la vista)
            key={q.trim() ? "busqueda" : "normal"}
            clave={q.trim() ? `${clave}:q` : clave}
            rubros={arbol.rubros}
            articulosDe={(catId) => arbol.artsPorCat.get(catId) || []}
            renderArticulo={filaDe}
            ordenar={p.ordenar}
            abiertoInicial={arbol.rubros.map((r) => r.id)}
            tinte={tinteArbol}
          />
        )}
      </div>
    </PantallaCatalogo>
  )
}

export function VistaFiltro() {
  const p = usePedidoEnCurso()
  const { tipo } = useParams()
  const filtro = (["novedades", "ofertas", "habituales"] as const).find((t) => t === tipo) ?? "novedades"
  const { cuenta } = useCuenta(filtro === "habituales" ? p.clienteId : undefined)
  const lista = useMemo(
    () => (filtro === "ofertas" ? vistaOfertas(p.indice) : filtro === "novedades" ? vistaNovedades(p.indice) : vistaHabituales(p.indice, cuenta?.habituales || [])),
    [filtro, p.indice, cuenta?.habituales],
  )
  const vacio = filtro === "habituales"
    ? "Este cliente todavía no tiene artículos habituales. Buscá desde el inicio para armar su primer pedido."
    : filtro === "ofertas" ? "No hay artículos en oferta en este momento." : "No hay ingresos recientes en el catálogo."
  return <ArbolDeLista titulo={FILTROS[filtro].label} lista={lista} clave={`filtro:${filtro}:${p.clienteId}`} vacio={vacio} />
}

export function VistaProveedor() {
  const p = usePedidoEnCurso()
  const { provId } = useParams()
  const proveedores = useProveedores()
  const nombre = proveedores.find((x) => x.id === provId)?.nombre || "Proveedor"
  const lista = useMemo(() => p.indice.porProveedor.get(provId || "") || [], [p.indice, provId])
  return <ArbolDeLista titulo={nombre} lista={lista} clave={`prov:${provId}`} vacio="Este proveedor no tiene artículos activos con precio." />
}

// ─── Rubro: tarjetas de categoría (/…/rubro/:rubroId) y su listado (/…/rubro/:rubroId/:catId) ──

const rubroDe = (taxonomia: CatalogoRubro[], id: string | undefined) => taxonomia.find((r) => r.id === id) ?? null

export function RubroCategorias() {
  const p = usePedidoEnCurso()
  const navigate = useNavigate()
  const { rubroId } = useParams()
  const rubro = rubroDe(useTaxonomia(), rubroId)
  const t = tinteRubro(rubro?.nombre)
  return (
    <PantallaCatalogo titulo={rubro?.nombre || "Rubro"} subtitulo={p.cliente?.nombre}>
      {!rubro || rubro.categorias.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">Este rubro no tiene categorías con artículos.</div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {rubro.categorias.map((c) => (
            <button key={c.id} onClick={() => navigate(`/pedido/nuevo/${p.clienteId}/rubro/${rubro.id}/${c.id}`)} className="rounded-2xl border p-3.5 text-left" style={{ background: t.bgSoft, borderColor: t.border }}>
              <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: t.bg, color: t.ink }}><IconoCategoria nombre={c.nombre} className="h-5 w-5" /></div>
              <p className="text-[13px] font-bold leading-snug text-gray-900">{c.nombre}</p>
              <p className="mt-1 text-xs" style={{ color: t.accent }}>{c.cantidad} {c.cantidad === 1 ? "artículo" : "artículos"}</p>
            </button>
          ))}
        </div>
      )}
    </PantallaCatalogo>
  )
}

export function CategoriaArticulos() {
  const p = usePedidoEnCurso()
  const navigate = useNavigate()
  const { rubroId, catId } = useParams()
  const taxonomia = useTaxonomia()
  const rubro = rubroDe(taxonomia, rubroId)
  const cat = rubro?.categorias.find((c) => c.id === catId) ?? null
  const filaDe = useFilaDe()
  const [q, setQ] = useBusqueda("q")
  const [sub, setSub] = useParamEstado("sub")
  const qDiferida = useDeferredValue(q)
  const base = useMemo(() => p.indice.porCategoria.get(catId || "") || [], [p.indice, catId])

  // Chips de subcategoría derivados de los artículos presentes, en el orden de la taxonomía
  const posSub = useMemo(() => posicionSubcategorias(taxonomia), [taxonomia])
  const subchips = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; cantidad: number; pos: number }>()
    for (const a of base) {
      const k = claveSubcategoria(a)
      if (!k) continue
      const g = m.get(k)
      if (g) g.cantidad++
      else m.set(k, { id: k, nombre: a.subcategoria_nombre || "—", cantidad: 1, pos: posSub(a) })
    }
    return [...m.values()].sort((a, b) => a.pos - b.pos || b.cantidad - a.cantidad)
  }, [base, posSub])

  const visibles = useMemo(() => {
    let l = sub ? base.filter((a) => claveSubcategoria(a) === sub) : base
    l = filtrarLocal(l, qDiferida)
    // Orden natural = taxonomía de subcategorías; después el orden elegido por el vendedor
    if (!sub) l = [...l].sort((a, b) => posSub(a) - posSub(b))
    return p.ordenar(l)
  }, [base, sub, qDiferida, posSub, p])

  return (
    <PantallaCatalogo titulo={cat?.nombre || "Categoría"} subtitulo={`${rubro?.nombre || ""} · ${p.cliente?.nombre || ""}`}>
      <div className="space-y-3">
        <BuscadorLocal valor={q} onCambio={setQ} placeholder={`Buscar en ${cat?.nombre || "este listado"}...`} orden={p.orden} onOrden={p.setOrden} />
        {subchips.length > 1 && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <button onClick={() => setSub("")} className={`min-h-9 shrink-0 rounded-full border px-3.5 text-xs font-bold ${!sub ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-600"}`}>Todas</button>
            {subchips.map((s) => (
              <button key={s.id} onClick={() => setSub(sub === s.id ? "" : s.id)} className={`min-h-9 shrink-0 rounded-full border px-3.5 text-xs font-bold ${sub === s.id ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-600"}`}>{s.nombre} · {s.cantidad}</button>
            ))}
          </div>
        )}
        {visibles.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">
            {q.trim() ? <>Nada con “{q}” acá. <button onClick={() => navigate(`/pedido/nuevo/${p.clienteId}?q=${encodeURIComponent(q)}`)} className="min-h-11 font-bold text-emerald-700 underline">Buscar en todo el catálogo</button></> : "No hay artículos en esta categoría."}
          </div>
        ) : (
          <ListaCreciente items={visibles} render={filaDe} />
        )}
      </div>
    </PantallaCatalogo>
  )
}

// ─── Carrito / confirmación (/…/carrito) ─────────────────────────────────────

export function Carrito() {
  const p = usePedidoEnCurso()
  const rt = useRuntime()
  const navigate = useNavigate()
  const volver = useVolver()
  const encolar = useEncolar()
  const catFicha = useCatalogosFicha()
  const descartar = useOverlay("descartar")
  const [confirmando, setConfirmando] = useState(false)
  const vencidos = usePreciosVencidos()
  const editandoExistente = !!p.borrador?.pedidoId && p.borrador.estadoPedido !== "en_venta"
  const sinPrecio = p.lineas.filter((l) => !l.precio || l.precio.precio <= 0)
  const bonif = p.cond.bonif

  const confirmar = async () => {
    const b = p.borrador
    if (!b || !p.cliente || !p.lineas.length || sinPrecio.length || confirmando) return
    setConfirmando(true)
    try {
      const payload: OpPedido = {
        local_id: b.localId,
        pedido_id: b.pedidoId,
        cliente_id: p.clienteId,
        items: p.lineas.map((l) => ({
          articulo_id: l.articuloId, cantidad: l.cantidad, precio: l.precio!.precio, detalle_id: l.detalleId ?? null, ...(l.fijo ? { precio_fijo: true } : {}),
          precio_neto: l.precio!.precioNeto, descripcion: l.art.descripcion, sku: l.art.sku, unidades_por_bulto: l.art.unidades_por_bulto, imagen_url: l.art.imagen_url,
        })),
        cond: condParaServidor(p.cond),
        observaciones: b.obs.trim() || null,
        // Vigencia de los precios que el vendedor tuvo a la vista (MOBILE.md → Vendedor → precios)
        precios_al: preciosAl(rt),
        vista: { cliente_nombre: p.cliente.nombre, total: Math.round(p.total * 100) / 100, numero_pedido: b.numeroPedido, estado: b.estadoPedido },
      }
      // Durable ANTES de soltar el borrador: si la app muere acá, el pedido ya está en el outbox
      await encolar(b.pedidoId ? "pedido.editar" : "pedido.crear", payload, `${b.pedidoId ? "Cambios al pedido" : "Pedido"} · ${p.cliente.nombre} · ${formatCurrency(p.total)}`)
      await p.descartar()
      navigate(`/pedido/nuevo/${p.clienteId}/listo?${b.pedidoId ? "editado=1&" : ""}n=${encodeURIComponent(b.numeroPedido || "")}`, { replace: true })
    } finally {
      setConfirmando(false)
    }
  }

  if (!p.cliente) return <Pantalla titulo="Confirmar pedido">{null}</Pantalla>
  return (
    <Pantalla
      titulo={editandoExistente ? "Guardar cambios" : "Confirmar pedido"}
      preciosVencidos={vencidos}
      dataset={DS.preciosArticulos}
      etiquetaFrescura="Precios al"
      viejoTrasMin={30}
      pie={
        <div className="border-t border-gray-200 bg-white p-4">
          <div className="mx-auto max-w-2xl space-y-2">
            <div className="flex items-center justify-between text-lg">
              <span className="text-gray-500">Total ({p.totalItems} ítems)</span>
              <span className="text-2xl font-bold text-gray-900">{formatCurrency(p.total)}</span>
            </div>
            {vencidos && <p className="text-xs font-bold text-red-700">Precios sin actualizar hace más de 24 hs: el total es orientativo. El pedido se factura al precio del sistema cuando ingrese.</p>}
            {sinPrecio.length > 0 && <p className="text-sm font-medium text-red-600">Hay {sinPrecio.length} artículo(s) sin precio en este equipo: quitalos para poder confirmar.</p>}
            <button onClick={() => void confirmar()} disabled={confirmando || !p.lineas.length || sinPrecio.length > 0} className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:bg-gray-300">
              {confirmando ? "Guardando..." : editandoExistente ? "Guardar cambios" : "Confirmar pedido"}
            </button>
          </div>
        </div>
      }
    >
      <p className="bg-slate-800 px-4 py-1 text-xs text-slate-200">{p.cliente.nombre}{p.borrador?.numeroPedido ? ` · Pedido Nº ${p.borrador.numeroPedido}` : ""}</p>
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        {p.lineas.length === 0 && <Vacio icono="🛒">El pedido no tiene artículos.</Vacio>}
        {p.lineas.map((i) => (
          <div key={i.articuloId} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="flex-1 text-sm font-bold leading-snug text-gray-900">{i.art.descripcion}</p>
              <button onClick={() => p.quitar(i.articuloId)} className="-mr-2 -mt-2 h-11 w-11 text-xl leading-none text-red-500" aria-label="Quitar">✕</button>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => p.setCantidad(i.articuloId, Math.max(1, i.cantidad - 1))} className="h-11 w-11 rounded-lg bg-gray-100 text-xl font-bold text-gray-700">−</button>
                <span className="w-12 text-center text-lg font-bold">{i.cantidad}</span>
                <button onClick={() => p.setCantidad(i.articuloId, i.cantidad + 1)} className="h-11 w-11 rounded-lg bg-gray-100 text-xl font-bold text-gray-700">+</button>
              </div>
              <div className="text-right">
                {i.precio ? (
                  <>
                    <p className="text-xs text-gray-400">{formatCurrency(i.precio.precio)} c/u</p>
                    <p className="font-bold text-gray-900">{formatCurrency(i.precio.precio * i.cantidad)}</p>
                  </>
                ) : <p className="text-xs font-bold text-red-600">Sin precio</p>}
              </div>
            </div>
          </div>
        ))}

        {p.lineas.length > 0 && (
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <label className="mb-1 block text-sm text-gray-500">Método de facturación</label>
              <select value={p.cond.metodo} onChange={(e) => p.setCond({ ...p.cond, metodo: e.target.value })} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3">
                <option value="">Del cliente{p.cliente.metodo_facturacion ? ` (${p.cliente.metodo_facturacion})` : ""}</option>
                <option value="Factura">Factura</option>
                <option value="Final">Final (Mixto)</option>
                <option value="Presupuesto">Presupuesto</option>
              </select>
              <p className="mt-1 text-xs text-gray-400">Al cambiar el método, todos los precios del pedido se recalculan al instante.</p>
              {(p.cond.lista || (bonif && (Object.keys(bonif.viajante || {}).length || Object.keys(bonif.mercaderia || {}).length))) ? (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Solo este pedido:
                  {p.cond.lista ? ` lista ${catFicha?.listas_precio.find((l) => l.id === p.cond.lista)?.nombre || "—"}` : ""}
                  {bonif?.viajante && Object.keys(bonif.viajante).length ? ` · viajante ${fmtSeg(bonif.viajante)}` : ""}
                  {bonif?.mercaderia && Object.keys(bonif.mercaderia).length ? ` · mercadería ${fmtSeg(bonif.mercaderia)}` : ""} (se cambia desde 👤)
                </p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-500">Observaciones</label>
              <textarea value={p.borrador?.obs || ""} onChange={(e) => p.setObs(e.target.value)} rows={2} className="w-full rounded-xl border border-gray-300 px-4 py-3" placeholder="Opcional..." />
            </div>
          </div>
        )}

        {p.borrador && (
          <button onClick={descartar.abrir} className="min-h-11 w-full rounded-xl border border-red-200 bg-white py-3 text-sm font-bold text-red-600">
            {p.borrador.pedidoId ? "Descartar estos cambios" : "Descartar este pedido"}
          </button>
        )}
      </div>

      <HojaConfirmar
        abierta={descartar.abierto}
        onCerrar={descartar.cerrar}
        titulo={p.borrador?.pedidoId ? "¿Descartar los cambios?" : "¿Descartar el pedido?"}
        confirmar="Descartar"
        peligro
        onConfirmar={() => { void p.descartar().then(() => volver(2)) }}
      >
        {p.borrador?.pedidoId ? "El pedido queda como estaba en el sistema." : `Se borran los ${p.totalItems} ítems cargados para ${p.cliente.nombre}. No se puede deshacer.`}
      </HojaConfirmar>
    </Pantalla>
  )
}

// ─── Éxito (/…/listo) ────────────────────────────────────────────────────────

export function PedidoListo() {
  const p = usePedidoEnCurso()
  const navigate = useNavigate()
  const { pendientes } = useContadoresOutbox()
  const [editado] = useParamEstado("editado")
  const [n] = useParamEstado("n")
  return (
    <Pantalla titulo={editado ? "Cambios guardados" : "Pedido confirmado"} atras={false}>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-6xl">✅</p>
          <h1 className="text-2xl font-bold text-gray-900">{editado ? "Cambios guardados" : "Pedido confirmado"}</h1>
          {n ? <p className="text-lg text-gray-500">N° {n}</p> : null}
          <p className="text-sm text-gray-500">
            {pendientes === 0
              ? "Ya está en la oficina."
              : "Quedó guardado en el equipo y se envía solo apenas haya señal. Mientras tanto lo ves en Mis pedidos como “pendiente de enviar” y lo podés editar."}
          </p>
          <div className="grid grid-cols-1 gap-3 pt-2">
            <button onClick={() => navigate(`/pedido/nuevo/${p.clienteId}`, { replace: true })} className="rounded-xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white">Nuevo pedido para {p.cliente?.nombre}</button>
            <button onClick={() => navigate("/pedidos", { replace: true })} className="rounded-xl border border-gray-300 bg-white px-6 py-3 font-medium text-gray-700">Ver mis pedidos</button>
            <button onClick={() => navigate("/", { replace: true })} className="min-h-11 py-2 text-gray-500">Volver al inicio</button>
          </div>
        </div>
      </div>
    </Pantalla>
  )
}
