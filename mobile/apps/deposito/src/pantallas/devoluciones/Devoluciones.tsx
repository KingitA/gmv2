import { useState } from "react"
import { useNavigate, useParams } from "react-router"
import { esQrOUrl, lecturaError, lecturaOk, useLector, useNoEnviados } from "@gm/core"
import { DS, type Devolucion } from "../../datasets"
import { buscarPorCodigo, lineaInfo, sufijoMarca } from "../../datos/busqueda"
import { useArticulos, useDevoluciones, useEncolar, useRefrescarAlEntrar } from "../../datos/hooks"
import { C, dejarAviso, Marco, Rechazos, useAvisoEntrante, useToast, useVolver } from "../../ui"
import { PanelBuscar } from "../comunes/Buscar"

// Rutas por vista (en la web: `vista` = home | scanner | resultados | confirmar):
//   /devoluciones                  listado + botón buscar
//   /devoluciones/buscar           buscar/escanear un artículo del camión
//   /devoluciones/articulo/:artId  devoluciones que traen ese artículo
//   /devoluciones/:id              confirmar recepción (vendible / no vendible)

const DATASET = DS.devoluciones
const numero = (d: Devolucion) => d.numero_devolucion || `DEV-${d.id.slice(0, 6)}`
const cliente = (d: Devolucion) => d.clientes?.razon_social || d.clientes?.nombre

/** Gatillo del lector: va directo a las devoluciones que traen ese artículo. */
function useEscaneoDevolucion(mostrar: (m: string, t?: "ok" | "err") => void, replace = false) {
  const { indice } = useArticulos()
  const navigate = useNavigate()
  return (codigo: string) => {
    if (esQrOUrl(codigo)) { lecturaError(); mostrar("QR ignorado — escaneá el código de barras", "err"); return }
    const art = buscarPorCodigo(indice, codigo)[0]
    if (!art) { lecturaError(); mostrar(`No se encontró el código ${codigo}`, "err"); return }
    lecturaOk()
    navigate(`/devoluciones/articulo/${art.id}`, { replace })
  }
}

export function Devoluciones() {
  const { devoluciones, cargando } = useDevoluciones()
  const navigate = useNavigate()
  const ops = useNoEnviados()
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)
  useRefrescarAlEntrar(DATASET)
  useLector({ onCodigo: useEscaneoDevolucion(mostrar) })
  const rechazados = ops.filter((o) => o.estado === "rechazado" && o.tipo === "devolucion.recibir")

  return (
    <Marco titulo="Devoluciones" dataset={DATASET}>
      {toast}
      <Rechazos items={rechazados} ayuda="Si la devolución sigue en la lista, abrila y confirmala de nuevo." />
      <div style={{ padding: "16px 16px 0" }}>
        <button onClick={() => navigate("/devoluciones/buscar")} style={{ width: "100%", background: C.purple, color: "#fff", fontWeight: 800, fontSize: 18, padding: "22px 0", borderRadius: 20, border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, boxShadow: "0 4px 20px rgba(147,51,234,0.35)", marginBottom: 8 }}>
          <span style={{ fontSize: 26 }}>🔍</span> Buscar artículo del camión
        </button>
        <p style={{ textAlign: "center", color: C.sub, fontSize: 13, marginBottom: 20 }}>O apuntá con la colectora y apretá el gatillo para escanear.</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <div style={{ color: C.light, fontSize: 13, fontWeight: 600 }}>o ver listado</div>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>
      </div>
      <div style={{ padding: "0 16px 20px" }}>
        {!cargando && devoluciones.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>↩️</div>
            <div style={{ color: C.sub, fontSize: 16, fontWeight: 600 }}>No hay devoluciones pendientes</div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {devoluciones.map((dev) => {
            const items = dev.devoluciones_detalle || []
            const vendibles = items.filter((i) => i.es_vendible).length
            const noVendibles = items.length - vendibles
            return (
              <button key={dev.id} onClick={() => navigate(`/devoluciones/${dev.id}`)} style={{ textAlign: "left", background: C.white, border: `1.5px solid ${C.purpleB}`, borderRadius: 20, padding: 18, width: "100%", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ color: C.text, fontWeight: 800, fontSize: 17 }}>{numero(dev)}</div>
                    <div style={{ color: C.purple, fontSize: 14, marginTop: 3 }}>{cliente(dev)}</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 999, background: C.purpleL, color: C.purple, border: `1px solid ${C.purpleB}` }}>Pendiente</span>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 14, marginBottom: 10 }}>
                  <span style={{ color: C.sub }}>📦 {items.length} artículo{items.length !== 1 ? "s" : ""}</span>
                  {vendibles > 0 && <span style={{ color: C.green, fontWeight: 600 }}>✓ {vendibles} vendible{vendibles !== 1 ? "s" : ""}</span>}
                  {noVendibles > 0 && <span style={{ color: C.red, fontWeight: 600 }}>✕ {noVendibles} no vendible{noVendibles !== 1 ? "s" : ""}</span>}
                </div>
                <div style={{ color: C.purple, fontSize: 14, fontWeight: 700 }}>Confirmar recepción →</div>
              </button>
            )
          })}
        </div>
      </div>
    </Marco>
  )
}

export function DevolucionesBuscar() {
  const navigate = useNavigate()
  const volver = useVolver()
  const { toast, mostrar } = useToast()
  const escanear = useEscaneoDevolucion(mostrar, true)
  return (
    <Marco titulo="Buscar artículo">
      {toast}
      <PanelBuscar
        placeholder="Escanear EAN o buscar artículo del camión..."
        vacio={{ icono: "📦", texto: <>Escaneá un artículo del camión<br />para ver a qué devolución pertenece</> }}
        mostrar={mostrar}
        // replace: desde los resultados, atrás vuelve al listado; "Buscar otro" vuelve acá
        onElegir={(art) => navigate(`/devoluciones/articulo/${art.id}`, { replace: true })}
        onCodigo={escanear}
      />
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px" }}>
        <button onClick={() => volver()} style={{ width: "100%", background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "17px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>📋 Ver listado de devoluciones</button>
      </div>
    </Marco>
  )
}

export function DevolucionesArticulo() {
  const { artId } = useParams()
  const navigate = useNavigate()
  const { devoluciones } = useDevoluciones()
  const { indice } = useArticulos()
  const { toast, mostrar } = useToast()
  useLector({ onCodigo: useEscaneoDevolucion(mostrar, true) })
  const art = artId ? indice.porId.get(artId) : undefined
  const coincidencias = devoluciones.flatMap((dev) => dev.devoluciones_detalle.filter((det) => det.articulos?.id === artId).map((detalle) => ({ dev, detalle })))

  return (
    <Marco titulo="Devoluciones">
      {toast}
      <div style={{ padding: "16px 14px" }}>
        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 18, padding: 16, marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Artículo buscado</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{art ? `${art.descripcion}${sufijoMarca(art)}` : coincidencias[0]?.detalle.articulos.descripcion ?? "Artículo"}</div>
          {art && <div style={{ fontSize: 13, color: C.sub, fontFamily: "monospace", marginTop: 4 }}>{lineaInfo(art)}</div>}
        </div>
        {coincidencias.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.sub }}>Este artículo no está en ninguna devolución pendiente</div>
          </div>
        ) : (
          <>
            <div style={{ color: C.purple, fontSize: 15, marginBottom: 12, fontWeight: 700 }}>{coincidencias.length} devolución{coincidencias.length > 1 ? "es" : ""} con este artículo:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {coincidencias.map(({ dev, detalle }) => (
                <button key={`${dev.id}-${detalle.id}`} onClick={() => navigate(`/devoluciones/${dev.id}`)} style={{ textAlign: "left", background: C.white, border: `1.5px solid ${C.purpleB}`, borderRadius: 18, padding: 16, width: "100%", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ color: C.text, fontWeight: 800, fontSize: 17 }}>{numero(dev)}</div>
                      <div style={{ color: C.purple, fontSize: 14, marginTop: 3 }}>{cliente(dev)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: C.text, fontWeight: 800, fontSize: 24 }}>{detalle.cantidad}</div>
                      <div style={{ color: C.light, fontSize: 12 }}>unidades</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ fontSize: 13, padding: "4px 12px", borderRadius: 999, background: detalle.es_vendible ? C.greenL : C.redL, color: detalle.es_vendible ? C.green : C.red, fontWeight: 600, border: `1px solid ${detalle.es_vendible ? C.greenB : C.redB}` }}>{detalle.es_vendible ? "Vendible" : "No vendible"}</span>
                    {detalle.motivo && <span style={{ fontSize: 13, color: C.sub, fontStyle: "italic" }}>{detalle.motivo}</span>}
                  </div>
                  <div style={{ color: C.purple, fontSize: 14, marginTop: 10, fontWeight: 700 }}>Confirmar esta devolución →</div>
                </button>
              ))}
            </div>
          </>
        )}
        <button onClick={() => navigate("/devoluciones/buscar", { replace: true })} style={{ width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}`, marginTop: 16 }}>← Buscar otro artículo</button>
      </div>
    </Marco>
  )
}

export function DevolucionConfirmar() {
  const { id } = useParams()
  const { devoluciones, cargando } = useDevoluciones()
  const encolar = useEncolar()
  const volver = useVolver()
  const { toast } = useToast()
  const dev = devoluciones.find((d) => d.id === id)
  const [confirmados, setConfirmados] = useState<Record<string, boolean>>({})
  const [enviado, setEnviado] = useState(false)

  if (!dev) {
    return (
      <Marco titulo="Devoluciones">
        <div style={{ padding: 24, textAlign: "center", color: C.sub }}>
          {cargando ? "Cargando..." : enviado ? "✅ Devolución confirmada" : "Esta devolución ya no está pendiente."}
          {!cargando && <button onClick={() => volver()} style={{ display: "block", marginTop: 18, width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}` }}>← Volver</button>}
        </div>
      </Marco>
    )
  }

  const confirmar = async () => {
    if (enviado) return
    setEnviado(true)
    const items_confirmados = dev.devoluciones_detalle.map((d) => ({ detalle_id: d.id, articulo_id: d.articulos.id, cantidad_recibida: d.cantidad, es_vendible: confirmados[d.id] ?? d.es_vendible }))
    await encolar("devolucion.recibir", { devolucion_id: dev.id, items_confirmados }, `Devolución ${numero(dev)} — ${cliente(dev) ?? ""}`)
    dejarAviso("✅ Devolución confirmada")
    volver()
  }

  return (
    <Marco titulo="Devoluciones">
      {toast}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "16px 18px" }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>{numero(dev)}</div>
        <div style={{ color: C.purple, fontWeight: 600, fontSize: 14, marginTop: 3 }}>{cliente(dev)}</div>
        {dev.observaciones && <div style={{ color: C.sub, fontSize: 13, marginTop: 4, fontStyle: "italic" }}>"{dev.observaciones}"</div>}
      </div>
      <div style={{ background: C.purpleL, borderBottom: `1px solid ${C.purpleB}`, padding: "10px 18px" }}>
        <div style={{ color: C.purple, fontSize: 13, fontWeight: 600 }}>⚠️ Confirmá el estado de cada artículo: ¿es vendible o no?</div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 12 }}>
          {dev.devoluciones_detalle.map((det) => {
            const esVendible = confirmados[det.id] ?? det.es_vendible
            return (
              <div key={det.id} style={{ background: esVendible ? C.greenL : C.redL, border: `1.5px solid ${esVendible ? C.greenB : C.redB}`, borderRadius: 18, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                  <span style={{ fontSize: 24 }}>{esVendible ? "✅" : "🚫"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: C.text, fontWeight: 700, fontSize: 20, lineHeight: 1.3 }}>{det.articulos.descripcion}</div>
                    <div style={{ color: C.light, fontSize: 15, fontFamily: "monospace", marginTop: 3 }}>{det.articulos.sku}</div>
                    {det.motivo && <div style={{ color: C.sub, fontSize: 14, marginTop: 4, fontStyle: "italic" }}>{det.motivo}</div>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: C.text, fontWeight: 800, fontSize: 26 }}>{det.cantidad}</div>
                    <div style={{ color: C.light, fontSize: 15 }}>unidades</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button onClick={() => setConfirmados((p) => ({ ...p, [det.id]: true }))} style={{ background: esVendible ? C.green : "#f3f4f6", color: esVendible ? "#fff" : C.light, fontWeight: 700, fontSize: 15, padding: 13, minHeight: 48, borderRadius: 14, border: "none" }}>✓ Vendible</button>
                  <button onClick={() => setConfirmados((p) => ({ ...p, [det.id]: false }))} style={{ background: !esVendible ? C.red : "#f3f4f6", color: !esVendible ? "#fff" : C.light, fontWeight: 700, fontSize: 15, padding: 13, minHeight: 48, borderRadius: 14, border: "none" }}>✕ No vendible</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 10 }}>
        <button onClick={() => volver()} style={{ flex: 1, background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "17px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>← Volver</button>
        <button onClick={() => void confirmar()} disabled={enviado} style={{ flex: 2, background: C.purple, color: "#fff", fontWeight: 800, fontSize: 17, padding: "17px 0", borderRadius: 16, border: "none", opacity: enviado ? 0.6 : 1 }}>✅ Confirmar recepción</button>
      </div>
    </Marco>
  )
}
