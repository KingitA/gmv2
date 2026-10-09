// Venta a cliente NUEVO (decisión del dueño, 09/10/2026). En la calle primero se vende:
// el cliente consulta precios, compara cómo le conviene que le facturen y va encargando;
// recién al cerrar se le piden los datos. Flujo:
//   1. /venta-nueva crea un borrador con un id de cliente que todavía no existe (Prospecto)
//      y abre el catálogo de siempre (/pedido/nuevo/:id).
//   2. En el catálogo, columnas para COMPARAR listas × método (como la pantalla Precios) y la
//      hoja 👤 elige la lista y el método del cliente, general o POR SEGMENTO (será su ficha).
//   3. "Siguiente: datos del cliente" (/pedido/nuevo/:id/cliente): datos obligatorios; al
//      guardar se encolan el ALTA y el PEDIDO (en ese orden: la cola es FIFO). Todo sin señal.
//   4. El servidor toma el pedido como primer pedido del cliente ⇒ "en_revision": la oficina
//      revisa cliente y pedido antes de que vaya a depósito.

import { useEffect, useRef } from "react"
import { Navigate, useNavigate } from "react-router"
import { useOverlay, useRuntime, useSesion } from "@gm/core"
import { type Articulo } from "../../datasets"
import { almacenBorradores, conArticulo, nuevoBorrador, type Prospecto } from "../../datos/borradores"
import { useCatalogosFicha, useEncolar, useListasPermitidas, uuidv4 } from "../../datos/hooks"
import { fichaListasDe, type FichaListas } from "../../datos/segmentos"
import { formatCurrency } from "../../ui"
import { AgregarCombo, comboKey, type Combo } from "../Precios"
import { ClienteNuevo } from "../clientes/ClienteNuevo"
import { EditorListaMetodo } from "../clientes/EditorListaMetodo"
import { armarPedido } from "./Pantallas"
import { usePedidoEnCurso } from "./contexto"

const METODO_CORTO: Record<string, string> = { Factura: "c/IVA", Final: "Final", Presupuesto: "Presup." }

// ─── /venta-nueva ────────────────────────────────────────────────────────────

export function VentaNueva() {
  const rt = useRuntime()
  const navigate = useNavigate()
  const { sesion } = useSesion()
  const cat = useCatalogosFicha()
  const { listas } = useListasPermitidas()
  const hecho = useRef(false)

  useEffect(() => {
    const uid = sesion?.user.id
    if (hecho.current || !uid || !cat) return
    hecho.current = true
    // Lista de arranque: la que impone el viajante del usuario; si no, Neco (las únicas de la app)
    const viajante = cat.vendedores[0]
    const neco = cat.listas_precio.find((l) => /neco/i.test(l.nombre)) ?? cat.listas_precio[0]
    const lista = (viajante?.lista_nombre ? viajante.lista_precio_id : null) || neco?.id || ""
    const necoComparar = listas.find((l) => l.codigo === "neco") ?? listas[0]
    const ficha: FichaListas = { ...fichaListasDe({}), lista_precio_id: lista, metodo_facturacion: "Factura" }
    const prospecto: Prospecto = {
      ficha,
      combos: necoComparar ? [{ lista_id: necoComparar.id, metodo: "Factura" }, { lista_id: necoComparar.id, metodo: "Presupuesto" }] : [],
    }
    const id = uuidv4()
    void almacenBorradores(rt).guardar(uid, nuevoBorrador(id, "Cliente nuevo", { prospecto })).then(() => navigate(`/pedido/nuevo/${id}`, { replace: true }))
  }, [cat, listas, navigate, rt, sesion?.user.id])

  if (!cat) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-8 text-center text-gray-500">
        Todavía no se descargaron las listas de opciones en este equipo. Conectate una vez para tenerlas sin señal.
      </div>
    )
  }
  return null
}

// ─── Columnas para comparar (solo en la venta a cliente nuevo) ───────────────

/** Chips de las columnas a comparar + "+ Comparar" (va debajo del encabezado del catálogo). */
export function BarraComparar() {
  const p = usePedidoEnCurso()
  const { listas, metodos } = useListasPermitidas()
  const agregar = useOverlay("comparar")
  if (!p.prospecto) return null
  const combos = p.prospecto.combos
  const setCombos = (c: Combo[]) => p.setProspecto({ ...p.prospecto!, combos: c })
  const nombre = (c: Combo) => `${listas.find((l) => l.id === c.lista_id)?.nombre || "Lista"} · ${metodos.find((m) => m.key === c.metodo)?.label || c.metodo}`
  return (
    <div className="flex flex-wrap items-center gap-1.5 bg-slate-800 px-4 pb-2">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Comparar:</span>
      {combos.map((c, i) => (
        <span key={comboKey(c)} className="flex min-h-8 items-center gap-1 rounded-full bg-white/15 pl-2.5 pr-1 text-[11px] font-bold text-white">
          {nombre(c)}
          <button onClick={() => setCombos(combos.filter((_, k) => k !== i))} className="h-7 w-7 rounded-full" aria-label="Quitar columna">✕</button>
        </span>
      ))}
      {combos.length < 3 && <button onClick={agregar.abrir} className="min-h-8 rounded-full bg-white px-3 text-[11px] font-bold text-emerald-700">+ Comparar</button>}
      {agregar.abierto && (
        <AgregarCombo
          listas={listas} metodos={metodos} existentes={combos.map(comboKey)} onCerrar={agregar.cerrar}
          // Las columnas viven en el borrador (no en la URL): cerrar() vuelve atrás sin perderlas
          onAgregar={(c) => { if (!combos.some((x) => comboKey(x) === comboKey(c))) setCombos([...combos, c]); agregar.cerrar() }}
        />
      )}
    </div>
  )
}

/** Precio del artículo en cada columna de comparación (debajo de la fila del catálogo). */
export function CeldasComparar({ a }: { a: Articulo }) {
  const p = usePedidoEnCurso()
  const { listas } = useListasPermitidas()
  const combos = p.prospecto?.combos ?? []
  if (!combos.length) return null
  const variasListas = new Set(combos.map((c) => c.lista_id)).size > 1
  return (
    <div className={`-mt-1 mb-1 grid gap-1 px-1 ${combos.length === 1 ? "grid-cols-1" : combos.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {combos.map((c, i) => {
        const pr = p.motoresComparar[i]?.precio(a.id)
        const lista = listas.find((l) => l.id === c.lista_id)?.nombre || ""
        return (
          <div key={comboKey(c)} className="flex items-baseline justify-between gap-1 rounded bg-gray-50 px-2 py-1">
            <span className="truncate text-[9px] font-bold uppercase text-gray-400">{variasListas ? `${lista} ` : ""}{METODO_CORTO[c.metodo] || c.metodo}</span>
            <span className="text-[12px] font-bold text-gray-900">{pr ? formatCurrency(pr.precio) : "—"}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Hoja 👤 de la venta a cliente nuevo: su lista y su facturación ─────────

export function PanelProspecto({ onCerrar }: { onCerrar: () => void }) {
  const p = usePedidoEnCurso()
  const cat = useCatalogosFicha()
  if (!p.prospecto) return null
  const viajante = cat?.vendedores[0]
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onCerrar}>
      <div className="mx-auto max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-lg font-bold text-gray-900">Cliente nuevo</p>
          <p className="text-sm text-gray-500">Elegí cómo le conviene que le facturen: los precios del pedido cambian al instante. Esto queda como la ficha del cliente.</p>
        </div>
        <EditorListaMetodo
          valor={p.prospecto.ficha}
          onCambiar={(ficha) => p.setProspecto({ ...p.prospecto!, ficha })}
          listas={cat?.listas_precio ?? []}
          puedeLista={!!cat?.puede_cambiar_lista}
          listaImpuesta={viajante?.lista_nombre || null}
        />
        <button onClick={onCerrar} className="w-full rounded-xl bg-emerald-600 py-3.5 font-bold text-white">Listo</button>
      </div>
    </div>
  )
}

// ─── /pedido/nuevo/:id/cliente — datos obligatorios y cierre ────────────────

export function DatosClienteNuevo() {
  const p = usePedidoEnCurso()
  const rt = useRuntime()
  const navigate = useNavigate()
  const encolar = useEncolar()
  const { sesion } = useSesion()
  // Mientras se cierra, el alta ya encolada convierte al "cliente nuevo" en uno de la cartera:
  // no redirigir en el medio
  const cerrando = useRef(false)
  if (cerrando.current) return null
  // (el prospecto se lee del BORRADOR: apenas se encola el alta, el contexto ya ve un cliente de la cartera)
  const prospecto = p.borrador?.prospecto
  if (!prospecto || !p.borrador) return <Navigate to={`/pedido/nuevo/${p.clienteId}/carrito`} replace />

  const alGuardar = async (nombre: string) => {
    cerrando.current = true
    // El alta ya quedó encolada (ClienteNuevo): detrás va el pedido, con el MISMO armado del carrito
    const { tipo, payload, etiqueta } = armarPedido(p, rt)
    payload.vista = { ...payload.vista!, cliente_nombre: nombre }
    await encolar(tipo, payload, etiqueta.replace("Cliente nuevo", nombre))
    await p.descartar()
    navigate(`/pedido/nuevo/${p.clienteId}/listo?revision=1`, { replace: true })
  }

  /** CUIT de un cliente que ya está en la cartera: el pedido armado pasa a ese cliente. */
  const pasarA = async (clienteId: string) => {
    const uid = sesion?.user.id
    if (!uid || !p.borrador) return
    const almacen = almacenBorradores(rt)
    let destino = almacen.de(uid, clienteId) ?? nuevoBorrador(clienteId, "")
    for (const it of p.borrador.items) destino = conArticulo(destino, { ...it, detalleId: null, precioFijo: null })
    await almacen.guardar(uid, { ...destino, obs: destino.obs || p.borrador.obs })
    await p.descartar()
    navigate(`/pedido/nuevo/${clienteId}/carrito`, { replace: true })
  }

  return <ClienteNuevo prospecto={{ clienteId: p.clienteId, ficha: prospecto.ficha, alGuardar, pasarA }} />
}
