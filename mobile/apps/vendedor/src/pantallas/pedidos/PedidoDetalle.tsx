import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useNoEnviados, useOnline, useOverlay, useRuntime, useSesion } from "@gm/core"
import { esPedidoEditable, ESTADO_LABEL } from "@gm/vendedor"
import { DS, SEG_LABEL, type DetallePedido, type ItemOpPedido, type OpPedido } from "../../datasets"
import { almacenBorradores, nuevoBorrador } from "../../datos/borradores"
import { rechazosDe, useEncolar, usePedido } from "../../datos/hooks"
import { preciosAl } from "../../datos/precios"
import { useVer } from "../pedido-nuevo/contexto"
import { BadgeEstado, fechaCorta, formatCurrency, HojaConfirmar, Pantalla, Rechazos, SinDescargar, SinEnviar, useFotoZoom, useToast, useVolver, Vacio, ZoomFoto } from "../../ui"

// Detalle de un pedido (port de app/vendedor/pedidos/[id]/page.tsx).
//  - Pedido del servidor: cantidades editables con guardado automático. En la web cada
//    cambio era una server action; acá es UNA operación pedido.editar con el estado final
//    de los renglones (la edición pendiente anterior del mismo pedido se reemplaza).
//  - Pedido tomado en este equipo que todavía no salió ("local:<id>"): se ve completo,
//    y se puede EDITAR o descartar hasta que sincroniza.

export function PedidoDetalle() {
  const { id } = useParams()
  const { pedido, cargando } = usePedido(id)
  if (!pedido) return <Pantalla titulo="Pedido">{cargando ? null : id?.startsWith("local:") ? <Vacio icono="✅">Este pedido ya se envió. Buscalo en Mis pedidos.</Vacio> : <SinDescargar que="este pedido" />}</Pantalla>
  return pedido.local ? <PedidoLocal vista={pedido} /> : <PedidoServidor vista={pedido} />
}

type Vista = NonNullable<ReturnType<typeof usePedido>["pedido"]>

// ─── Pedido pendiente de enviar ──────────────────────────────────────────────

function PedidoLocal({ vista }: { vista: Vista }) {
  const local = vista.local!
  const rt = useRuntime()
  const { sesion } = useSesion()
  const navigate = useNavigate()
  const volver = useVolver()
  const descartar = useOverlay("descartar")
  const { toast, mostrar } = useToast()
  const p = local.payload

  const editar = async () => {
    const uid = sesion?.user.id
    if (!uid) return
    // 1º el borrador (durable), 2º se retira la operación: si la app muere en el medio
    // quedan los dos y el servidor los une por local_id — nunca se pierde ni se duplica.
    const almacen = almacenBorradores(rt)
    await almacen.cargar()
    const previo = almacen.de(uid, p.cliente_id)
    if (previo && previo.items.length > 0 && previo.localId !== p.local_id) {
      mostrar(`Ya tenés otro pedido a medio cargar para ${p.vista.cliente_nombre}. Terminalo o descartalo primero.`, "err")
      return
    }
    await almacen.guardar(uid, nuevoBorrador(p.cliente_id, p.vista.cliente_nombre, {
      localId: p.local_id,
      items: p.items.map((i) => ({ articuloId: i.articulo_id, cantidad: i.cantidad, art: { descripcion: i.descripcion || "Artículo", sku: i.sku ?? null, unidades_por_bulto: i.unidades_por_bulto ?? null, imagen_url: i.imagen_url ?? null } })),
      cond: { metodo: p.cond?.metodo_facturacion_pedido || "", lista: p.cond?.lista_precio_pedido_id || "", bonif: p.cond?.bonif_pedido ?? null },
      obs: p.observaciones || "",
    }))
    const retirada = await rt.outbox.retirar(local.opKey)
    if (!retirada) {
      await almacen.descartar(uid, p.cliente_id)
      mostrar("El pedido se está enviando en este momento: ya no se puede editar acá.", "err")
      return
    }
    navigate(`/pedido/nuevo/${p.cliente_id}/carrito`, { replace: true })
  }

  return (
    <Pantalla titulo="Pedido sin enviar">
      {toast}
      <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
        <div className={`rounded-2xl border p-4 ${local.estado === "rechazado" ? "border-red-200 bg-red-50" : "border-lavanda-200 bg-lavanda-50"}`}>
          <div className="flex items-center gap-2">
            <p className="flex-1 font-bold text-gray-900">{p.vista.cliente_nombre}</p>
            <SinEnviar rechazado={local.estado === "rechazado"} texto={local.estado === "enviando" ? "enviando…" : local.estado === "rechazado" ? "no se pudo enviar" : "pendiente de enviar"} />
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {local.estado === "rechazado"
              ? local.error
              : "Está guardado en este equipo y se envía solo apenas haya señal. Todavía no tiene número: se lo da la oficina al recibirlo."}
          </p>
          <p className="mt-1 text-xs text-gray-500">Tomado el {new Date(local.capturadoAt).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
        </div>

        <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          {p.items.map((i) => <RenglonLectura key={i.articulo_id} i={i} />)}
        </div>
        {p.observaciones && <p className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-600">📝 {p.observaciones}</p>}

        <div className="flex items-center justify-between rounded-2xl bg-white p-4 text-lg">
          <span className="text-gray-500">Total</span>
          <span className="text-2xl font-bold text-gray-900">{formatCurrency(p.vista.total)}</span>
        </div>

        {local.estado !== "enviando" && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void editar()} className="min-h-12 rounded-xl bg-emerald-600 font-bold text-white">✏️ Editar</button>
            <button onClick={descartar.abrir} className="min-h-12 rounded-xl border border-red-200 bg-white font-bold text-red-600">Descartar</button>
          </div>
        )}
      </div>
      <HojaConfirmar
        abierta={descartar.abierto} onCerrar={descartar.cerrar} titulo="¿Descartar este pedido?" confirmar="Descartar" peligro
        onConfirmar={() => { void rt.outbox.retirar(local.opKey).then((r) => { if (r) volver(2); else { descartar.cerrar(); mostrar("El pedido se está enviando: ya no se puede descartar acá.", "err") } }) }}
      >
        Todavía no llegó a la oficina: se borra de este equipo y no se envía. No se puede deshacer.
      </HojaConfirmar>
    </Pantalla>
  )
}

function RenglonLectura({ i }: { i: ItemOpPedido }) {
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug text-gray-900">{i.descripcion || "Artículo"}</p>
        <p className="text-xs text-gray-400">{i.sku || "—"}{i.unidades_por_bulto ? ` · x${i.unidades_por_bulto}` : ""}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-gray-400">{i.cantidad} × {formatCurrency(i.precio)}</p>
        <p className="font-bold text-gray-900">{formatCurrency(i.precio * i.cantidad)}</p>
      </div>
    </div>
  )
}

// ─── Pedido del servidor ─────────────────────────────────────────────────────

interface Renglon { detalleId: string; articuloId: string; cantidad: number; d: DetallePedido }

function PedidoServidor({ vista }: { vista: Vista }) {
  const fila = vista.fila!
  const pedido = fila.pedido
  const rt = useRuntime()
  const online = useOnline()
  const navigate = useNavigate()
  const volver = useVolver()
  const encolar = useEncolar()
  const ops = useNoEnviados()
  const foto = useFotoZoom()
  const eliminar = useOverlay("eliminar")
  const ver = useVer()
  const { toast, mostrar } = useToast()
  const editable = esPedidoEditable(pedido.estado) && vista.cambios?.estado !== "enviando"
  const cliente = pedido.clientes

  // Renglones = los del servidor con las cantidades de la edición pendiente (si hay) encima
  const pendiente = vista.cambios && vista.cambios.estado !== "rechazado" ? vista.cambios.payload : null
  const base = useMemo<Renglon[]>(() => {
    const venta = pedido.pedidos_detalle.filter((d) => !d.es_bonificado)
    if (!pendiente) return venta.map((d) => ({ detalleId: d.id, articuloId: d.articulo_id, cantidad: Number(d.cantidad), d }))
    const porDetalle = new Map(pendiente.items.map((i) => [i.detalle_id, i]))
    return venta.filter((d) => porDetalle.has(d.id)).map((d) => ({ detalleId: d.id, articuloId: d.articulo_id, cantidad: Number(porDetalle.get(d.id)!.cantidad), d }))
  }, [pedido.pedidos_detalle, pendiente])
  // Renglones agregados desde el catálogo que todavía no salieron (no tienen renglón en el servidor)
  const nuevos = useMemo(() => (pendiente ? pendiente.items.filter((i) => !i.detalle_id) : []), [pendiente])
  const bonificados = pedido.pedidos_detalle.filter((d) => d.es_bonificado)

  // Edición local con guardado automático (600 ms, igual que la web)
  const [local, setLocal] = useState<Map<string, number> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const renglones = useMemo(() => base.filter((r) => local?.get(r.detalleId) !== 0).map((r) => ({ ...r, cantidad: local?.get(r.detalleId) ?? r.cantidad })), [base, local])
  const total = renglones.reduce((s, r) => s + (Number(r.d.precio_final) || 0) * r.cantidad, 0) + nuevos.reduce((s, i) => s + i.precio * i.cantidad, 0)

  const guardar = async (estado: Map<string, number>) => {
    const items: ItemOpPedido[] = [
      ...base.filter((r) => estado.get(r.detalleId) !== 0).map((r) => ({
        articulo_id: r.articuloId, cantidad: estado.get(r.detalleId) ?? r.cantidad, precio: Number(r.d.precio_final) || 0, detalle_id: r.detalleId, precio_fijo: true,
        precio_neto: Number(r.d.precio_base) || 0, descripcion: r.d.articulos?.descripcion, sku: r.d.articulos?.sku, unidades_por_bulto: r.d.articulos?.unidades_por_bulto, imagen_url: r.d.articulos?.imagen_url,
      })),
      ...nuevos,
    ]
    if (!items.length) { mostrar("Un pedido no puede quedar sin artículos: eliminá el pedido completo.", "err"); setLocal(null); return }
    const payload: OpPedido = {
      local_id: pendiente?.local_id || crypto.randomUUID(),
      pedido_id: pedido.id,
      cliente_id: pedido.cliente_id,
      items,
      cond: { metodo_facturacion_pedido: pedido.metodo_facturacion_pedido, lista_precio_pedido_id: pedido.lista_precio_pedido_id, bonif_pedido: pendiente?.cond?.bonif_pedido ?? (pedido.bonif_pedido ? { viajante: pedido.bonif_pedido.viajante ?? undefined, mercaderia: pedido.bonif_pedido.mercaderia ?? undefined } : null) },
      observaciones: pendiente?.observaciones ?? pedido.observaciones,
      precios_al: preciosAl(rt),
      // Guardar cantidades NO confirma un carrito "en venta" (igual que la web)
      confirmar: pendiente?.confirmar ?? false,
      vista: { cliente_nombre: cliente?.nombre || "", total: Math.round(items.reduce((s, i) => s + i.precio * i.cantidad, 0) * 100) / 100, numero_pedido: pedido.numero_pedido, estado: pedido.estado },
    }
    // La edición pendiente anterior de ESTE pedido se reemplaza: siempre viaja el estado final
    if (vista.cambios && vista.cambios.estado !== "enviando") await rt.outbox.retirar(vista.cambios.opKey)
    await encolar("pedido.editar", payload, `Cambios al pedido ${pedido.numero_pedido ? `Nº ${pedido.numero_pedido}` : ""} · ${cliente?.nombre || ""}`)
    setLocal(null)
  }
  const programar = (estado: Map<string, number>) => {
    setLocal(estado)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void guardar(estado), 600)
  }
  // Salir de la pantalla con un cambio en el aire: se guarda ya (nunca se pierde)
  const pendienteRef = useRef<Map<string, number> | null>(null)
  pendienteRef.current = local
  const guardarRef = useRef(guardar)
  guardarRef.current = guardar
  useEffect(() => () => { if (pendienteRef.current) { clearTimeout(timer.current); void guardarRef.current(pendienteRef.current) } }, [])

  const setCantidad = (r: Renglon, cantidad: number) => programar(new Map(local ?? []).set(r.detalleId, cantidad))

  const abrirPdf = async (ruta: string) => {
    // La web redirige a una URL firmada del bucket privado: se resuelve con la sesión
    // del equipo y se abre FUERA de la app (el WebView no muestra PDF). Online-only.
    try {
      const token = await rt.auth.accessToken()
      const ctrl = new AbortController()
      const res = await fetch(`${rt.api.base}${ruta}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal })
      const url = res.url
      ctrl.abort()
      if (!res.ok || !url || url.startsWith(rt.api.base)) throw new Error()
      window.open(url, "_blank")
    } catch {
      mostrar("No se pudo abrir el PDF. Probá de nuevo con buena señal.", "err")
    }
  }

  return (
    <Pantalla
      titulo={pedido.numero_pedido ? `Pedido Nº ${pedido.numero_pedido}` : "Pedido"}
      dataset={DS.pedidos}
      derecha={<span className="mr-1">{local ? <span className="rounded-full bg-lavanda-700 px-2.5 py-1 text-[10px] font-bold text-white">Guardando…</span> : <BadgeEstado estado={pedido.estado} />}</span>}
      pie={
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <span className="text-gray-500">Total</span>
            <span className="text-2xl font-bold text-gray-900">{formatCurrency(total)}</span>
          </div>
        </div>
      }
    >
      {toast}
      <Rechazos items={rechazosDe(ops, "pedido.").filter((o) => (o.payload as OpPedido)?.pedido_id === pedido.id)} ayuda="El pedido quedó como está en el sistema. Volvé a hacer el cambio si sigue haciendo falta." />
      <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <button onClick={() => cliente && navigate(`/clientes/${cliente.id}`)} className="min-h-11 flex-1 text-left font-bold text-gray-900">{cliente?.nombre || "Sin cliente"} ›</button>
            {vista.cambios && vista.cambios.estado !== "rechazado" && <SinEnviar texto={vista.cambios.estado === "enviando" ? "enviando…" : "cambios sin enviar"} />}
          </div>
          <p className="text-sm text-gray-500">{fechaCorta(pedido.fecha, { day: "numeric", month: "short", year: "numeric" })}</p>
          {pedido.observaciones && <p className="mt-2 text-sm text-gray-600">📝 {pedido.observaciones}</p>}
          {cliente && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => navigate(`/clientes/${cliente.id}/cobrar`)} className="min-h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white">💵 Cobrar</button>
              <button onClick={() => navigate(`/clientes/${cliente.id}/devolucion?pedido=${pedido.id}`)} className="min-h-11 rounded-xl border border-gray-300 bg-white text-sm font-bold text-gray-700">↩ Devolución</button>
            </div>
          )}
        </div>

        {!esPedidoEditable(pedido.estado) && (
          <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">Este pedido ya está {(ESTADO_LABEL[pedido.estado] || pedido.estado).toLowerCase()} y no se puede modificar desde acá.</p>
        )}

        {/* Cabecera de descuentos: lo que efectivamente se aplicó y de dónde salió cada % */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-700">Descuentos</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${fila.descuentos.solo_este_pedido ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>{fila.descuentos.solo_este_pedido ? "solo este pedido" : "ficha del cliente"}</span>
          </div>
          <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] gap-1 text-[11px] font-bold uppercase text-gray-400"><span /><span className="text-center">Gral.</span><span className="text-center">Viaj.</span><span className="text-center">Merc.</span></div>
          {fila.descuentos.segmentos.map((s) => (
            <div key={s.segmento} className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] items-center gap-1 py-1 text-sm">
              <span className="text-gray-700">{SEG_LABEL[s.segmento]}</span>
              <span className="text-center font-bold text-gray-800">{s.general.pct}%</span>
              <span className={`rounded text-center font-bold ${s.viajante.origen === "pedido" ? "bg-amber-100 text-amber-800" : "text-gray-800"}`}>{s.viajante.pct}%</span>
              <span className={`rounded text-center font-bold ${s.mercaderia.origen === "pedido" ? "bg-amber-100 text-amber-800" : "text-gray-800"}`}>{s.mercaderia.pct}%</span>
            </div>
          ))}
          {fila.descuentos.condiciones.map((c, k) => (
            <p key={k} className="mt-1 text-xs text-gray-500">{c.ambito === "marca" ? "Marca" : "Proveedor"} <b>{c.nombre}</b>: gral. {c.dto_general_pct}% · viaj. {c.dto_viajante_pct}% · merc. {c.dto_mercaderia_pct}%{c.origen === "pedido" ? ", solo este pedido" : ""}</p>
          ))}
        </div>

        <div className="space-y-2">
          {renglones.map((r) => (
            <FilaRenglon key={r.detalleId} r={r} editable={editable} onCantidad={(n) => setCantidad(r, n)} onQuitar={() => ver.abrir(`quitar:${r.detalleId}`)} onZoom={() => foto.abrir(r.d.articulos?.imagen_url)} />
          ))}
          {nuevos.map((i) => (
            <div key={i.articulo_id} className="rounded-xl border border-amber-200 bg-white"><RenglonLectura i={i} /><p className="px-3 pb-2 text-[11px] font-bold text-amber-700">⇪ agregado sin enviar</p></div>
          ))}
          {bonificados.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-3">
              <p className="min-w-0 flex-1 text-sm font-bold text-gray-900">{d.articulos?.descripcion || "Artículo"}</p>
              <span className="shrink-0 text-xs font-bold text-green-700">BONIF · sin cargo × {d.cantidad}</span>
            </div>
          ))}
        </div>

        {esPedidoEditable(pedido.estado) && cliente && (
          <button onClick={() => navigate(`/pedido/nuevo/${cliente.id}?pedido=${pedido.id}`)} className="min-h-12 w-full rounded-xl border-2 border-emerald-600 bg-white font-bold text-emerald-700">＋ Agregar artículos</button>
        )}

        {(fila.comprobantes.length > 0 || fila.remitos.length > 0) && (
          <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-bold text-gray-700">Documentos</p>
            {!online && <p className="text-xs text-gray-500">Necesitás conexión para abrir los PDF.</p>}
            {fila.comprobantes.map((c) => (
              <button key={c.id} disabled={!online || c.estado_pdf !== "generado"} onClick={() => void abrirPdf(`/api/comprobantes-venta/${c.id}/pdf`)} className="min-h-11 w-full rounded-xl border border-gray-300 px-3 text-left text-sm font-bold text-gray-800 disabled:opacity-40">📄 {c.tipo_comprobante} {c.numero_comprobante}</button>
            ))}
            {fila.remitos.map((r) => (
              <button key={r.id} disabled={!online || r.estado_pdf !== "generado"} onClick={() => void abrirPdf(`/api/remitos/${r.id}/pdf`)} className="min-h-11 w-full rounded-xl border border-gray-300 px-3 text-left text-sm font-bold text-gray-800 disabled:opacity-40">🚚 Remito {r.tipo_remito === "REM" ? "R" : "X"} {r.numero_remito}</button>
            ))}
          </div>
        )}

        {esPedidoEditable(pedido.estado) && (
          <button onClick={eliminar.abrir} className="min-h-11 w-full rounded-xl border border-red-200 bg-white py-3 text-sm font-bold text-red-600">🗑 Eliminar pedido</button>
        )}
      </div>

      <HojaConfirmar
        abierta={eliminar.abierto} onCerrar={eliminar.cerrar} titulo={`¿Eliminar el pedido${pedido.numero_pedido ? ` Nº ${pedido.numero_pedido}` : ""} completo?`} confirmar="Eliminar" peligro
        onConfirmar={() => {
          void (async () => {
            if (vista.cambios && vista.cambios.estado !== "enviando") await rt.outbox.retirar(vista.cambios.opKey)
            await encolar("pedido.eliminar", { pedido_id: pedido.id }, `Eliminar pedido ${pedido.numero_pedido ? `Nº ${pedido.numero_pedido}` : ""} · ${cliente?.nombre || ""}`)
            volver(2)
          })()
        }}
      >
        No se puede deshacer.
      </HojaConfirmar>
      {(() => {
        const r = ver.ver?.startsWith("quitar:") ? renglones.find((x) => x.detalleId === ver.ver!.slice(7)) : null
        return (
          <HojaConfirmar abierta={!!r} onCerrar={ver.cerrar} titulo="¿Quitar del pedido?" confirmar="Quitar" peligro onConfirmar={() => { if (r) setCantidad(r, 0); ver.cerrar() }}>
            {r?.d.articulos?.descripcion}
          </HojaConfirmar>
        )
      })()}
      {foto.src && <ZoomFoto src={foto.src} onCerrar={foto.cerrar} />}
    </Pantalla>
  )
}

function FilaRenglon({ r, editable, onCantidad, onQuitar, onZoom }: { r: Renglon; editable: boolean; onCantidad: (n: number) => void; onQuitar: () => void; onZoom: () => void }) {
  const a = r.d.articulos
  const [cant, setCant] = useState(String(r.cantidad))
  const [bultos, setBultos] = useState(false)
  const [editando, setEditando] = useState(false)
  useEffect(() => { if (!editando) { setCant(String(r.cantidad)); setBultos(false) } }, [r.cantidad, editando])
  const ub = a?.unidades_por_bulto || 1
  const n = parseFloat(cant.replace(",", "."))
  const unidades = Number.isFinite(n) && n > 0 ? (bultos ? n * ub : n) : 0
  const cambiado = unidades !== r.cantidad
  const confirmar = () => {
    setEditando(false)
    if (unidades <= 0) onQuitar()
    else if (cambiado) onCantidad(unidades)
  }
  const precio = Number(r.d.precio_final) || 0
  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
      <button onClick={onZoom} className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-50">
        {a?.imagen_url ? <img src={a.imagen_url} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-lg text-gray-300">📦</span>}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-snug text-gray-900">
          {a?.descripcion || "Artículo"}
          {(r.d.descuento_propio_pct || 0) > 0 && <span className="ml-1.5 rounded bg-red-100 px-1.5 text-[10px] font-bold text-red-700">-{r.d.descuento_propio_pct}%</span>}
          {(r.d.bonif_viajante_pct || 0) > 0 && <span className="ml-1.5 rounded bg-orange-100 px-1.5 text-[10px] font-bold text-orange-700">viaj. −{r.d.bonif_viajante_pct}%</span>}
        </p>
        <p className="truncate text-[11px] text-gray-400">{a?.sku || "—"}{a?.marca?.descripcion ? ` · ${a.marca.descripcion}` : ""}{a?.unidades_por_bulto ? ` · x${a.unidades_por_bulto}` : ""}</p>
        <p className="text-[11px] text-gray-600">{formatCurrency(precio)} c/u · <b>{formatCurrency(precio * r.cantidad)}</b></p>
      </div>
      {editable ? (
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex flex-col items-center gap-0.5">
            <input
              value={cant} inputMode="decimal" aria-label="Cantidad"
              onFocus={() => setEditando(true)}
              onChange={(e) => { setEditando(true); setCant(e.target.value.replace(/[^\d.,]/g, "")) }}
              onBlur={() => { if (!cambiado) setEditando(false) }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); (e.target as HTMLInputElement).blur() } }}
              className="w-14 rounded-md border border-emerald-500 bg-emerald-50 px-1.5 py-1.5 text-center text-sm font-bold text-emerald-700"
            />
            <label className="flex select-none items-center gap-1 text-[10px] text-gray-500">
              <input type="checkbox" checked={bultos} onChange={(e) => { setEditando(true); setBultos(e.target.checked) }} className="h-3 w-3 accent-emerald-600" />
              bultos{bultos && ub > 1 && unidades > 0 ? ` (=${unidades} u)` : ""}
            </label>
          </div>
          {cambiado || editando
            ? <button onClick={confirmar} className="h-11 w-10 rounded-lg bg-emerald-600 text-lg font-bold text-white" aria-label="Confirmar cantidad">✓</button>
            : <button onClick={onQuitar} className="h-11 w-10 rounded-lg border border-red-200 bg-white text-lg text-red-600" aria-label="Quitar del pedido">🗑</button>}
        </div>
      ) : (
        <span className="shrink-0 px-2 text-sm font-bold text-gray-700">× {r.cantidad}</span>
      )}
    </div>
  )
}
