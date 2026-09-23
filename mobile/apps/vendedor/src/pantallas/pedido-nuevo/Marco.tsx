import { useEffect, useRef, useState } from "react"
import { Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { esQrOUrl, lecturaError, lecturaOk, useLector, useOnline, useRuntime } from "@gm/core"
import { esPedidoEditable } from "@gm/vendedor"
import { SEGS, SEG_LABEL, type Articulo, type BonifSeg, type CondPedido, COND_VACIA } from "../../datasets"
import { nuevoBorrador, type Borrador } from "../../datos/borradores"
import { buscarPorCodigo, eansDe, matchExacto } from "../../datos/busqueda"
import { useCatalogosFicha, useEncolar, usePedidos } from "../../datos/hooks"
import { formatCurrency, useFotoZoom, useToast, ZoomFoto } from "../../ui"
import { ProveedorPedido, usePedidoEnCurso, useVer } from "./contexto"

// Marco de TODAS las pantallas del pedido en curso (/pedido/nuevo/:clienteId/*): el
// borrador, el motor de precios y las hojas que en la web se abrían desde cualquier
// nivel del catálogo (ficha del artículo, panel del cliente, foto, buscar por foto).
// Cada hoja es una entrada de historial (?ver= / ?foto=): atrás la cierra y el
// pedido sigue donde estaba.

export function MarcoPedido() {
  const { clienteId } = useParams()
  if (!clienteId) return null
  return (
    <ProveedorPedido clienteId={clienteId}>
      <Contenido />
    </ProveedorPedido>
  )
}

function Contenido() {
  const p = usePedidoEnCurso()
  const navigate = useNavigate()
  const location = useLocation()
  const { ver, abrir, cerrar } = useVer()
  const foto = useFotoZoom()
  const { toast, mostrar } = useToast()
  useRetomarPedido()

  const enCarrito = location.pathname.endsWith("/carrito") || location.pathname.endsWith("/listo")
  const articuloId = ver?.startsWith("articulo:") ? ver.slice(9) : null
  const articulo = articuloId ? p.indice.porId.get(articuloId) ?? null : null

  // Lector (colectora): un código con coincidencia 1 a 1 abre la ficha del artículo
  // directo; si no, queda en el buscador del catálogo con los resultados.
  useLector({
    ignorarConInputEnfocado: true,
    onCodigo: (codigo) => {
      if (enCarrito) return
      if (esQrOUrl(codigo)) { lecturaError(); mostrar("QR ignorado — escaneá el código de barras", "err"); return }
      const arts = buscarPorCodigo(p.indice, codigo)
      const exacto = arts.find((a) => matchExacto(a, codigo)) || (arts.length === 1 ? arts[0] : null)
      if (exacto) {
        lecturaOk()
        abrir(`articulo:${exacto.id}`, { replace: !!articuloId })
      } else {
        lecturaError()
        navigate(`/pedido/nuevo/${p.clienteId}?q=${encodeURIComponent(codigo)}`)
      }
    },
  })

  return (
    <>
      <Outlet />
      {toast}

      {/* Barra del carrito (igual que la web: visible en todo el catálogo mientras haya ítems) */}
      {p.lineas.length > 0 && !enCarrito && !articulo && ver !== "cliente" && (
        <div className="fixed inset-x-0 bottom-0 z-20 p-3">
          <button onClick={() => navigate(`/pedido/nuevo/${p.clienteId}/carrito`)} className="mx-auto flex w-full max-w-2xl items-center justify-between rounded-2xl bg-emerald-700 px-5 py-4 text-white shadow-lg">
            <span className="font-bold">🛒 {p.totalItems} ítems</span>
            <span className="text-xl font-bold">{formatCurrency(p.total)}</span>
            <span className="font-medium">Ver pedido →</span>
          </button>
        </div>
      )}

      {articulo && <HojaArticulo a={articulo} onCerrar={cerrar} onZoom={() => foto.abrir(articulo.imagen_url)} onAgregado={() => mostrar("Agregado al pedido")} />}
      {ver === "cliente" && <PanelCliente onCerrar={cerrar} />}
      {ver === "buscar-foto" && <BuscarPorFoto onCerrar={cerrar} onElegir={(a) => abrir(`articulo:${a.id}`, { replace: true })} />}
      {foto.src && <ZoomFoto src={foto.src} onCerrar={foto.cerrar} />}
    </>
  )
}

/**
 * Retomar un pedido que ya está en el servidor (?pedido=<id> desde "Mis pedidos" / el
 * detalle), o —igual que la web— el "en_venta" abierto del cliente en vez de duplicarlo.
 * Si ya hay un borrador con ítems para este cliente, el borrador manda.
 */
function useRetomarPedido() {
  const p = usePedidoEnCurso()
  const [sp, setSp] = useSearchParams()
  const pedidoParam = sp.get("pedido")
  const { pedidos, cargando } = usePedidos()
  const hecho = useRef(false)
  useEffect(() => {
    if (hecho.current || cargando || !p.cliente) return
    const candidato = pedidoParam
      ? pedidos.find((x) => x.id === pedidoParam)
      : pedidos.find((x) => x.fila && x.estado === "en_venta" && x.cliente?.id === p.clienteId)
    hecho.current = true
    if (pedidoParam) setSp((prev) => { const n = new URLSearchParams(prev); n.delete("pedido"); return n }, { replace: true })
    const fila = candidato?.fila
    if (!fila || !esPedidoEditable(fila.pedido.estado)) return
    if (p.borrador && (p.borrador.items.length > 0 || p.borrador.pedidoId === fila.id)) return
    // Si hay cambios de este pedido sin enviar, se parte de ellos (son el estado más nuevo)
    const pend = candidato.cambios && candidato.cambios.estado !== "rechazado" ? candidato.cambios.payload : null
    p.cargarBorrador(borradorDePedido(p.clienteId, p.cliente.nombre, fila.id, fila.pedido.numero_pedido, fila.pedido.estado, pend
      ? { items: pend.items.map((i) => ({ articuloId: i.articulo_id, cantidad: i.cantidad, detalleId: i.detalle_id ?? null, art: { descripcion: i.descripcion || "Artículo", sku: i.sku ?? null, unidades_por_bulto: i.unidades_por_bulto ?? null, imagen_url: i.imagen_url ?? null } })),
          cond: { metodo: pend.cond?.metodo_facturacion_pedido || "", lista: pend.cond?.lista_precio_pedido_id || "", bonif: pend.cond?.bonif_pedido ?? null }, obs: pend.observaciones || "" }
      : {
          items: fila.pedido.pedidos_detalle.filter((d) => !d.es_bonificado).map((d) => ({
            articuloId: d.articulo_id, cantidad: Number(d.cantidad), detalleId: d.id,
            // en_venta se re-precia SIEMPRE al confirmar (igual que la web): ahí manda el motor
            precioFijo: fila.pedido.estado === "en_venta" ? null : { precio: Number(d.precio_final), precioNeto: Number(d.precio_base) },
            art: { descripcion: d.articulos?.descripcion || "Artículo", sku: d.articulos?.sku ?? null, unidades_por_bulto: d.articulos?.unidades_por_bulto ?? null, imagen_url: d.articulos?.imagen_url ?? null },
          })),
          cond: {
            metodo: fila.pedido.metodo_facturacion_pedido || "", lista: fila.pedido.lista_precio_pedido_id || "",
            bonif: fila.pedido.bonif_pedido && typeof fila.pedido.bonif_pedido === "object" ? { viajante: fila.pedido.bonif_pedido.viajante ?? undefined, mercaderia: fila.pedido.bonif_pedido.mercaderia ?? undefined } : null,
          },
          obs: fila.pedido.observaciones || "",
        }))
  }, [cargando, pedidos, pedidoParam, p, setSp])
}

export function borradorDePedido(clienteId: string, clienteNombre: string, pedidoId: string, numero: string | null, estado: string, datos: Pick<Borrador, "items" | "cond" | "obs">): Borrador {
  return nuevoBorrador(clienteId, clienteNombre, { pedidoId, numeroPedido: numero, estadoPedido: estado, condOriginal: estado === "en_venta" ? null : datos.cond, ...datos })
}

// ─── Ficha del artículo (?ver=articulo:<id>) ─────────────────────────────────

function HojaArticulo({ a, onCerrar, onZoom, onAgregado }: { a: Articulo; onCerrar: () => void; onZoom: () => void; onAgregado: () => void }) {
  const p = usePedidoEnCurso()
  const habitual = useHabitual(a.id)
  // Cantidad en el modo elegido; arranca vacía (en habituales precarga la última cantidad)
  const [cantidad, setCantidad] = useState<number | "">(habitual || "")
  const [modo, setModo] = useState<"unidad" | "fraccion" | "bulto">("unidad")
  useEffect(() => { if (habitual) setCantidad((c) => (c === "" ? habitual : c)) }, [habitual])
  const precio = p.motor.precio(a.id)

  const labelFraccion = () => {
    const t = (a.tipo_fraccion || "").trim().toUpperCase()
    return t && !["UN", "UNIDAD", "UNIDADES"].includes(t) ? t.charAt(0) + t.slice(1).toLowerCase() : "Fracción"
  }
  const factor = modo === "bulto" ? a.unidades_por_bulto || 1 : modo === "fraccion" ? a.cantidad_fraccion || 1 : 1
  const unidades = (typeof cantidad === "number" ? cantidad : 0) * factor
  const modos: Array<{ key: "unidad" | "fraccion" | "bulto"; label: string }> = [{ key: "unidad", label: "Unidades" }]
  if ((a.cantidad_fraccion || 0) > 1) modos.push({ key: "fraccion", label: `${labelFraccion()} ×${a.cantidad_fraccion}` })
  if ((a.unidades_por_bulto || 0) > 1) modos.push({ key: "bulto", label: `Bulto ×${a.unidades_por_bulto}` })

  const agregar = () => {
    if (!precio || unidades <= 0) return
    if (p.agregar(a, unidades)) { onAgregado(); onCerrar() }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onCerrar}>
      <div className="mx-auto max-h-[92dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        {a.imagen_url && (
          <button onClick={onZoom} className="relative -mt-1 h-48 w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 active:opacity-90">
            <img src={a.imagen_url} alt={a.descripcion} className="h-full w-full object-contain" />
            <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-bold text-white">🔍 Zoom</span>
          </button>
        )}
        <div className="min-w-0">
          <p className="text-lg font-bold leading-snug text-gray-900">{a.descripcion}</p>
          <p className="mt-1 text-sm text-gray-500">{[a.marca, a.proveedor].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
          {a.sku && <span>SKU {a.sku}</span>}
          {eansDe(a).length > 0 && <span>EAN {eansDe(a).join(", ")}</span>}
          {a.unidades_por_bulto ? <span>{a.unidades_por_bulto} u/bulto</span> : null}
          {(a.cantidad_fraccion || 0) > 1 ? <span>{labelFraccion()} ×{a.cantidad_fraccion}</span> : null}
          <span className={a.stock_disponible > 0 ? "font-medium text-green-600" : "font-medium text-red-600"}>Stock: {a.stock_disponible}</span>
          {a.descuento_propio > 0 && !precio?.especial && <span className="rounded bg-ambar-400 px-1.5 font-bold text-azul-900">Oferta -{a.descuento_propio}%</span>}
        </div>

        <div className="rounded-xl bg-gray-50 p-4 text-center">
          {precio ? (
            precio.especial ? (
              <>
                <span className="mb-1 inline-block rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-700">LISTA ESPECIAL</span>
                {precio.especial.oferta_pct > 0 && (
                  <p className="text-sm text-gray-400"><span className="line-through">{formatCurrency(precio.especial.bruto)}</span> <span className="rounded bg-ambar-400 px-1.5 font-bold text-azul-900">-{precio.especial.oferta_pct}%</span></p>
                )}
                <p className="text-3xl font-bold text-gray-900">{formatCurrency(precio.precioNeto)}<span className="text-sm font-medium text-gray-400"> neto</span></p>
                <p className="mt-1 text-sm text-gray-500">+ 21% IVA = {formatCurrency(precio.precio)} · sin precio contado</p>
              </>
            ) : (
              <>
                <p className="text-3xl font-bold text-gray-900">{formatCurrency(precio.precio)}<span className="text-sm font-medium text-gray-400"> cta cte</span></p>
                <p className="mt-0.5 font-bold text-emerald-700">{formatCurrency(precio.contado)} <span className="text-xs font-medium">contado (-10%)</span></p>
                {Math.abs(precio.precio - precio.precioNeto) > 0.01
                  ? <p className="mt-1 text-sm text-gray-500">Neto {formatCurrency(precio.precioNeto)} + IVA {formatCurrency(precio.precio - precio.precioNeto)}</p>
                  : <p className="mt-1 text-sm text-gray-500">Sin IVA incluido</p>}
                {(precio.bonifViajantePct || 0) > 0 && <p className="mt-1 text-xs font-bold text-sky-700">Incluye bonificación viajante −{precio.bonifViajantePct}% de este cliente</p>}
              </>
            )
          ) : (
            <p className="text-red-500">{p.motor.sinDatos ? "Todavía no se descargaron los precios en este equipo" : "No se pudo calcular el precio"}</p>
          )}
        </div>

        {modos.length > 1 && (
          <div className="flex gap-2">
            {modos.map((m) => (
              <button key={m.key} onClick={() => setModo(m.key)} className={`min-h-11 flex-1 rounded-xl border py-2.5 text-sm font-bold ${modo === m.key ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 bg-white text-gray-600"}`}>{m.label}</button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setCantidad((c) => Math.max(0, (typeof c === "number" ? c : 0) - 1) || "")} className="h-14 w-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700">−</button>
          <input
            type="number" inputMode="numeric" min={0} value={cantidad} placeholder="0"
            onChange={(e) => { const v = parseInt(e.target.value); setCantidad(Number.isFinite(v) && v > 0 ? v : "") }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar() } }}
            className="h-14 w-24 rounded-xl border border-gray-300 text-center text-2xl font-bold placeholder:text-gray-300"
          />
          <button onClick={() => setCantidad((c) => (typeof c === "number" ? c : 0) + 1)} className="h-14 w-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700">+</button>
        </div>

        {modo !== "unidad" && unidades > 0 && <p className="-mt-2 text-center text-sm text-gray-500">= <span className="font-bold text-gray-800">{unidades}</span> unidades</p>}
        {precio && unidades > 0 && <p className="text-center text-gray-500">Subtotal: <span className="font-bold text-gray-900">{formatCurrency(precio.precio * unidades)}</span></p>}
        {p.enCarrito(a.id) ? <p className="text-center text-sm font-medium text-emerald-700">Ya tenés {p.enCarrito(a.id)} u en el pedido: lo que agregues se suma.</p> : null}

        <button onClick={agregar} disabled={!precio || precio.precio <= 0 || unidades <= 0} className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:bg-gray-300">
          {unidades > 0 ? "Agregar al pedido" : "Ingresá la cantidad"}
        </button>
      </div>
    </div>
  )
}

/** Última cantidad pedida de un artículo habitual del cliente (precarga de la ficha). */
function useHabitual(articuloId: string): number | null {
  const p = usePedidoEnCurso()
  const { replica } = useRuntime()
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    let vivo = true
    void replica.una<{ habituales?: Array<{ articulo_id: string; cantidad_habitual: number }> }>("vendedor_cc", p.clienteId).then((cc) => {
      if (vivo) setN(cc?.habituales?.find((h) => h.articulo_id === articuloId)?.cantidad_habitual ?? null)
    })
    return () => { vivo = false }
  }, [replica, p.clienteId, articuloId])
  return n
}

// ─── Panel del cliente: condiciones del pedido (?ver=cliente) ────────────────

const bonifVacia = (b: CondPedido["bonif"]) => !b || ((!b.viajante || !Object.keys(b.viajante).length) && (!b.mercaderia || !Object.keys(b.mercaderia).length))
export const fmtSeg = (s: BonifSeg | null | undefined) => {
  if (!s) return "—"
  const v = SEGS.map((k) => s[k] ?? 0)
  if (v.every((x) => x === v[0])) return v[0] ? `${v[0]}%` : "0%"
  return `L/B ${v[0]}% · P0 ${v[1]}% · P+ ${v[2]}%`
}

function PanelCliente({ onCerrar }: { onCerrar: () => void }) {
  const p = usePedidoEnCurso()
  const navigate = useNavigate()
  const encolar = useEncolar()
  const catFicha = useCatalogosFicha()
  const cliente = p.cliente
  const cond = p.cond
  const bonifCliente = cliente?.bonificaciones ?? null

  const [metodoSel, setMetodoSel] = useState(cond.metodo || cliente?.metodo_facturacion || "")
  const [listaSel, setListaSel] = useState(cond.lista || cliente?.lista_precio_id || "")
  const [bonifSel, setBonifSel] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const tipo of ["viajante", "mercaderia"] as const)
      for (const s of SEGS) {
        const v = cond.bonif?.[tipo]?.[s] ?? bonifCliente?.[tipo]?.[s] ?? 0
        init[`${tipo}.${s}`] = v ? String(v) : ""
      }
    return init
  })
  if (!cliente) return null

  // Lista impuesta por el viajante del cliente: no se guarda en ficha; sí se puede pisar "solo este pedido" con permiso
  const listaImpuesta = catFicha?.vendedores.find((v) => v.id === cliente.vendedor_id)?.lista_nombre || null
  const puedeLista = !!catFicha?.puede_cambiar_lista
  const listaNombre = (id: string | null | undefined) => catFicha?.listas_precio.find((l) => l.id === id)?.nombre || null
  const listaClienteNombre = cliente.lista?.nombre || listaNombre(cliente.lista_precio_id) || "Estándar"
  const parsePct = (s: string | undefined) => {
    const t = (s ?? "").trim()
    if (t === "") return 0
    const n = Number(t.replace(",", "."))
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : NaN
  }
  const bonifParsed: { viajante: BonifSeg; mercaderia: BonifSeg } = { viajante: {}, mercaderia: {} }
  let bonifValida = true
  for (const tipo of ["viajante", "mercaderia"] as const)
    for (const s of SEGS) {
      const n = parsePct(bonifSel[`${tipo}.${s}`])
      if (Number.isNaN(n)) bonifValida = false
      else bonifParsed[tipo][s] = n
    }
  const fichaViaj = fmtSeg(bonifCliente?.viajante)
  const fichaMerc = fmtSeg(bonifCliente?.mercaderia)
  // Lo que coincide con la ficha NO se guarda como override (queda "hereda de la ficha")
  const fichaMetodo = cliente.metodo_facturacion || ""
  const fichaLista = cliente.lista_precio_id || ""
  const bonifIgualFicha = (["viajante", "mercaderia"] as const).every((t) => SEGS.every((s) => (bonifParsed[t][s] ?? 0) === (bonifCliente?.[t]?.[s] ?? 0)))
  const nuevaCond: CondPedido = {
    metodo: metodoSel && metodoSel !== fichaMetodo ? metodoSel : "",
    lista: puedeLista ? (listaSel && listaSel !== fichaLista ? listaSel : "") : cond.lista,
    bonif: bonifIgualFicha ? null : bonifParsed,
  }
  const hayCambios = JSON.stringify(nuevaCond) !== JSON.stringify({ ...cond, bonif: bonifVacia(cond.bonif) ? null : cond.bonif })
  const hayOverride = !!cond.metodo || !!cond.lista || !bonifVacia(cond.bonif)
  const selCls = "w-full rounded-xl border border-gray-300 px-4 py-3 bg-white"

  // "Guardar en la ficha": escribe la FICHA (queda para futuros pedidos). Sin señal la
  // ficha se actualiza cuando la operación se envíe; para que ESTE pedido ya salga con
  // esas condiciones (y el servidor calcule lo mismo que se ve acá) quedan además como
  // condiciones del pedido. Ver MOBILE.md → Vendedor → "Guardar en la ficha".
  const guardarEnFicha = async () => {
    if (!bonifValida) return
    const cambios: Record<string, { antes: unknown; despues: unknown }> = {}
    if (metodoSel && metodoSel !== fichaMetodo) cambios.metodo_facturacion = { antes: cliente.metodo_facturacion ?? null, despues: metodoSel }
    if (puedeLista && !listaImpuesta && (listaSel || "") !== fichaLista) cambios.lista_precio_id = { antes: cliente.lista_precio_id ?? null, despues: listaSel || null }
    if (Object.keys(cambios).length) await encolar("cliente.editar", { cliente_id: cliente.id, cambios }, `Ficha de ${cliente.nombre}`)
    if (!bonifIgualFicha) {
      const body: { viajante: BonifSeg; mercaderia: BonifSeg } = { viajante: {}, mercaderia: {} }
      for (const tipo of ["viajante", "mercaderia"] as const) for (const s of SEGS) body[tipo][s] = bonifParsed[tipo][s] ?? 0
      await encolar("cliente.bonificaciones", { cliente_id: cliente.id, ...body }, `Bonificaciones de ${cliente.nombre}`)
    }
    p.setCond(nuevaCond)
    onCerrar()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onCerrar}>
      <div className="mx-auto w-full max-w-2xl space-y-4 rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-lg font-bold leading-snug text-gray-900">{cliente.nombre}</p>
          <p className="text-sm text-gray-500">
            {cliente.localidad || ""}
            {cliente.saldo_actual > 0 ? <span className="font-bold text-red-600"> · debe {formatCurrency(cliente.saldo_actual)}</span> : null}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate(`/clientes/${cliente.id}`, { replace: true })} className="rounded-xl border-2 border-emerald-600 bg-white py-3 text-center font-bold text-emerald-700">👤 Ficha del cliente</button>
          <button onClick={() => navigate(`/clientes/${cliente.id}/cobrar`, { replace: true })} className="rounded-xl bg-emerald-600 py-3 text-center font-bold text-white">💵 Cuenta corriente</button>
        </div>

        <div className="-mx-1 max-h-[56dvh] space-y-3 overflow-y-auto px-1">
          <div className="space-y-3 rounded-xl bg-gray-50 p-4">
            <div>
              <p className="text-sm font-bold text-gray-700">Método de facturación</p>
              <p className="text-xs text-gray-400">Actual: {cond.metodo ? `${cond.metodo} (solo este pedido)` : cliente.metodo_facturacion || "—"}</p>
            </div>
            <select value={metodoSel} onChange={(e) => setMetodoSel(e.target.value)} className={selCls}>
              <option value="">Elegir método...</option>
              <option value="Factura">Factura{fichaMetodo === "Factura" ? " (ficha)" : ""}</option>
              <option value="Final">Final (Mixto){fichaMetodo === "Final" ? " (ficha)" : ""}</option>
              <option value="Presupuesto">Presupuesto{fichaMetodo === "Presupuesto" ? " (ficha)" : ""}</option>
            </select>
          </div>

          <div className="space-y-3 rounded-xl bg-gray-50 p-4">
            <div>
              <p className="text-sm font-bold text-gray-700">Lista de precios</p>
              <p className="text-xs text-gray-400">Actual: {cond.lista ? `${listaNombre(cond.lista) || "—"} (solo este pedido)` : listaClienteNombre}{listaImpuesta && !cond.lista ? " (por viajante)" : ""}</p>
            </div>
            {puedeLista ? (
              <>
                <select value={listaSel} onChange={(e) => setListaSel(e.target.value)} className={selCls}>
                  <option value="">Estándar (sin lista)</option>
                  {(catFicha?.listas_precio || []).map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.id === fichaLista ? " (ficha)" : ""}</option>)}
                </select>
                {listaImpuesta && <p className="text-xs text-gray-400">La ficha lleva lista <b>{listaImpuesta}</b> por el viajante asignado; para cambiarla de forma permanente, reasigná el viajante desde la ficha.</p>}
              </>
            ) : (
              <p className="text-xs text-gray-400">No tenés permiso para cambiar la lista de precios.</p>
            )}
          </div>

          <div className="space-y-3 rounded-xl bg-gray-50 p-4">
            <div>
              <p className="text-sm font-bold text-gray-700">Descuentos por segmento</p>
              <p className="text-xs text-gray-400">
                {!bonifVacia(cond.bonif)
                  ? <>Solo este pedido · viajante {fmtSeg(cond.bonif?.viajante ?? bonifCliente?.viajante)} · mercadería {fmtSeg(cond.bonif?.mercaderia ?? bonifCliente?.mercaderia)}</>
                  : <>Ficha · viajante {fichaViaj} · mercadería {fichaMerc}</>}
              </p>
            </div>
            <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
              <span>Segmento</span><span className="text-center text-orange-600">Viajante</span><span className="text-center text-green-700">Mercad.</span>
            </div>
            {SEGS.map((s) => (
              <div key={s} className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2">
                <span className="text-sm text-gray-700">{SEG_LABEL[s]}</span>
                {(["viajante", "mercaderia"] as const).map((tipo) => (
                  <div key={tipo} className="relative">
                    <input
                      value={bonifSel[`${tipo}.${s}`] ?? ""}
                      onChange={(e) => { const v = e.target.value.replace(/[^\d.,]/g, ""); setBonifSel((prev) => ({ ...prev, [`${tipo}.${s}`]: v })) }}
                      inputMode="decimal" placeholder="0"
                      className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-2 pr-6 text-right font-bold"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                  </div>
                ))}
              </div>
            ))}
            <button
              onClick={() => setBonifSel((prev) => { const n = { ...prev }; for (const tipo of ["viajante", "mercaderia"] as const) for (const s of SEGS) n[`${tipo}.${s}`] = prev[`${tipo}.limpieza_bazar`] ?? ""; return n })}
              className="min-h-11 text-xs font-bold text-emerald-700"
            >
              ⤓ Mismo % en los tres segmentos (copia la fila Limpieza / Bazar)
            </button>
            <p className="text-xs text-gray-400">
              <b>Viajante</b>: descuento sobre el neto de cada línea del segmento; sale de tu comisión y ya se ve en el precio.{" "}
              <b>Mercadería</b>: % del neto del segmento que se entrega en mercadería sin cargo (la arma depósito/ERP; no cambia precios). Ficha: viajante {fichaViaj} · mercadería {fichaMerc}.
            </p>
          </div>

          <div className="sticky bottom-0 space-y-2 border-t border-gray-100 bg-white pb-1 pt-2">
            {!bonifValida && <p className="text-xs font-medium text-red-600">Revisá los porcentajes: hay un valor inválido.</p>}
            <button onClick={() => { if (!bonifValida || !hayCambios) return; p.setCond(nuevaCond); onCerrar() }} disabled={!bonifValida || !hayCambios} className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white disabled:opacity-40">✅ Aplicar a este pedido</button>
            <p className="text-center text-[11px] text-gray-400">Guarda método, lista y descuentos juntos y recalcula al instante todos los precios (de ahí sale la factura). Lo que coincide con la ficha no queda como "solo este pedido".</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => void guardarEnFicha()} disabled={!bonifValida} className="rounded-xl bg-gray-900 py-3 text-sm font-bold text-white disabled:opacity-40">Guardar en la ficha del cliente</button>
              <button onClick={() => { p.setCond(COND_VACIA); onCerrar() }} disabled={!hayOverride} className="rounded-xl border border-gray-300 bg-white py-3 text-sm font-bold text-gray-700 disabled:opacity-40">↩ Volver a lo del cliente</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Buscar con la cámara (?ver=buscar-foto) ─────────────────────────────────
// El código de barras se lee EN el equipo (BarcodeDetector) y se busca en el catálogo
// local: funciona sin señal. Identificar el producto por la FOTO usa IA en el servidor:
// online-only.

async function comprimirImagen(file: File): Promise<{ blob: Blob; bitmap: ImageBitmap }> {
  const bitmap = await createImageBitmap(file)
  const escala = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b as Blob), "image/jpeg", 0.85))
  return { blob, bitmap }
}
async function detectarCodigoBarras(bitmap: ImageBitmap): Promise<string | null> {
  try {
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(b: ImageBitmap): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
    if (!BD) return null
    const codigos = await new BD({ formats: ["ean_13", "ean_8", "upc_a", "code_128"] }).detect(bitmap)
    return codigos?.[0]?.rawValue || null
  } catch {
    return null
  }
}

function BuscarPorFoto({ onCerrar, onElegir }: { onCerrar: () => void; onElegir: (a: Articulo) => void }) {
  const p = usePedidoEnCurso()
  const { api } = useRuntime()
  const online = useOnline()
  const camaraRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)
  const [estado, setEstado] = useState<"inicio" | "analizando" | "resultados">("inicio")
  const [preview, setPreview] = useState<string | null>(null)
  const [deteccion, setDeteccion] = useState<string | null>(null)
  const [porEan, setPorEan] = useState(false)
  const [sugerencias, setSugerencias] = useState<Articulo[]>([])
  const [error, setError] = useState<string | null>(null)

  const elegir = (a: Articulo) => {
    // Aprendizaje (igual que la web): la detección por FOTO queda como alias del artículo
    if (deteccion && !porEan && online) void api.post("/api/vendedor/buscar-foto/confirmar", { articulo_id: a.id, descripcion_detectada: deteccion }).catch(() => {})
    onElegir(a)
  }

  const procesar = async (file: File | null | undefined) => {
    if (!file) return
    setError(null)
    setEstado("analizando")
    setPreview(URL.createObjectURL(file))
    try {
      const { blob, bitmap } = await comprimirImagen(file)
      const ean = await detectarCodigoBarras(bitmap)
      if (ean) {
        // Código legible: se resuelve contra el catálogo del equipo, con o sin señal
        setDeteccion(`Código ${ean}`)
        setPorEan(true)
        setSugerencias(buscarPorCodigo(p.indice, ean))
        setEstado("resultados")
        return
      }
      if (!online) throw new Error("No se leyó ningún código de barras. Para identificar el producto por la foto necesitás conexión: sacale la foto al código de barras, que funciona sin señal.")
      const fd = new FormData()
      fd.append("image", blob, "producto.jpg")
      const d = await api.postForm<{ descripcion_detectada?: string; ean_detectado?: string; articulos?: Array<{ id: string }> }>("/api/vendedor/buscar-foto", fd, { timeoutMs: 70_000 })
      setDeteccion(d.descripcion_detectada || null)
      setPorEan(Boolean(d.ean_detectado))
      // Se muestran con los datos del catálogo local (mismos artículos, precio del motor)
      setSugerencias((d.articulos || []).map((x) => p.indice.porId.get(x.id)).filter((x): x is Articulo => !!x))
      setEstado("resultados")
    } catch (e) {
      setError((e as Error)?.message || "Error al analizar la foto.")
      setEstado("inicio")
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={onCerrar}>
      <div className="mx-auto max-h-[92dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-lg font-bold text-gray-900">📷 Buscar con la cámara</p>
          <button onClick={onCerrar} className="h-11 w-11 text-2xl leading-none text-gray-400" aria-label="Cerrar">✕</button>
        </div>
        <input ref={camaraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void procesar(e.target.files?.[0]); e.target.value = "" }} />
        <input ref={galeriaRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void procesar(e.target.files?.[0]); e.target.value = "" }} />

        {estado === "inicio" && (
          <>
            <p className="text-sm text-gray-500">Sacale una foto al producto o a su código de barras, o elegí una imagen que te mandaron. El sistema detecta de qué artículo se trata.</p>
            {!online && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Sin red: funciona la foto del <b>código de barras</b>. Identificar el producto por la foto necesita conexión.</p>}
            {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => camaraRef.current?.click()} className="rounded-2xl bg-emerald-600 py-6 text-lg font-bold text-white">📷 Sacar foto</button>
              <button onClick={() => galeriaRef.current?.click()} className="rounded-2xl border-2 border-emerald-600 bg-white py-6 text-lg font-bold text-emerald-700">🖼 Galería</button>
            </div>
          </>
        )}
        {estado === "analizando" && (
          <div className="space-y-4 py-6 text-center">
            {preview && <img src={preview} alt="" className="mx-auto h-40 rounded-xl bg-gray-50 object-contain" />}
            <p className="text-gray-500">Identificando el artículo...</p>
          </div>
        )}
        {estado === "resultados" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {preview && <img src={preview} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-gray-50 object-cover" />}
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Detectado</p>
                <p className="font-bold leading-snug text-gray-900">{deteccion || "Sin identificar"}</p>
              </div>
            </div>
            {sugerencias.length ? (
              <div className="space-y-2">
                {sugerencias.map((a) => (
                  <button key={a.id} onClick={() => elegir(a)} className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left">
                    {a.imagen_url ? <img src={a.imagen_url} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-gray-100 object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-gray-100" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-snug text-gray-900">{a.descripcion}</p>
                      <p className="text-xs text-gray-400">{[a.marca, a.unidades_por_bulto ? `${a.unidades_por_bulto} u/bulto` : null].filter(Boolean).join(" · ")} · Stock: {a.stock_disponible}</p>
                    </div>
                    <span className="shrink-0 text-xl text-emerald-600">›</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-500">
                No se encontraron artículos parecidos en el catálogo.
                <span className="mt-1 block font-medium text-gray-700">👉 Sacale foto al código de barras (atrás del producto): ese match es exacto.</span>
              </p>
            )}
            <button onClick={() => { setEstado("inicio"); setPreview(null); setSugerencias([]); setDeteccion(null) }} className="w-full rounded-xl border border-gray-300 py-3 font-bold text-gray-600">📷 Probar con otra foto</button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Overrides del pedido que viajan al servidor. Lo que coincide con la ficha replicada no es un override. */
export function condParaServidor(cond: CondPedido) {
  const b = cond.bonif
  return {
    metodo_facturacion_pedido: cond.metodo || null,
    lista_precio_pedido_id: cond.lista || null,
    bonif_pedido: bonifVacia(b) ? null : b,
  }
}
