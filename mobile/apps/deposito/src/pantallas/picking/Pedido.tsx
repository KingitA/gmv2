import { useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useLector, useOverlay } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { marcaPicking } from "../../datos/cantidad"
import { useEncolar, usePedido } from "../../datos/hooks"
import { estadoDe, tomadoPorOtro } from "../../datos/overlay"
import { BarraProgreso, C, Contadores, dejarAviso, Marco, Rechazos, TITULO_GRUPO, useAvisoEntrante, useTecladoAbierto, useToast, useVolver } from "../../ui"
import { PanelBuscar } from "../comunes/Buscar"
import { FichaArticulo, useAbrirFicha, useFichaAbierta, type DatosFicha } from "../comunes/FichaArticulo"
import { PanelCantidad } from "../comunes/Cantidad"
import { DATASET, PedidoNoDisponible, RenglonPedido, usePicking } from "./comun"
import type { PedidoVista } from "../../datos/overlay"

/** Datos para la ficha de un artículo que no esté en el catálogo replicado. */
const respaldoDe = (p: PedidoVista | null) => (articuloId: string): DatosFicha | undefined => {
  const a = p?.pedidos_detalle.find((d) => d.articulo_id === articuloId)?.articulos
  return a ? { id: articuloId, descripcion: a.descripcion, sku: a.sku, marca: a.marca?.descripcion ?? null, unidades_por_bulto: a.unidades_por_bulto, ean13: a.ean13 } : undefined
}

const clienteDe = (p: PedidoVista) => p.clientes?.razon_social || p.clientes?.nombre || "Sin cliente"
const AYUDA_RECHAZO = "La lista ya muestra el estado real del servidor. Si hace falta, volvé a marcar el renglón."

/** Bultos / pallets tipeados: solo dígitos (no es un monto: nada de comas ni puntos). */
const soloEntero = (txt: string) => txt.replace(/\D/g, "").slice(0, 4)

/**
 * Finalizar: confirmación con la mercadería bonificada (como la web) y, P2-19, los bultos:
 * "Cargar bultos" (cajas cerradas que no pasan por control: bultos y pallets acá) o
 * "Dejar para después del control" (queda preparado sin bultos; la oficina los carga al
 * armar el viaje, #22). El pedido se cierra igual con o sin bultos. Cierre por outbox.
 */
function useFinalizar(pedido: PedidoVista | null, mostrar: (m: string, t?: "ok" | "err") => void) {
  const encolar = useEncolar()
  const volver = useVolver()
  const hoja = useOverlay("finalizar")
  const [cargando, setCargando] = useState(false)
  const [bultos, setBultos] = useState("")
  const [pallets, setPallets] = useState("")
  const enviado = useRef(false)
  const bonificados = pedido?.pedidos_detalle.filter((i) => i.es_bonificado && (i.cantidad ?? 0) > 0) ?? []

  const cerrar = async (pasosExtra: number, carga: { bultos?: number; pallets?: number }) => {
    if (!pedido || enviado.current) return
    enviado.current = true // doble toque: un solo cierre
    const texto = textoBultos(carga)
    await encolar("picking.cerrar", { pedido_id: pedido.id, ...carga }, `Finalizar pedido ${pedido.numero_pedido} — ${clienteDe(pedido)}${texto ? ` (${texto})` : " (bultos después del control)"}`)
    dejarAviso(texto ? `✅ Pedido finalizado · ${texto}` : "✅ Pedido finalizado · bultos después del control")
    volver(2 + pasosExtra)
  }
  const conBultos = (pasosExtra: number) => {
    const b = bultos ? Number(bultos) : 0
    const p = pallets ? Number(pallets) : 0
    if (b + p === 0) { mostrar("Cargá cuántos bultos (o pallets) lleva", "err"); return }
    void cerrar(pasosExtra, { bultos: b, pallets: p })
  }
  const pedir = () => {
    if (!pedido) return
    if (pedido.progreso.pendientes > 0) { mostrar(`Faltan ${pedido.progreso.pendientes} artículos por resolver`, "err"); return }
    setCargando(false)
    setBultos("")
    setPallets("")
    enviado.current = false
    hoja.abrir()
  }
  const campo = (etiqueta: string, valor: string, cambiar: (v: string) => void, foco = false) => (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>{etiqueta}</div>
      <input
        type="text" inputMode="numeric" value={valor} autoFocus={foco} placeholder="0"
        onChange={(e) => cambiar(soloEntero(e.target.value))}
        style={{ width: "100%", background: C.bg, color: C.text, fontSize: 32, fontWeight: 800, textAlign: "center", borderRadius: 14, padding: 10, border: `2px solid ${C.border}`, outline: "none", boxSizing: "border-box" }}
      />
    </label>
  )
  const nodo = (pasosExtra = 0) => (
    <Hoja abierta={hoja.abierto} onCerrar={hoja.cerrar} titulo={cargando ? "Bultos del pedido" : "Finalizar la preparación"}>
      {!cargando && bonificados.length > 0 && (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.sub, marginBottom: 4 }}>Mercadería bonificada a entregar</div>
          <ul style={{ margin: "0 0 16px", padding: 0, listStyle: "none" }}>
            {bonificados.map((b) => (
              <li key={b.id} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 16 }}>
                <b>{b.cantidad} u</b> — {b.articulos?.descripcion ?? ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {!cargando ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 15, color: C.text, fontWeight: 600 }}>¿Cargás los bultos ahora?</div>
          <button onClick={() => setCargando(true)} style={{ background: C.green, color: "#fff", fontWeight: 800, fontSize: 17, padding: "17px 12px", borderRadius: 16, border: "none", textAlign: "left" }}>
            📦 Cargar bultos
            <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.9, marginTop: 2 }}>Cajas cerradas que no pasan por control</div>
          </button>
          <button onClick={() => void cerrar(pasosExtra, {})} style={{ background: C.white, color: C.text, fontWeight: 800, fontSize: 17, padding: "17px 12px", borderRadius: 16, border: `1.5px solid ${C.border}`, textAlign: "left" }}>
            🕓 Dejar para después del control
            <div style={{ fontSize: 13, fontWeight: 500, color: C.sub, marginTop: 2 }}>Queda preparado sin bultos; la oficina los carga al armar el viaje</div>
          </button>
          <button onClick={hoja.cerrar} style={{ background: C.bg, color: C.sub, fontWeight: 700, fontSize: 15, padding: "14px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>Cancelar</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {campo("Bultos", bultos, setBultos, true)}
            {campo("Pallets (si hay)", pallets, setPallets)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <button onClick={() => setCargando(false)} style={{ background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "16px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>← Volver</button>
            <button onClick={() => conBultos(pasosExtra)} style={{ background: C.green, color: "#fff", fontWeight: 800, fontSize: 16, padding: "16px 0", borderRadius: 16, border: "none" }}>✅ Finalizar</button>
          </div>
        </div>
      )}
    </Hoja>
  )
  return { pedir, nodo }
}

/** "3 bultos · 1 pallet" (vacío sin carga). Igual que textoCarga del ERP (lib/viajes/bultos.ts). */
export function textoBultos({ bultos = 0, pallets = 0 }: { bultos?: number; pallets?: number }) {
  const partes: string[] = []
  if (bultos > 0) partes.push(`${bultos} ${bultos === 1 ? "bulto" : "bultos"}`)
  if (pallets > 0) partes.push(`${pallets} ${pallets === 1 ? "pallet" : "pallets"}`)
  return partes.join(" · ")
}

/**
 * Menú "⋯" del pedido (P2-18): "Reiniciar preparación" (todo a cero, sigo yo) y
 * "Soltar pedido" (vuelve a la cola sin sesión, como estaba). Los dos con confirmación.
 * Si hay renglones de otra persona no se ofrece: el servidor lo rechazaría (solo admin).
 */
function useOpcionesPedido(pedido: PedidoVista | null, acciones: { reiniciar: () => Promise<void>; soltar: () => Promise<void>; deOtros: string[] }, mostrar: (m: string, t?: "ok" | "err") => void) {
  const hoja = useOverlay("opciones")
  const volver = useVolver()
  const [confirmar, setConfirmar] = useState<null | "reiniciar" | "soltar">(null)
  const hecho = useRef(false)
  const abrir = () => { setConfirmar(null); hecho.current = false; hoja.abrir() }

  const ejecutar = async () => {
    if (!pedido || !confirmar || hecho.current) return
    hecho.current = true
    if (confirmar === "reiniciar") {
      await acciones.reiniciar()
      hoja.cerrar()
      mostrar("↺ Preparación reiniciada: todo volvió a pendiente")
    } else {
      await acciones.soltar()
      dejarAviso(`↩ Pedido ${pedido.numero_pedido} soltado: volvió a la cola`)
      volver(2) // la hoja y el pedido
    }
  }
  const botonMenu = (
    <button onClick={abrir} aria-label="Opciones del pedido" style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "0 12px", minHeight: 44, fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: "nowrap", flexShrink: 0 }}>⋯ Opciones</button>
  )
  const opcion = (icono: string, titulo: string, detalle: string, onClick: () => void, peligro = false) => (
    <button onClick={onClick} style={{ width: "100%", background: C.white, border: `1.5px solid ${peligro ? C.redB : C.border}`, borderRadius: 16, padding: "14px 14px", textAlign: "left", display: "flex", gap: 12, alignItems: "center" }}>
      <span style={{ fontSize: 24 }}>{icono}</span>
      <span>
        <div style={{ fontSize: 17, fontWeight: 800, color: peligro ? C.red : C.text }}>{titulo}</div>
        <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>{detalle}</div>
      </span>
    </button>
  )
  const TEXTO = {
    reiniciar: { titulo: "¿Reiniciar la preparación?", detalle: "Todo lo que se separó en este pedido vuelve a pendiente (en 0). Seguís vos con el pedido abierto.", boton: "↺ Sí, reiniciar" },
    soltar: { titulo: "¿Soltar el pedido?", detalle: "Lo separado vuelve a 0, el pedido sale de \"en preparación\" y vuelve a la cola como estaba. Cualquiera lo puede tomar de nuevo.", boton: "↩ Sí, soltar" },
  }
  const nodo = pedido && (
    <Hoja abierta={hoja.abierto} onCerrar={hoja.cerrar} titulo={confirmar ? TEXTO[confirmar].titulo : `Pedido ${pedido.numero_pedido}`}>
      {acciones.deOtros.length > 0 ? (
        <div style={{ background: C.yellowL, border: `1px solid ${C.yellowB}`, borderRadius: 14, padding: 14, color: C.text, fontSize: 15, lineHeight: 1.4 }}>
          Hay artículos preparados por <b>{acciones.deOtros.join(", ")}</b>. Para reiniciar o soltar el pedido, esa persona tiene que devolverlos a pendiente desde su equipo, o lo hace un administrador.
        </div>
      ) : !confirmar ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {opcion("↺", "Reiniciar preparación", "Vuelve a cero lo separado; seguís con el pedido", () => setConfirmar("reiniciar"))}
          {opcion("↩", "Soltar pedido", "Vuelve a la cola, sin nadie preparándolo", () => setConfirmar("soltar"), true)}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 15, color: C.text, lineHeight: 1.45 }}>{TEXTO[confirmar].detalle}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <button onClick={() => setConfirmar(null)} style={{ background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "16px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>No</button>
            <button onClick={() => void ejecutar()} style={{ background: confirmar === "soltar" ? C.red : C.orange, color: "#fff", fontWeight: 800, fontSize: 16, padding: "16px 0", borderRadius: 16, border: "none" }}>{TEXTO[confirmar].boton}</button>
          </div>
        </div>
      )}
    </Hoja>
  )
  return { botonMenu, nodo }
}

function BotonFinalizar({ pedido, onClick, etiqueta, flex = 1 }: { pedido: PedidoVista; onClick: () => void; etiqueta: string; flex?: number }) {
  const listo = pedido.progreso.pendientes === 0
  return (
    <button onClick={onClick} style={{ flex, background: listo ? C.green : "#f3f4f6", color: listo ? "#fff" : C.light, fontWeight: listo ? 800 : 700, fontSize: 16, padding: "19px 0", borderRadius: 18, border: listo ? "none" : `1.5px solid ${C.border}` }}>
      ✅ {etiqueta}
    </button>
  )
}

// ─── /preparar/:id — lista principal ─────────────────────────────────────────

export function Pedido() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { pedido, cargando } = usePedido(id)
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)
  const { marcar, resolverCodigo, abrirItem, reiniciar, soltar, deOtros } = usePicking(pedido, mostrar)
  const fin = useFinalizar(pedido, mostrar)
  const opciones = useOpcionesPedido(pedido, { reiniciar, soltar, deOtros }, mostrar)
  const abrirFicha = useAbrirFicha()
  const fichaAbierta = useFichaAbierta()
  const respaldoFicha = useMemo(() => respaldoDe(pedido), [pedido])

  // Gatillo del lector desde la lista: abre la cantidad del renglón sin tocar la pantalla.
  // Con la ficha abierta, la cantidad la reemplaza: atrás vuelve a la lista, no a la ficha.
  useLector({ enabled: !!pedido, onCodigo: (c) => { const det = resolverCodigo(c); if (det) abrirItem(det, { replace: fichaAbierta }) } })

  if (!pedido || pedido.cierrePendiente) {
    return <Marco titulo="Preparar Pedidos" dataset={DATASET}>{toast}<PedidoNoDisponible cargando={cargando} finalizado={pedido?.cierrePendiente} /></Marco>
  }

  const pendientes = pedido.pedidos_detalle.filter((i) => estadoDe(i) === "PENDIENTE")
  const completos = pedido.pedidos_detalle.filter((i) => estadoDe(i) === "COMPLETO" || estadoDe(i) === "PARCIAL")
  const { progreso } = pedido
  const aFaltante = (item: (typeof pendientes)[number]) => ({
    fondo: C.red, icono: "✕", etiqueta: "Faltante",
    onConfirmar: () => void marcar(item, 0, true).then((ok) => ok && mostrar("Marcado como faltante")),
  })

  return (
    <Marco titulo="Preparar Pedidos" dataset={DATASET}>
      {toast}
      <Rechazos items={pedido.rechazos} ayuda={AYUDA_RECHAZO} />
      {/* Cabecera compacta: lo que se gana en alto son renglones de artículo a la vista */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "10px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clienteDe(pedido)}</div>
            <div style={{ color: C.light, fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ fontFamily: "monospace" }}>{pedido.numero_pedido}</span>
              {[pedido.clientes?.direccion, pedido.clientes?.localidad].filter(Boolean).length > 0 && (
                <span style={{ color: C.sub }}> · {[pedido.clientes?.direccion, pedido.clientes?.localidad].filter(Boolean).join(" · ")}</span>
              )}
            </div>
          </div>
          {progreso.faltantes > 0 && (
            <button onClick={() => navigate(`/preparar/${pedido.id}/faltantes`)} style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 12, padding: "0 12px", minHeight: 44, fontSize: 13, fontWeight: 700, color: C.red, whiteSpace: "nowrap", flexShrink: 0 }}>
              ✕ {progreso.faltantes} faltante{progreso.faltantes > 1 ? "s" : ""}
            </button>
          )}
          {/* P2-18: reiniciar / soltar, a la vista (en la barra oscura no se encontraba) */}
          {opciones.botonMenu}
        </div>
        <BarraProgreso resueltos={progreso.resueltos} total={progreso.total} pendientes={progreso.pendientes} ok={progreso.completos} faltantes={progreso.faltantes} />
      </div>

      {/* La ayuda del swipe solo mientras el pedido no se empezó: después estorba */}
      {pendientes.length > 0 && progreso.resueltos === 0 && (
        <div style={{ background: C.orangeL, borderBottom: `1px solid ${C.orangeB}`, padding: "5px 14px", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>👈</span>
          <span style={{ fontSize: 12, color: C.orange, fontWeight: 600 }}>Swipeá para faltante · Escaneá para cantidad · Tocá para ver la ficha</span>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "10px 14px 0" }}>
        {pendientes.length > 0 && (
          <>
            <div style={TITULO_GRUPO}>Pendientes ({pendientes.length})</div>
            {pendientes.map((item) => <RenglonPedido key={item.id} pedido={pedido} item={item} accion={aFaltante(item)} onAbrir={() => abrirFicha(item.articulo_id)} />)}
          </>
        )}
        {completos.length > 0 && (
          <>
            <div style={{ ...TITULO_GRUPO, paddingTop: 8 }}>Preparados ({completos.length})</div>
            {completos.map((item) => <RenglonPedido key={item.id} pedido={pedido} item={item} accion={aFaltante(item)} onAbrir={() => abrirFicha(item.articulo_id)} />)}
          </>
        )}
        <div style={{ height: 16 }} />
      </div>
      <FichaArticulo respaldo={respaldoFicha} />

      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 12 }}>
        <button onClick={() => navigate(`/preparar/${pedido.id}/buscar`)} style={{ flex: 2, background: C.white, color: C.text, fontWeight: 700, fontSize: 18, padding: "19px 0", borderRadius: 18, border: `1.5px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔍</span> Buscar artículo
        </button>
        <BotonFinalizar pedido={pedido} etiqueta="Listo" onClick={() => fin.pedir()} />
      </div>
      {fin.nodo()}
      {opciones.nodo}
    </Marco>
  )
}

// ─── /preparar/:id/buscar — búsqueda manual / scanner ────────────────────────

export function PedidoBuscar() {
  const { id } = useParams()
  const { pedido, cargando } = usePedido(id)
  const { toast, mostrar } = useToast()
  const { yo, resolverCodigo, abrirItem } = usePicking(pedido, mostrar)
  const fin = useFinalizar(pedido, mostrar)
  const volver = useVolver()
  // Con el teclado abierto la pantalla queda a la mitad: contadores y pie se esconden
  // para que entren los resultados (vuelven solos al cerrarlo)
  const teclado = useTecladoAbierto()

  if (!pedido || pedido.cierrePendiente) return <Marco titulo="Buscar artículo">{toast}<PedidoNoDisponible cargando={cargando} finalizado={pedido?.cierrePendiente} /></Marco>
  const { progreso } = pedido
  const lineaDe = (articuloId: string) => pedido.pedidos_detalle.find((i) => i.articulo_id === articuloId)
  const enPedido = new Set(pedido.pedidos_detalle.map((i) => i.articulo_id))

  return (
    <Marco titulo="Buscar artículo">
      {toast}
      {!teclado && (
        <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "14px 16px" }}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 4 }}>{pedido.numero_pedido} · {clienteDe(pedido)}</div>
          <Contadores pendientes={progreso.pendientes} ok={progreso.completos} faltantes={progreso.faltantes} />
        </div>
      )}
      <PanelBuscar
        placeholder="Escanear EAN o buscar artículo..."
        vacio={{ icono: "📱", texto: <>Escaneá el código de barras<br />o escribí para buscar</> }}
        mostrar={mostrar}
        priorizar={(art) => enPedido.has(art.id)}
        decorar={(art) => {
          const l = lineaDe(art.id)
          if (!l) return null
          const listo = estadoDe(l) === "COMPLETO" || estadoDe(l) === "PARCIAL"
          return {
            bg: listo ? C.greenL : C.orangeL, borde: listo ? C.greenB : C.orangeB,
            leyenda: <span style={{ color: listo ? C.green : C.orange }}>Pedido: {l.cantidad} u · {estadoDe(l)}</span>,
          }
        }}
        onElegir={(art) => {
          const l = lineaDe(art.id)
          if (!l) { mostrar(`"${art.descripcion}" no está en este pedido`, "err"); return }
          const otro = tomadoPorOtro(pedido, l.id, yo)
          if (otro) { mostrar(`🔒 Ya lo preparó ${otro}`, "err"); return }
          abrirItem(l, { replace: true }) // confirmar vuelve a la lista (como la web)
        }}
        onCodigo={(c) => { const det = resolverCodigo(c); if (det) abrirItem(det, { replace: true }) }}
      />
      {!teclado && (
        <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 10 }}>
          <button onClick={() => volver()} style={{ flex: 1, background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "19px 0", borderRadius: 18, border: `1.5px solid ${C.border}` }}>📋 Lista</button>
          <BotonFinalizar pedido={pedido} etiqueta="Finalizar" onClick={() => fin.pedir()} />
        </div>
      )}
      {fin.nodo(1)}
    </Marco>
  )
}

// ─── /preparar/:id/item/:detId — cantidad ────────────────────────────────────

export function PedidoItem() {
  const { id, detId } = useParams()
  const navigate = useNavigate()
  const { pedido, cargando } = usePedido(id)
  const { toast, mostrar } = useToast()
  const { marcar } = usePicking(pedido, mostrar)
  const volver = useVolver()
  const item = pedido?.pedidos_detalle.find((d) => d.id === detId)

  if (!pedido || !item?.articulos || pedido.cierrePendiente) return <Marco titulo="Cantidad">{toast}<PedidoNoDisponible cargando={cargando} finalizado={pedido?.cierrePendiente} /></Marco>

  const guardar = async (escrita: number, faltante: boolean) => {
    const { cantidad, esFaltante } = marcaPicking(escrita, faltante) // 0 = faltante
    if (await marcar(item, cantidad, esFaltante)) {
      dejarAviso(esFaltante ? "Marcado como faltante" : "✓ Guardado")
      volver()
    }
  }
  return (
    <Marco titulo="Cantidad">
      {toast}
      <PanelCantidad
        articulo={item.articulos}
        titulo="Artículo encontrado"
        etiquetaInput="Cantidad que separaste físicamente:"
        // P2-16: arranca VACÍA; el operario escribe lo que contó (0 = faltante)
        inicial=""
        exigirCantidad
        ayudaInput="Escribí lo que contaste · 0 = faltante"
        mostrar={mostrar}
        resumenTeclado={<div style={{ color: C.orange, fontSize: 14, fontWeight: 700, marginTop: 2 }}>Pedida: {item.cantidad}</div>}
        cabecera={
          <div style={{ background: C.orangeL, border: `1.5px solid ${C.orangeB}`, borderRadius: 16, padding: "16px 20px", textAlign: "center" }}>
            <div style={{ color: C.orange, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Cantidad pedida</div>
            <div style={{ color: C.orange, fontWeight: 800, fontSize: 52, lineHeight: 1.1 }}>{item.cantidad}</div>
          </div>
        }
        onConfirmar={(c) => void guardar(c, false)}
        onFaltante={() => void guardar(0, true)}
        onVolverBuscar={() => navigate(`/preparar/${pedido.id}/buscar`, { replace: true })}
      />
    </Marco>
  )
}

// ─── /preparar/:id/faltantes ─────────────────────────────────────────────────

export function PedidoFaltantes() {
  const { id } = useParams()
  const { pedido, cargando } = usePedido(id)
  const { toast, mostrar } = useToast()
  const { marcar, resolverCodigo, abrirItem } = usePicking(pedido, mostrar)
  const volver = useVolver()
  const abrirFicha = useAbrirFicha()
  const respaldoFicha = useMemo(() => respaldoDe(pedido), [pedido])
  useLector({ enabled: !!pedido, onCodigo: (c) => { const det = resolverCodigo(c); if (det) abrirItem(det, { replace: true }) } })

  if (!pedido || pedido.cierrePendiente) return <Marco titulo="Faltantes">{toast}<PedidoNoDisponible cargando={cargando} finalizado={pedido?.cierrePendiente} /></Marco>
  const faltantes = pedido.pedidos_detalle.filter((i) => estadoDe(i) === "FALTANTE")
  return (
    <Marco titulo="Faltantes">
      {toast}
      <div style={{ padding: "16px 14px" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Artículos faltantes ({faltantes.length})</div>
          <div style={{ fontSize: 14, color: C.sub, marginTop: 4 }}>Swipeá hacia la izquierda para devolver a pendientes</div>
        </div>
        {faltantes.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: C.light, fontSize: 16 }}>No hay faltantes</div>}
        {faltantes.map((item) => (
          <RenglonPedido
            key={item.id} pedido={pedido} item={item} onAbrir={() => abrirFicha(item.articulo_id)}
            accion={{ fondo: C.green, icono: "↩", etiqueta: "Pendiente", onConfirmar: () => void marcar(item, 0, false).then((ok) => ok && mostrar("Devuelto a pendientes")) }}
          />
        ))}
        <button onClick={() => volver()} style={{ width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}`, marginTop: 12 }}>
          ← Volver a la lista
        </button>
      </div>
      <FichaArticulo respaldo={respaldoFicha} />
    </Marco>
  )
}
