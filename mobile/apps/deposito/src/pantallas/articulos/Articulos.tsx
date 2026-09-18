import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router"
import { esQrOUrl, lecturaError, lecturaOk, useNoEnviados, useOverlay, useParamEstado } from "@gm/core"
import { Hoja, ListaVirtual } from "@gm/core/ui"
import { DS, type OpDatos, type OpStock } from "../../datasets"
import { buscarPorCodigo, coincide, eansDe, lineaInfo, padEan13, sufijoMarca } from "../../datos/busqueda"
import { useArticulos, useCatalogos, useEncolar, useVistaArticulos } from "../../datos/hooks"
import { cmpOrdenDeposito, cmpSinCodigo, type ArticuloVista } from "../../datos/overlay"
import { C, Marco, Rechazos, SinEnviar, useToast, useVolver } from "../../ui"
import { PanelBuscar } from "../comunes/Buscar"
import { useRecorrido } from "./recorrido"

const DATASET = DS.articulos
const POS_KEY = "ajuste_stock_pos"
const opcionesCon = (lista: string[], actual: string | null | undefined) => (actual && !lista.includes(actual) ? [...lista, actual] : lista)

const chip = (activo: boolean): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 20, fontSize: 14, fontWeight: 600, minHeight: 44,
  background: activo ? C.indigoL : "#f3f4f6", border: `1px solid ${activo ? "#6366f1" : C.border}`, color: activo ? C.indigo : "#374151",
})

// ─── /articulos — búsqueda + filtros ─────────────────────────────────────────

export function Articulos() {
  const navigate = useNavigate()
  const tipoNav = useNavigationType()
  const { articulos, indice } = useArticulos()
  const { proveedores } = useCatalogos()
  const vista = useVistaArticulos()
  const ops = useNoEnviados()
  const { toast, mostrar } = useToast()
  const [prov, setProv] = useParamEstado("prov")
  const [cat, setCat] = useParamEstado("cat")
  const [sp] = useSearchParams()
  const q = sp.get("q") ?? ""
  const pickerProv = useOverlay("prov")
  const pickerCat = useOverlay("cat")
  const [filtroPicker, setFiltroPicker] = useState("")
  const [reinicio, setReinicio] = useState(0)

  // Retomar donde quedó (la web hace lo mismo al recargar): solo al ENTRAR, no al volver
  useEffect(() => {
    if (tipoNav !== "PUSH") return
    try {
      const pos = localStorage.getItem(POS_KEY)
      if (pos?.startsWith("/articulos/")) navigate(pos)
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categorias = useMemo(() => [...new Set(articulos.map((a) => a.categoria).filter((c): c is string => !!c))].sort(), [articulos])
  const provSel = proveedores.find((p) => p.id === prov)
  const hayFiltro = !!(prov || cat)

  // Con filtro y sin texto: los primeros 50 del filtro por descripción (igual que la web)
  const enFiltro = useMemo(
    () => (hayFiltro ? (a: { proveedor_id: string | null; categoria: string | null }) => (!prov || a.proveedor_id === prov) && (!cat || (a.categoria || "").toLowerCase() === cat.toLowerCase()) : undefined),
    [hayFiltro, prov, cat],
  )
  const delFiltro = useMemo(
    () => (enFiltro ? articulos.filter(enFiltro).sort((x, y) => (x.descripcion < y.descripcion ? -1 : 1)).slice(0, 50) : undefined),
    [articulos, enFiltro],
  )

  const abrir = (id: string) => navigate(`/articulos/${id}`)
  const limpiar = () => {
    try { localStorage.removeItem(POS_KEY) } catch { /* noop */ }
    navigate("/articulos", { replace: true })
    setReinicio((n) => n + 1) // vacía también el texto del buscador
  }
  const elegirFiltro = (param: "prov" | "cat", valor: string) => {
    const n = new URLSearchParams(sp)
    n.delete("ver")
    n.set(param, valor)
    // El picker se reemplaza por la pantalla con el filtro puesto, y se entra a su lista
    navigate({ pathname: "/articulos", search: `?${n}` }, { replace: true })
    navigate(`/articulos/lista?rec=${encodeURIComponent(`${param}:${valor}`)}`)
  }
  const rechazados = ops.filter((o) => o.estado === "rechazado" && (o.tipo === "stock.ajustar" || o.tipo.startsWith("articulo.")))

  return (
    <Marco titulo="Modificación de Artículos" dataset={DATASET}>
      {toast}
      <Rechazos items={rechazados} ayuda="Abrí el artículo para ver cómo quedó en el servidor y volvé a cargar lo que haga falta." />
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={chip(!!prov)} onClick={() => { setFiltroPicker(""); pickerProv.abrir() }}>
          🏭 {provSel?.nombre ?? "Proveedor"}
          {prov && <span style={{ color: "#6366f1", fontSize: 18, padding: "0 4px" }} onClick={(e) => { e.stopPropagation(); setProv("") }}>×</span>}
        </button>
        <button style={chip(!!cat)} onClick={() => { setFiltroPicker(""); pickerCat.abrir() }}>
          🗂 {cat || "Categoría"}
          {cat && <span style={{ color: "#6366f1", fontSize: 18, padding: "0 4px" }} onClick={(e) => { e.stopPropagation(); setCat("") }}>×</span>}
        </button>
        <button style={chip(false)} onClick={() => navigate("/articulos/lista?rec=orden")}>📦 Orden Depósito</button>
        <button style={chip(false)} onClick={() => navigate("/articulos/lista?rec=sincodigo")}>🚫 Sin código</button>
        {(hayFiltro || q) && <button style={{ ...chip(false), border: "none", color: "#ef4444", fontSize: 13, marginLeft: "auto" }} onClick={limpiar}>Limpiar</button>}
      </div>

      <PanelBuscar
        key={reinicio}
        placeholder="Escanear EAN o buscar SKU / descripción..."
        vacio={{ icono: "🔧", texto: <>Buscá un artículo para modificarlo<br />o filtrá por proveedor / categoría / orden de depósito</> }}
        mostrar={mostrar}
        filtrar={enFiltro}
        sinTexto={delFiltro}
        decorar={(a) => {
          const v = vista(a)
          return {
            bg: C.white, borde: C.border,
            leyenda: (
              <span style={{ color: C.sub, fontWeight: 400 }}>
                Stock: <b style={{ color: C.green }}>{v.stock_actual ?? 0}</b>
                {v.orden_deposito != null && <span style={{ color: "#6366f1" }}> · #{v.orden_deposito}</span>}
                {(v.stockSinEnviar || v.datosSinEnviar) && <> · <SinEnviar /></>}
              </span>
            ),
          }
        }}
        onElegir={(a) => abrir(a.id)}
        onCodigo={(c) => {
          const a = buscarPorCodigo(indice, c)[0]
          if (!a) { lecturaError(); mostrar(`No se encontró el código ${c}`, "err"); return }
          lecturaOk()
          abrir(a.id)
        }}
      />

      <Hoja abierta={pickerProv.abierto} onCerrar={pickerProv.cerrar} titulo="Filtrar por Proveedor">
        <Picker filtro={filtroPicker} setFiltro={setFiltroPicker} placeholder="Buscar proveedor..." items={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))} activo={prov} onElegir={(id) => elegirFiltro("prov", id)} />
      </Hoja>
      <Hoja abierta={pickerCat.abierto} onCerrar={pickerCat.cerrar} titulo="Filtrar por Categoría">
        <Picker filtro={filtroPicker} setFiltro={setFiltroPicker} placeholder="Buscar categoría..." items={categorias.map((c) => ({ id: c, nombre: c }))} activo={cat} onElegir={(id) => elegirFiltro("cat", id)} />
      </Hoja>
    </Marco>
  )
}

function Picker({ filtro, setFiltro, placeholder, items, activo, onElegir }: { filtro: string; setFiltro: (s: string) => void; placeholder: string; items: Array<{ id: string; nombre: string }>; activo: string; onElegir: (id: string) => void }) {
  const visibles = filtro ? items.filter((i) => coincide(filtro, i.nombre)) : items
  return (
    <div style={{ height: "70vh", display: "flex", flexDirection: "column" }}>
      <input type="text" inputMode="search" placeholder={placeholder} value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ background: C.white, border: "1px solid #d1d5db", borderRadius: 12, padding: "13px 16px", color: C.text, fontSize: 17, outline: "none", marginBottom: 8 }} />
      <ListaVirtual
        items={visibles} alto={56} clave={(i) => i.id} vacio="Sin coincidencias"
        render={(i) => (
          <button onClick={() => onElegir(i.id)} style={{ width: "100%", height: 50, textAlign: "left", padding: "0 16px", borderRadius: 12, background: activo === i.id ? C.indigoL : C.white, border: `1px solid ${C.border}`, color: activo === i.id ? C.indigo : "#374151", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.nombre}</span>{activo === i.id && <span>✓</span>}
          </button>
        )}
      />
    </div>
  )
}

function FilaArticulo({ a, onClick, activo }: { a: ArticuloVista; onClick: () => void; activo?: boolean }) {
  const ean = eansDe(a)[0]
  return (
    <div style={{ padding: "3px 10px", height: "100%", boxSizing: "border-box" }}>
      <button onClick={onClick} style={{ width: "100%", height: "100%", textAlign: "left", padding: "10px 16px", borderRadius: 12, background: activo ? C.indigoL : C.white, border: `1px solid ${activo ? C.indigoB : C.border}`, display: "flex", flexDirection: "column", justifyContent: "center", gap: 5, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%" }}>
          <span style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.3, flex: 1, color: activo ? C.indigo : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.descripcion}</span>
          {a.orden_deposito != null && <span style={{ color: "#6366f1", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>#{a.orden_deposito}</span>}
        </div>
        <div style={{ display: "flex", gap: 10, fontSize: 13, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", width: "100%" }}>
          <span style={{ fontFamily: "monospace" }}>{a.sku}</span>
          {ean ? <span style={{ fontFamily: "monospace" }}>{ean}</span> : <span style={{ color: "#c4c9d4" }}>Sin EAN</span>}
          {a.codigo_bulto ? <span style={{ fontFamily: "monospace" }}>DUN: {a.codigo_bulto}</span> : <span style={{ color: "#c4c9d4" }}>Sin código de bulto</span>}
          {(a.stockSinEnviar || a.datosSinEnviar) && <SinEnviar />}
        </div>
      </button>
    </div>
  )
}

// ─── /articulos/lista?rec= — listado navegable ───────────────────────────────

type FilaLista = { tipo: "marca"; id: string; marca: string } | { tipo: "art"; id: string; a: ArticuloVista }

export function ArticulosLista() {
  const [sp] = useSearchParams()
  const rec = sp.get("rec")
  const navigate = useNavigate()
  const location = useLocation()
  const { recorrido, lista, etiqueta } = useRecorrido(rec)
  const ultimo = (location.state as { ultimo?: string } | null)?.ultimo ?? leerPos()?.id

  const filas: FilaLista[] = useMemo(() => {
    if (recorrido?.tipo !== "sincodigo") return lista.map((a) => ({ tipo: "art", id: a.id, a }))
    const out: FilaLista[] = []
    lista.forEach((a, i) => {
      if (i === 0 || (a.marca ?? null) !== (lista[i - 1]!.marca ?? null)) out.push({ tipo: "marca", id: `m-${a.id}`, marca: a.marca || "Sin marca" })
      out.push({ tipo: "art", id: a.id, a })
    })
    return out
  }, [lista, recorrido?.tipo])
  const indiceUltimo = ultimo ? filas.findIndex((f) => f.id === ultimo) : -1

  return (
    <Marco titulo={etiqueta || "Artículos"} dataset={DATASET}>
      <div style={{ padding: "8px 14px 4px", color: C.sub, fontSize: 13 }}>{lista.length} artículos</div>
      <ListaVirtual
        items={filas} clave={(f) => f.id} vacio="No hay artículos en este recorrido"
        altoDe={(f) => (f.tipo === "marca" ? 40 : 86)}
        indiceInicial={indiceUltimo >= 0 ? indiceUltimo : undefined}
        render={(f) =>
          f.tipo === "marca" ? (
            <div style={{ padding: "16px 14px 4px", color: C.indigo, fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.marca}</div>
          ) : (
            <FilaArticulo a={f.a} activo={f.id === ultimo} onClick={() => navigate(`/articulos/${f.id}?rec=${encodeURIComponent(rec || "")}`)} />
          )
        }
      />
    </Marco>
  )
}

function leerPos(): { id: string } | null {
  try {
    const pos = localStorage.getItem(POS_KEY)
    const m = pos ? /^\/articulos\/([^/?]+)/.exec(pos) : null
    return m && m[1] !== "lista" ? { id: m[1]! } : null
  } catch {
    return null
  }
}

// ─── /articulos/:id — editor (stock + datos) ─────────────────────────────────

export function ArticuloEditor() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const rec = sp.get("rec")
  const navigate = useNavigate()
  const volver = useVolver()
  const encolar = useEncolar()
  const { indice, cargando } = useArticulos()
  const vista = useVistaArticulos()
  const { tiposBulto, tiposFraccion } = useCatalogos()
  const { recorrido, lista } = useRecorrido(rec)
  const { toast, mostrar } = useToast()
  const hojaInexistente = useOverlay("inexistente")
  const [seccion, setSeccion] = useParamEstado("tab", recorrido?.tipo === "sincodigo" ? "datos" : "stock")

  const base = id ? indice.porId.get(id) : undefined
  const art = useMemo(() => (base ? vista(base) : null), [base, vista])

  // ── Formulario (se re-inicializa al cambiar de artículo) ──
  const [tipo, setTipo] = useState<OpStock["tipo"]>("correccion")
  const [cantidad, setCantidad] = useState("")
  const [motivo, setMotivo] = useState("")
  const [msgStock, setMsgStock] = useState<{ ok: boolean; txt: string } | null>(null)
  const [ean13, setEan13] = useState<string[]>([])
  const [eanInput, setEanInput] = useState("")
  const [codigoBulto, setCodigoBulto] = useState("")
  const [unidadesBulto, setUnidadesBulto] = useState("")
  const [unidadMedida, setUnidadMedida] = useState("")
  const [tipoFraccion, setTipoFraccion] = useState("")
  const [cantidadFraccion, setCantidadFraccion] = useState("")
  const [msgDatos, setMsgDatos] = useState<{ ok: boolean; txt: string } | null>(null)
  const cargadoPara = useRef<string | null>(null)
  const siguienteTrasCerrar = useRef<string | null>(null)
  useEffect(() => {
    if (hojaInexistente.abierto || !siguienteTrasCerrar.current) return
    const destino = siguienteTrasCerrar.current
    siguienteTrasCerrar.current = null
    navigate(destino, { replace: true })
  }, [hojaInexistente.abierto, navigate])

  useEffect(() => {
    if (!art || cargadoPara.current === art.id) return
    cargadoPara.current = art.id
    setEan13(eansDe(art)); setEanInput("")
    setCodigoBulto(art.codigo_bulto || "")
    setUnidadesBulto(art.unidades_por_bulto ? String(art.unidades_por_bulto) : "")
    setUnidadMedida(art.unidad_de_medida || "")
    setTipoFraccion(art.tipo_fraccion || "")
    setCantidadFraccion(art.cantidad_fraccion ? String(art.cantidad_fraccion) : "")
    setTipo("correccion"); setCantidad(String(art.stock_actual ?? 0)); setMotivo("")
    setMsgStock(null); setMsgDatos(null)
    // Posición persistente: cerrar la app y volver a entrar retoma acá
    try { localStorage.setItem(POS_KEY, `/articulos/${art.id}${rec ? `?rec=${encodeURIComponent(rec)}` : ""}`) } catch { /* noop */ }
  }, [art, rec])

  if (!art) {
    return (
      <Marco titulo="Modificación de Artículos">
        <div style={{ padding: 24, textAlign: "center", color: C.sub }}>{cargando ? "Cargando..." : "Este artículo no está en el catálogo del equipo (¿se dio de baja?)."}</div>
      </Marco>
    )
  }

  // ── Datos: solo viajan los campos que cambiaron, con su valor anterior (compare-and-set) ──
  const cambiosDatos = (): OpDatos["cambios"] => {
    const c: OpDatos["cambios"] = {}
    const eanAntes = eansDe(art)
    if ([...ean13].sort().join("|") !== [...eanAntes].sort().join("|")) c.ean13 = { antes: eanAntes.length ? eanAntes : null, despues: ean13.length ? ean13 : null }
    const cmp = (campo: string, antes: unknown, despues: unknown) => { if (String(antes ?? "") !== String(despues ?? "")) c[campo] = { antes: antes ?? null, despues: despues ?? null } }
    cmp("codigo_bulto", art.codigo_bulto || null, codigoBulto.trim() ? padEan13(codigoBulto.trim()) : null)
    cmp("unidades_por_bulto", art.unidades_por_bulto ?? null, unidadesBulto ? parseInt(unidadesBulto) : art.unidades_por_bulto ?? null)
    cmp("unidad_de_medida", art.unidad_de_medida || null, unidadMedida || null)
    cmp("tipo_fraccion", art.tipo_fraccion || null, tipoFraccion || null)
    cmp("cantidad_fraccion", art.cantidad_fraccion ?? null, cantidadFraccion ? parseInt(cantidadFraccion) : null)
    return c
  }
  const guardarDatos = async (silencioso = false) => {
    const cambios = cambiosDatos()
    if (Object.keys(cambios).length === 0) { if (!silencioso) setMsgDatos({ ok: true, txt: "Sin cambios para guardar" }); return }
    await encolar<OpDatos>("articulo.datos", { articulo_id: art.id, cambios }, `Datos de ${art.descripcion}`)
    if (!silencioso) setMsgDatos({ ok: true, txt: "✓ Datos guardados" })
  }

  const idx = lista.findIndex((a) => a.id === art.id)
  const irAdyacente = async (dir: 1 | -1) => {
    await guardarDatos(true) // autosave antes de movernos (como la web)
    // Si el artículo ya salió del recorrido (se le asignó EAN / fue a INEXISTENTE), el vecino se busca por posición de orden
    const cmp = recorrido?.tipo === "sincodigo" ? cmpSinCodigo : cmpOrdenDeposito
    const destino = idx >= 0 ? lista[idx + dir] : dir === 1 ? lista.find((a) => cmp(a, art) > 0) : [...lista].reverse().find((a) => cmp(a, art) < 0)
    if (!destino) { mostrar(dir === 1 ? "Es el último artículo del recorrido" : "Es el primero del recorrido", "err"); return }
    navigate(`/articulos/${destino.id}?rec=${encodeURIComponent(rec || "")}${seccion !== "stock" ? `&tab=${seccion}` : ""}`, { replace: true, state: { ultimo: destino.id } })
  }
  const salir = async () => { await guardarDatos(true); volver() }

  const aplicarStock = async () => {
    if (!cantidad) { setMsgStock({ ok: false, txt: "Ingresá una cantidad" }); return }
    const c = parseFloat(cantidad) || 0
    const visto = art.stock_actual ?? 0
    const nuevo = tipo === "correccion" ? c : tipo === "entrada" ? visto + c : visto - c
    await encolar<OpStock>("stock.ajustar", { articulo_id: art.id, tipo, cantidad: c, motivo: motivo || null, stock_visto: visto }, `Stock de ${art.descripcion}: ${tipo === "correccion" ? `= ${c}` : tipo === "entrada" ? `+${c}` : `−${c}`}`)
    setCantidad(tipo === "correccion" ? String(nuevo) : ""); setMotivo("")
    setMsgStock({ ok: true, txt: `✓ Stock: ${nuevo} ${art.unidad_de_medida || "UN"}` })
  }
  const stockResultante = () => {
    if (!cantidad) return null
    const c = parseFloat(cantidad) || 0, s = art.stock_actual ?? 0
    return tipo === "correccion" ? c : tipo === "entrada" ? s + c : s - c
  }

  const agregarEan = (raw0: string): boolean => {
    const raw = raw0.trim()
    if (!raw) return false
    if (esQrOUrl(raw)) { lecturaError(); mostrar("QR ignorado — escaneá el código de barras", "err"); return false }
    const v = padEan13(raw)
    if (!ean13.includes(v)) setEan13((p) => [...p, v])
    return true
  }

  const mandarAInexistente = async () => {
    await encolar("articulo.inexistente", { articulo_id: art.id }, `${art.descripcion} → proveedor INEXISTENTE`)
    mostrar("Enviado a INEXISTENTE")
    const sig = recorrido && idx >= 0 ? lista[idx + 1] : undefined
    if (!sig) { volver(2); return } // hoja + editor ⇒ vuelve a la lista / búsqueda
    // La hoja es una entrada de historial: primero se cierra y recién ahí el editor
    // se reemplaza por el artículo siguiente (no queda el descartado en el historial)
    siguienteTrasCerrar.current = `/articulos/${sig.id}?rec=${encodeURIComponent(rec || "")}&tab=datos`
    hojaInexistente.cerrar()
  }

  const S = {
    card: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 } as CSSProperties,
    label: { color: C.sub, fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "block" } as CSSProperties,
    input: { width: "100%", background: C.white, border: "1px solid #d1d5db", borderRadius: 12, padding: 14, color: C.text, fontSize: 18, outline: "none", boxSizing: "border-box" } as CSSProperties,
    msg: (ok: boolean): CSSProperties => ({ padding: "12px 14px", borderRadius: 12, fontSize: 15, fontWeight: 600, textAlign: "center", background: ok ? "#dcfce7" : "#fee2e2", color: ok ? "#15803d" : "#b91c1c" }),
    guardar: (color: string): CSSProperties => ({ width: "100%", padding: 18, borderRadius: 16, fontWeight: 700, fontSize: 18, border: "none", minHeight: 56, background: color, color: "#fff" }),
    tab: (activo: boolean, color: string): CSSProperties => ({ flex: 1, padding: 16, fontWeight: 700, fontSize: 16, textAlign: "center", minHeight: 52, background: "transparent", border: "none", color: activo ? color : C.light, borderBottom: `3px solid ${activo ? color : "transparent"}` }),
  }
  const colorTipo = tipo === "entrada" ? C.green : tipo === "salida" ? C.red : C.yellow

  return (
    <Marco titulo="Modificación de Artículos" dataset={DATASET}>
      {toast}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 20, lineHeight: 1.3 }}>{art.descripcion}{sufijoMarca(art)}</div>
          <div style={{ color: C.sub, fontSize: 14, marginTop: 3 }}>{lineaInfo(art)}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ background: "#dcfce7", color: "#15803d", borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" }}>Stock: {art.stock_actual ?? 0}</div>
          {art.stockSinEnviar && <div style={{ marginTop: 4 }}><SinEnviar /></div>}
        </div>
        <button onClick={() => void salir()} style={{ background: "#f3f4f6", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", color: "#374151", fontSize: 14, fontWeight: 600, minHeight: 44 }}>{recorrido ? "Volver" : "Cambiar"}</button>
      </div>

      {recorrido && (
        <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => void irAdyacente(-1)} style={{ flex: 1, padding: "14px 0", borderRadius: 12, fontWeight: 700, fontSize: 16, border: "none", minHeight: 48, background: C.indigoL, color: C.indigo }}>← Anterior</button>
          <span style={{ color: C.sub, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", textAlign: "center", minWidth: 80 }}>
            {recorrido.tipo === "sincodigo" ? art.marca || "Sin marca" : `${art.orden_deposito != null ? `#${art.orden_deposito}` : "—"}${lista.length ? ` / ${lista.length}` : ""}`}
          </span>
          <button onClick={() => void irAdyacente(1)} style={{ flex: 1, padding: "14px 0", borderRadius: 12, fontWeight: 700, fontSize: 16, border: "none", minHeight: 48, background: C.indigoL, color: C.indigo }}>Siguiente →</button>
        </div>
      )}

      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.white }}>
        <button style={S.tab(seccion === "stock", C.yellow)} onClick={() => setSeccion("stock")}>Ajustar Stock</button>
        <button style={S.tab(seccion === "datos", "#2563eb")} onClick={() => setSeccion("datos")}>Datos del Artículo</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {seccion === "stock" ? (
          <>
            <div style={S.card}>
              <span style={S.label}>Tipo de movimiento</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {([["entrada", C.green, "📥 Entrada"], ["salida", C.red, "📤 Salida"], ["correccion", C.yellow, "✏️ Corrección"]] as const).map(([t, color, label]) => (
                  <button key={t} onClick={() => { setTipo(t); setCantidad(t === "correccion" ? String(art.stock_actual ?? 0) : "") }} style={{ padding: "14px 6px", borderRadius: 12, fontWeight: 700, fontSize: 15, border: "none", minHeight: 50, background: tipo === t ? color : "#f3f4f6", color: tipo === t ? "#fff" : C.sub }}>{label}</button>
                ))}
              </div>
            </div>
            <div style={S.card}>
              <span style={S.label}>{tipo === "correccion" ? "Nuevo stock (valor final)" : tipo === "entrada" ? "Cantidad a ingresar" : "Cantidad a retirar"}</span>
              <input type="number" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} onFocus={(e) => e.target.select()} style={{ ...S.input, border: "2px solid #d1d5db", borderRadius: 14, padding: 16, fontSize: 32, fontWeight: 700, textAlign: "center" }} />
              {stockResultante() !== null && (
                <div style={{ textAlign: "center", marginTop: 8, fontSize: 15, color: C.sub }}>Stock resultante: <strong style={{ color: (stockResultante() ?? 0) < 0 ? C.red : C.green, fontSize: 20 }}>{stockResultante()}</strong></div>
              )}
            </div>
            <div style={S.card}>
              <span style={S.label}>Motivo (opcional)</span>
              <input style={S.input} type="text" placeholder="Ej: conteo físico, rotura..." value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            {msgStock && <div style={S.msg(msgStock.ok)}>{msgStock.txt}</div>}
            <button style={S.guardar(colorTipo)} onClick={() => void aplicarStock()}>{tipo === "entrada" ? "Registrar Entrada" : tipo === "salida" ? "Registrar Salida" : "Aplicar Corrección"}</button>
          </>
        ) : (
          <>
            <div style={S.card}>
              <span style={S.label}>Código de Bulto</span>
              <input
                style={S.input} type="text" inputMode="numeric" placeholder="Código de barras del bulto/caja..." value={codigoBulto}
                onChange={(e) => setCodigoBulto(e.target.value)}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (!v) return
                  if (esQrOUrl(v)) { lecturaError(); mostrar("QR ignorado — escaneá el código de barras", "err"); setCodigoBulto(""); return }
                  setCodigoBulto(padEan13(v))
                }}
              />
            </div>
            <div style={S.card}>
              <span style={S.label}>EAN 13 <span style={{ color: C.light, fontWeight: 400, textTransform: "none" }}>— puede tener varios</span></span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, background: C.white, border: "1px solid #d1d5db", borderRadius: 12, padding: 12, minHeight: 56 }}>
                {ean13.map((e, i) => (
                  <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f3f4f6", border: `1px solid ${C.border}`, borderRadius: 20, padding: "6px 6px 6px 12px", color: "#374151", fontSize: 16, fontFamily: "monospace" }}>
                    {e}
                    <button type="button" aria-label={`Quitar ${e}`} onClick={() => setEan13((p) => p.filter((_, j) => j !== i))} style={{ color: C.light, background: "none", border: "none", fontSize: 22, lineHeight: 1, minWidth: 32, minHeight: 32 }}>×</button>
                  </span>
                ))}
                <input
                  type="text" inputMode="numeric" value={eanInput} onChange={(e) => setEanInput(e.target.value)}
                  placeholder={ean13.length === 0 ? "Escaneá o escribí un EAN y Enter..." : "Agregar otro..."}
                  style={{ flex: 1, minWidth: 140, background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 16, minHeight: 36 }}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && eanInput.trim()) { e.preventDefault(); agregarEan(eanInput); setEanInput("") } }}
                  onBlur={() => { if (eanInput.trim()) { agregarEan(eanInput); setEanInput("") } }}
                />
              </div>
              <div style={{ color: C.light, fontSize: 13, marginTop: 6 }}>Enter o coma para agregar · × para quitar</div>
            </div>
            <div style={{ ...S.card, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><span style={S.label}>Unid. por bulto</span><input style={S.input} type="number" inputMode="numeric" placeholder="—" value={unidadesBulto} onChange={(e) => setUnidadesBulto(e.target.value)} /></div>
              <div>
                <span style={S.label}>Tipo de bulto</span>
                <select style={S.input} value={unidadMedida} onChange={(e) => setUnidadMedida(e.target.value)}>
                  <option value="">—</option>
                  {opcionesCon(tiposBulto, unidadMedida).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div style={{ ...S.card, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <span style={S.label}>Tipo de fracción</span>
                <select style={S.input} value={tipoFraccion} onChange={(e) => setTipoFraccion(e.target.value)}>
                  <option value="">—</option>
                  {opcionesCon(tiposFraccion, tipoFraccion).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><span style={S.label}>Unidades / fracción</span><input style={S.input} type="number" inputMode="numeric" placeholder="—" value={cantidadFraccion} onChange={(e) => setCantidadFraccion(e.target.value)} /></div>
            </div>
            {art.datosSinEnviar && <div style={{ textAlign: "center" }}><SinEnviar /></div>}
            {msgDatos && <div style={S.msg(msgDatos.ok)}>{msgDatos.txt}</div>}
            <button style={S.guardar("#2563eb")} onClick={() => void guardarDatos()}>Guardar Datos</button>
            <button onClick={hojaInexistente.abrir} style={{ width: "100%", padding: 16, borderRadius: 16, fontWeight: 700, fontSize: 16, minHeight: 52, background: C.white, border: "2px solid #fca5a5", color: C.red }}>🚫 Enviar a INEXISTENTE</button>
            <div style={{ color: C.light, fontSize: 13, textAlign: "center", marginTop: -4 }}>Artículo descartado: pasa al proveedor INEXISTENTE para su futura eliminación</div>
          </>
        )}
      </div>

      <Hoja abierta={hojaInexistente.abierto} onCerrar={hojaInexistente.cerrar} titulo="Enviar a INEXISTENTE">
        <p style={{ fontSize: 16, color: C.text, margin: "0 0 16px", lineHeight: 1.4 }}>¿Enviar <b>"{art.descripcion}"</b> al proveedor INEXISTENTE?</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button onClick={hojaInexistente.cerrar} style={{ background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "16px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>Cancelar</button>
          <button onClick={() => void mandarAInexistente()} style={{ background: C.red, color: "#fff", fontWeight: 800, fontSize: 16, padding: "16px 0", borderRadius: 16, border: "none" }}>🚫 Enviar</button>
        </div>
      </Hoja>
    </Marco>
  )
}
