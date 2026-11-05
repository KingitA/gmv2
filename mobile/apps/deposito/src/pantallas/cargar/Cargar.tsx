import { useEffect, useMemo, useRef, useState } from "react"
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router"
import { esQrOUrl, lecturaError, lecturaOk, useContadoresOutbox, useLector, useNoEnviados, useOverlay, useParamEstado, useRuntime, uuidv4, type ItemOutbox } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import type { ClienteDeposito } from "../../datasets"
import { useBorradorCarga } from "../../datos/borradorCarga"
import { buscarPorCodigo, lineaInfo, sufijoMarca } from "../../datos/busqueda"
import {
  borradorDesdePayload, buscarClientes, cantidadDe, faltaParaCerrar, nuevoBorrador, OP_CARGAR, payloadCarga, ponerCantidad, quitarRenglon,
  resultadoCierre, type BorradorCarga, type ModoCarga, type PayloadCarga,
} from "../../datos/cargar"
import { useArticulos, useClientes, useEncolar } from "../../datos/hooks"
import { C, dejarAviso, Marco, useAvisoEntrante, useCampoSinRafaga, useToast, useVolver } from "../../ui"
import { PanelBuscar } from "../comunes/Buscar"
import { PanelCantidad } from "../comunes/Cantidad"

// "CARGAR PEDIDO" (05/11/2026, pedido de Juan): un pedido NUEVO armado desde el depósito.
// "Para mí" va a la cuenta personal del operario; "Para un cliente" al cliente elegido.
// Sin precios, lista ni método (los pone el servidor). No se mezcla con el picking: el
// pedido no entra a la cola de preparar.
//
// Rutas (MOBILE.md §17 "Cargar pedido"):
//   /cargar                       inicio: Para mí / Para un cliente, pedido en curso, envíos
//   /cargar/cliente               buscador de clientes (?q= replace; ?cambiar=1 = cambiar el del pedido)
//   /cargar/pedido                lo cargado (?ver=cerrar · ?ver=quitar)
//   /cargar/pedido/buscar         buscar artículo (?q= replace)
//   /cargar/pedido/item/:artId    cantidad
//   /cargar/listo                 pedido finalizado / guardado sin señal
// El pedido a medio cargar vive en el equipo (datos/borradorCarga.ts): atrás no lo pierde.

const NARANJA = { fondo: "#fff1e6", borde: "#fdba74", texto: "#c2410c" }

function DatosCliente({ c, grande = false }: { c: ClienteDeposito; grande?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: grande ? 18 : 16, fontWeight: 800, color: C.text, lineHeight: 1.25 }}>{c.nombre}</div>
      <div style={{ fontSize: 13, color: C.sub, marginTop: 3 }}>
        <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.text }}>Cód. {c.codigo || "—"}</span>
        {c.localidad && <span> · {c.localidad}</span>}
      </div>
      {c.direccion && <div style={{ fontSize: 13, color: C.sub, marginTop: 1 }}>📍 {c.direccion}</div>}
    </div>
  )
}

const paraQuien = (b: { modo: ModoCarga; cliente: ClienteDeposito | null }) => (b.modo === "propio" ? "Para mí" : b.cliente?.nombre || "Cliente")
const nArt = (n: number) => `${n} artículo${n === 1 ? "" : "s"}`

// ─── /cargar ─────────────────────────────────────────────────────────────────

export function CargarInicio() {
  const navigate = useNavigate()
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)
  const { borrador, guardar } = useBorradorCarga()
  const { clientes } = useClientes()
  const { outbox } = useRuntime()
  const ops = useNoEnviados()
  const c = useContadoresOutbox()
  const descartar = useOverlay("descartar")
  const reemplazar = useOverlay("reemplazar")
  const [modoNuevo, setModoNuevo] = useState<ModoCarga>("propio")

  // Pedidos ya cerrados: los que esperan señal, los rechazados y los enviados hoy (con su número)
  const pendientes = ops.filter((o) => o.tipo === OP_CARGAR && o.estado !== "rechazado")
  const rechazados = ops.filter((o) => o.tipo === OP_CARGAR && o.estado === "rechazado")
  const [enviados, setEnviados] = useState<ItemOutbox[]>([])
  useEffect(() => {
    let vivo = true
    const hoy = new Date().toDateString()
    void outbox.lista().then((l) => {
      if (vivo) setEnviados(l.filter((o) => o.tipo === OP_CARGAR && o.estado === "enviado" && o.enviadoAt && new Date(o.enviadoAt).toDateString() === hoy).reverse())
    })
    return () => { vivo = false }
  }, [outbox, c.pendientes, ops.length])

  const empezar = (modo: ModoCarga) => {
    if (borrador && borrador.items.length > 0) { setModoNuevo(modo); reemplazar.abrir(); return }
    if (modo === "propio") { guardar(nuevoBorrador("propio", null, uuidv4())); navigate("/cargar/pedido") }
    else navigate("/cargar/cliente")
  }
  const corregir = async (op: ItemOutbox) => {
    const p = op.payload as PayloadCarga
    if (borrador && borrador.items.length > 0) { mostrar("Primero cerrá o descartá el pedido en curso", "err"); return }
    const it = await outbox.retirar(op.key)
    if (!it) { mostrar("Ese pedido se está enviando: esperá un momento", "err"); return }
    guardar(borradorDesdePayload(p, clientes.find((x) => x.id === p.cliente_id) ?? null))
    navigate("/cargar/pedido")
  }

  const boton = (modo: ModoCarga, icono: string, texto: string, detalle: string) => (
    <button onClick={() => empezar(modo)} style={{ width: "100%", background: C.white, border: `2px solid ${NARANJA.borde}`, borderRadius: 20, padding: "22px 18px", display: "flex", alignItems: "center", gap: 16, textAlign: "left", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
      <span style={{ fontSize: 34 }}>{icono}</span>
      <span>
        <div style={{ fontSize: 21, fontWeight: 900, color: NARANJA.texto, letterSpacing: "0.02em" }}>{texto}</div>
        <div style={{ fontSize: 13, color: C.sub, marginTop: 3 }}>{detalle}</div>
      </span>
    </button>
  )

  return (
    <Marco titulo="Cargar pedido">
      {toast}
      <div style={{ padding: "18px 16px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
        {borrador && (
          <div style={{ background: NARANJA.fondo, border: `1.5px solid ${NARANJA.borde}`, borderRadius: 18, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: NARANJA.texto, textTransform: "uppercase", letterSpacing: "0.08em" }}>Pedido en curso</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginTop: 4 }}>{paraQuien(borrador)} · {nArt(borrador.items.length)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 12 }}>
              <button onClick={descartar.abrir} style={{ background: C.white, color: C.red, fontWeight: 700, fontSize: 15, padding: "14px 0", borderRadius: 14, border: `1.5px solid ${C.redB}` }}>Descartar</button>
              <button onClick={() => navigate("/cargar/pedido")} style={{ background: NARANJA.texto, color: "#fff", fontWeight: 800, fontSize: 16, padding: "14px 0", borderRadius: 14, border: "none" }}>Seguir cargando →</button>
            </div>
          </div>
        )}

        {boton("propio", "🙋", "PARA MÍ", "El pedido va a tu cuenta personal")}
        {boton("cliente", "🏪", "PARA UN CLIENTE", "Buscás el cliente y cargás los artículos")}

        {rechazados.map((op) => (
          <div key={op.key} style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 16, padding: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.red }}>⚠ No se pudo cerrar: {op.etiqueta || "pedido"}</div>
            <div style={{ fontSize: 14, color: C.text, marginTop: 4 }}>{op.error}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 10 }}>
              <button onClick={() => void outbox.descartar(op.key)} style={{ background: C.white, color: C.text, fontWeight: 700, fontSize: 14, minHeight: 46, borderRadius: 12, border: `1.5px solid ${C.border}` }}>Descartar</button>
              <button onClick={() => void corregir(op)} style={{ background: C.red, color: "#fff", fontWeight: 800, fontSize: 15, minHeight: 46, borderRadius: 12, border: "none" }}>Corregir el pedido</button>
            </div>
          </div>
        ))}
        {pendientes.map((op) => (
          <div key={op.key} style={{ background: C.yellowL, border: `1px solid ${C.yellowB}`, borderRadius: 14, padding: "12px 14px", fontSize: 14, color: C.text }}>
            ⏳ <b>{op.etiqueta || "Pedido"}</b>: guardado en el equipo, se envía solo cuando haya señal.
          </div>
        ))}
        {enviados.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: "0.08em", margin: "6px 0 8px" }}>Cargados hoy</div>
            {enviados.map((op) => {
              const r = resultadoCierre(op)
              return (
                <div key={op.key} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", marginBottom: 6, fontSize: 14, color: C.text }}>
                  ✅ {r.tipo === "ok" && r.numero_pedido ? <b>Pedido {r.numero_pedido}</b> : "Pedido"} · {(r.tipo === "ok" && r.cliente_nombre) || op.etiqueta}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Hoja abierta={descartar.abierto} onCerrar={descartar.cerrar} titulo="¿Descartar el pedido en curso?">
        <p style={{ fontSize: 15, color: C.sub, margin: "0 0 16px" }}>Se borran los {nArt(borrador?.items.length ?? 0)} cargados. No se envía nada.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button onClick={descartar.cerrar} style={{ background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "16px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>No</button>
          <button onClick={() => { guardar(null); descartar.cerrar() }} style={{ background: C.red, color: "#fff", fontWeight: 800, fontSize: 16, padding: "16px 0", borderRadius: 16, border: "none" }}>Sí, descartar</button>
        </div>
      </Hoja>

      <Hoja abierta={reemplazar.abierto} onCerrar={reemplazar.cerrar} titulo="Tenés un pedido en curso">
        <p style={{ fontSize: 15, color: C.sub, margin: "0 0 16px" }}>
          {borrador ? `${paraQuien(borrador)} · ${nArt(borrador.items.length)}.` : ""} ¿Seguís con ese o lo descartás para empezar otro?
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={() => navigate("/cargar/pedido", { replace: true })} style={{ background: NARANJA.texto, color: "#fff", fontWeight: 800, fontSize: 16, padding: "16px 0", borderRadius: 16, border: "none" }}>Seguir con el que está</button>
          <button
            onClick={() => {
              guardar(null)
              if (modoNuevo === "propio") { guardar(nuevoBorrador("propio", null, uuidv4())); navigate("/cargar/pedido", { replace: true }) }
              else navigate("/cargar/cliente", { replace: true })
            }}
            style={{ background: C.white, color: C.red, fontWeight: 700, fontSize: 15, padding: "14px 0", borderRadius: 16, border: `1.5px solid ${C.redB}` }}
          >
            Descartarlo y empezar otro
          </button>
        </div>
      </Hoja>
    </Marco>
  )
}

// ─── /cargar/cliente ─────────────────────────────────────────────────────────

export function CargarCliente() {
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const cambiarDelPedido = sp.get("cambiar") === "1"
  const { clientes, cargando, meta } = useClientes()
  const { borrador, guardar, cambiar } = useBorradorCarga()
  const [qUrl, setQUrl] = useParamEstado("q")
  const { valor: q, cambiar: setQ } = useCampoSinRafaga(qUrl)
  useEffect(() => {
    if (q === qUrl) return
    const t = setTimeout(() => setQUrl(q), 250)
    return () => clearTimeout(t)
  }, [q, qUrl, setQUrl])
  const resultados = useMemo(() => buscarClientes(clientes, q), [clientes, q])

  const elegir = (c: ClienteDeposito) => {
    if (cambiarDelPedido && borrador) cambiar((b) => ({ ...b, modo: "cliente", cliente: c }))
    else guardar(nuevoBorrador("cliente", c, uuidv4()))
    navigate("/cargar/pedido", { replace: true })
  }

  return (
    <Marco titulo="Elegir cliente">
      <div style={{ padding: "14px 16px 6px", background: C.white, borderBottom: `1px solid ${C.border}` }}>
        <input
          type="text" value={q} autoFocus placeholder="Código o nombre del cliente"
          onChange={(e) => setQ(e.target.value)}
          style={{ width: "100%", fontSize: 18, padding: "14px 16px", borderRadius: 14, border: `2px solid ${C.border}`, background: C.bg, outline: "none", boxSizing: "border-box" }}
        />
        <div style={{ fontSize: 12, color: C.light, margin: "6px 2px 4px" }}>Mirá bien el código, la localidad y la dirección antes de elegir.</div>
      </div>
      <div style={{ padding: "10px 16px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
        {!cargando && !meta?.generadoAt && clientes.length === 0 && (
          <div style={{ background: C.yellowL, border: `1px solid ${C.yellowB}`, borderRadius: 14, padding: 14, color: C.yellow, fontWeight: 600, fontSize: 14 }}>
            Todavía no se descargaron los clientes. Acercate a una zona con WiFi.
          </div>
        )}
        {q.trim().length > 0 && resultados.length === 0 && clientes.length > 0 && (
          <div style={{ textAlign: "center", color: C.light, padding: "30px 0", fontSize: 15 }}>No hay clientes con "{q.trim()}"</div>
        )}
        {!q.trim() && <div style={{ textAlign: "center", color: C.light, padding: "30px 0", fontSize: 15 }}>🔍 Escribí el código o el nombre</div>}
        {resultados.map((c) => (
          <button key={c.id} onClick={() => elegir(c)} style={{ textAlign: "left", background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "12px 14px" }}>
            <DatosCliente c={c} />
          </button>
        ))}
      </div>
    </Marco>
  )
}

// ─── /cargar/pedido ──────────────────────────────────────────────────────────

export function CargarPedido() {
  const navigate = useNavigate()
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)
  const { borrador, guardar, cambiar } = useBorradorCarga()
  const { indice } = useArticulos()
  const encolar = useEncolar()
  const { outbox } = useRuntime()
  const cerrarHoja = useOverlay("cerrar")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cerrado OK: el borrador se borra y se va a /cargar/listo; sin esto el <Navigate> de
  // "no hay borrador" ganaba la carrera y el cartel de finalizado no aparecía
  const cerrado = useRef(false)

  // Escanear acá abre la cantidad del artículo (nuevo o ya cargado)
  useLector({
    enabled: !!borrador && !enviando,
    onCodigo: (codigo) => {
      if (esQrOUrl(codigo)) { lecturaError(); mostrar("QR ignorado — escaneá el código de barras", "err"); return }
      const art = buscarPorCodigo(indice, codigo)[0]
      if (!art) { lecturaError(); mostrar(`No se encontró el código ${codigo}`, "err"); return }
      lecturaOk()
      navigate(`/cargar/pedido/item/${art.id}`)
    },
  })

  if (!borrador) return cerrado.current ? null : <Navigate to="/cargar" replace />
  const falta = faltaParaCerrar(borrador)

  const cerrarPedido = async () => {
    if (enviando || faltaParaCerrar(borrador)) return
    setEnviando(true)
    setError(null)
    try {
      const b = borrador
      const it = await encolar(OP_CARGAR, payloadCarga(b), `Cargar pedido — ${paraQuien(b)} (${nArt(b.items.length)})`)
      // Se manda enseguida y se espera la respuesta: el cartel sale recién con el OK del servidor
      await outbox.enviar({ forzar: true }).catch(() => {})
      const r = resultadoCierre(await outbox.item(it.key))
      if (r.tipo === "rechazo") {
        await outbox.descartar(it.key) // queda el pedido abierto para corregirlo (mismo local_id)
        setError(r.mensaje)
        cerrarHoja.cerrar()
        return
      }
      const sp = new URLSearchParams()
      if (r.tipo === "ok") {
        if (r.numero_pedido) sp.set("n", r.numero_pedido)
        sp.set("c", r.cliente_nombre || paraQuien(b))
      } else sp.set("sin_senal", "1")
      if (b.modo === "propio") sp.set("propio", "1")
      cerrado.current = true
      navigate(`/cargar/listo?${sp}`, { replace: true }) // reemplaza la hoja: atrás no vuelve al pedido cerrado
      guardar(null)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Marco titulo="Cargar pedido">
      {toast}
      {/* Para quién: fijo arriba, con los datos para no equivocarse */}
      <div style={{ background: NARANJA.fondo, borderBottom: `1.5px solid ${NARANJA.borde}`, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {borrador.modo === "propio" ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 900, color: NARANJA.texto }}>🙋 PARA MÍ</div>
              <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>Va a tu cuenta personal</div>
            </>
          ) : borrador.cliente ? (
            <DatosCliente c={borrador.cliente} grande />
          ) : (
            <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>Falta elegir el cliente</div>
          )}
        </div>
        {borrador.modo === "cliente" && (
          <button onClick={() => navigate("/cargar/cliente?cambiar=1")} style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "0 12px", minHeight: 44, fontSize: 13, fontWeight: 700, color: C.text, flexShrink: 0 }}>Cambiar</button>
        )}
      </div>

      {error && (
        <div style={{ background: C.redL, borderBottom: `1.5px solid ${C.redB}`, padding: "12px 16px" }}>
          <div style={{ color: C.red, fontWeight: 800, fontSize: 15 }}>⚠ No se cerró el pedido</div>
          <div style={{ color: C.text, fontSize: 14, marginTop: 4 }}>{error}</div>
          <div style={{ color: C.sub, fontSize: 13, marginTop: 4 }}>Corregí lo que dice (por ejemplo, sacá el artículo) y volvé a cerrarlo.</div>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px 0" }}>
        {borrador.items.length === 0 && (
          <div style={{ textAlign: "center", padding: "50px 20px", color: C.sub }}>
            <div style={{ fontSize: 44, marginBottom: 8 }}>📱</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Escaneá un artículo<br />o tocá "Agregar artículo"</div>
          </div>
        )}
        {borrador.items.map((i) => {
          const a = indice.porId.get(i.articulo_id)
          return (
            <div key={i.articulo_id} style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "10px 12px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => navigate(`/cargar/pedido/item/${i.articulo_id}`)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", padding: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.25 }}>{a ? `${a.descripcion}${sufijoMarca(a)}` : "Artículo que ya no está en el catálogo"}</div>
                <div style={{ fontSize: 12, color: C.light, fontFamily: "monospace", marginTop: 2 }}>{a ? a.sku : i.articulo_id.slice(0, 8)}</div>
              </button>
              <button onClick={() => navigate(`/cargar/pedido/item/${i.articulo_id}`)} aria-label="Cambiar cantidad" style={{ minWidth: 64, minHeight: 48, borderRadius: 12, border: `1.5px solid ${C.greenB}`, background: C.greenL, color: C.green, fontWeight: 800, fontSize: 20 }}>{i.cantidad}</button>
              <button onClick={() => { cambiar((b) => quitarRenglon(b, i.articulo_id)); mostrar("Artículo sacado del pedido") }} aria-label="Sacar del pedido" style={{ minWidth: 48, minHeight: 48, borderRadius: 12, border: `1.5px solid ${C.redB}`, background: C.redL, fontSize: 20 }}>🗑</button>
            </div>
          )
        })}
        <div style={{ height: 12 }} />
      </div>

      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 12 }}>
        <button onClick={() => navigate("/cargar/pedido/buscar")} style={{ flex: 1, background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: "18px 0", borderRadius: 18, border: `1.5px solid ${C.border}` }}>🔍 Agregar artículo</button>
        <button
          onClick={() => (falta ? mostrar(falta, "err") : cerrarHoja.abrir())}
          style={{ flex: 1, background: falta ? "#f3f4f6" : C.green, color: falta ? C.light : "#fff", fontWeight: 900, fontSize: 16, padding: "18px 0", borderRadius: 18, border: falta ? `1.5px solid ${C.border}` : "none" }}
        >
          ✅ CERRAR PEDIDO
        </button>
      </div>

      <Hoja abierta={cerrarHoja.abierto} onCerrar={() => { if (!enviando) cerrarHoja.cerrar() }} titulo="¿Cerrar el pedido?">
        <p style={{ fontSize: 15, color: C.sub, margin: "0 0 16px", lineHeight: 1.45 }}>
          <b style={{ color: C.text }}>{paraQuien(borrador)}</b> · {nArt(borrador.items.length)}. Después de cerrarlo ya no se puede cambiar desde acá.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button disabled={enviando} onClick={cerrarHoja.cerrar} style={{ background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "16px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>Volver</button>
          <button disabled={enviando} onClick={() => void cerrarPedido()} style={{ background: C.green, color: "#fff", fontWeight: 800, fontSize: 16, padding: "16px 0", borderRadius: 16, border: "none", opacity: enviando ? 0.7 : 1 }}>
            {enviando ? "Enviando…" : "✅ Cerrar pedido"}
          </button>
        </div>
      </Hoja>
    </Marco>
  )
}

// ─── /cargar/pedido/buscar ───────────────────────────────────────────────────

export function CargarBuscar() {
  const navigate = useNavigate()
  const { toast, mostrar } = useToast()
  const { borrador } = useBorradorCarga()
  const { indice } = useArticulos()
  if (!borrador) return <Navigate to="/cargar" replace />
  const abrir = (id: string) => navigate(`/cargar/pedido/item/${id}`, { replace: true }) // confirmar vuelve al pedido
  return (
    <Marco titulo="Agregar artículo">
      {toast}
      <PanelBuscar
        placeholder="Escanear EAN o buscar artículo..."
        vacio={{ icono: "📱", texto: <>Escaneá el código de barras<br />o escribí para buscar</> }}
        mostrar={mostrar}
        priorizar={(a) => cantidadDe(borrador, a.id) != null}
        decorar={(a) => {
          const n = cantidadDe(borrador, a.id)
          return n == null ? null : { bg: C.greenL, borde: C.greenB, leyenda: <span style={{ color: C.green }}>Ya en el pedido: {n} u</span> }
        }}
        onElegir={(a) => abrir(a.id)}
        onCodigo={(c) => {
          const a = buscarPorCodigo(indice, c)[0]
          if (!a) { lecturaError(); mostrar(`No se encontró el código ${c}`, "err"); return }
          lecturaOk()
          abrir(a.id)
        }}
      />
    </Marco>
  )
}

// ─── /cargar/pedido/item/:artId ──────────────────────────────────────────────

export function CargarItem() {
  const { artId } = useParams()
  const navigate = useNavigate()
  const { toast, mostrar } = useToast()
  const { borrador, cambiar } = useBorradorCarga()
  const { indice } = useArticulos()
  const volver = useVolver()
  if (!borrador) return <Navigate to="/cargar" replace />
  const art = artId ? indice.porId.get(artId) : undefined
  if (!art) return <Marco titulo="Cantidad">{toast}<div style={{ padding: 30, textAlign: "center", color: C.sub }}>Cargando artículo…</div></Marco>
  const ya = cantidadDe(borrador, art.id)
  return (
    <Marco titulo="Cantidad">
      {toast}
      <PanelCantidad
        articulo={art}
        titulo={ya != null ? "Ya está en el pedido" : "Agregar al pedido"}
        etiquetaInput="Cantidad que pedís:"
        ayudaInput={ya != null ? "0 = sacarlo del pedido" : undefined}
        inicial={ya != null ? String(ya) : ""}
        exigirCantidad
        mostrar={mostrar}
        cabecera={
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14, padding: "10px 14px", fontSize: 14, color: C.sub }}>
            {lineaInfo(art)} · {paraQuien(borrador)}
          </div>
        }
        resumenTeclado={ya != null ? <div style={{ color: C.green, fontSize: 14, fontWeight: 700, marginTop: 2 }}>Cargado: {ya}</div> : undefined}
        onConfirmar={(n) => {
          cambiar((b: BorradorCarga) => ponerCantidad(b, art.id, n))
          dejarAviso(n > 0 ? `✓ ${n} u — ${art.descripcion}` : "Artículo sacado del pedido")
          volver()
        }}
        onVolverBuscar={() => navigate("/cargar/pedido/buscar", { replace: true })}
      />
    </Marco>
  )
}

// ─── /cargar/listo ───────────────────────────────────────────────────────────

export function CargarListo() {
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const sinSenal = sp.get("sin_senal") === "1"
  const numero = sp.get("n")
  const para = sp.get("c")
  const propio = sp.get("propio") === "1"
  return (
    <Marco titulo="Cargar pedido">
      <div style={{ padding: "40px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 64 }}>{sinSenal ? "📶" : "✅"}</div>
        {sinSenal ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginTop: 10 }}>Sin señal</div>
            <div style={{ fontSize: 16, color: C.sub, marginTop: 8, lineHeight: 1.45 }}>El pedido quedó guardado y se envía solo cuando vuelva.<br />El número lo vas a ver en "Cargar pedido".</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 24, fontWeight: 900, color: C.green, marginTop: 10 }}>Pedido finalizado</div>
            {numero && <div style={{ fontSize: 30, fontWeight: 900, color: C.text, marginTop: 8, fontFamily: "monospace" }}>N° {numero}</div>}
            {para && <div style={{ fontSize: 16, color: C.text, marginTop: 6, fontWeight: 600 }}>{propio ? "Para tu cuenta personal" : para}</div>}
            <div style={{ fontSize: 16, color: C.sub, marginTop: 12, lineHeight: 1.45 }}>Las facturas se envían luego desde oficina.</div>
          </>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 30 }}>
          <button onClick={() => navigate("/cargar", { replace: true })} style={{ background: NARANJA.texto, color: "#fff", fontWeight: 800, fontSize: 17, padding: "17px 0", borderRadius: 18, border: "none" }}>Cargar otro pedido</button>
          <button onClick={() => navigate("/", { replace: true })} style={{ background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: "16px 0", borderRadius: 18, border: `1.5px solid ${C.border}` }}>Volver al inicio</button>
        </div>
      </div>
    </Marco>
  )
}
