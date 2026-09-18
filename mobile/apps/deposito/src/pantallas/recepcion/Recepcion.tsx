import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { ErrorHttp, esQrOUrl, lecturaError, lecturaOk, useLector, useNoEnviados, useOnline, useRuntime } from "@gm/core"
import { DS } from "../../datasets"
import { buscarPorCodigo, eansDe, padEan13 } from "../../datos/busqueda"
import { useArticulos, useCatalogos, useEncolar, useRecepcion, useRecepciones, useRefrescarAlEntrar } from "../../datos/hooks"
import type { LineaRecepcion, RecepcionVista } from "../../datos/overlay"
import { BarraProgreso, C, Contadores, dejarAviso, Marco, Rechazos, SinEnviar, TarjetaSwipe, useAvisoEntrante, useToast, useVolver, Vacio } from "../../ui"
import { PanelBuscar } from "../comunes/Buscar"
import { PanelCantidad } from "../comunes/Cantidad"

const DATASET = DS.recepciones
type Mostrar = (m: string, t?: "ok" | "err") => void

/** Fecha sin corrimiento de huso: "2026-09-15" es el 15, no el 14 a las 21 h. */
const fechaAR = (f: string) => {
  const [a, m, d] = (f || "").slice(0, 10).split("-")
  return d ? `${Number(d)}/${Number(m)}/${a}` : f
}

const resumen = (r: RecepcionVista) => {
  const ok = r.lineas.filter((l) => l.estado_linea === "ok").length
  const faltantes = r.lineas.filter((l) => l.estado_linea === "faltante").length
  const pendientes = r.lineas.filter((l) => l.estado_linea === "pendiente").length
  return { ok, faltantes, pendientes, total: r.lineas.length }
}

// ─── /recibir — órdenes pendientes ───────────────────────────────────────────

export function Recepciones() {
  const { ordenes: todas, cargando } = useRecepciones()
  const navigate = useNavigate()
  const ops = useNoEnviados()
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)
  useRefrescarAlEntrar(DATASET)
  const ordenes = todas.filter((o) => !o.cierrePendiente)
  const rechazados = ops.filter((o) => o.estado === "rechazado" && o.tipo === "recepcion.cerrar")

  return (
    <Marco titulo="Recibir Mercadería" dataset={DATASET}>
      {toast}
      <Rechazos items={rechazados} ayuda="La orden sigue en la lista: abrila y resolvé lo que falta antes de finalizarla de nuevo." />
      <div style={{ padding: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{ordenes.length} {ordenes.length === 1 ? "orden pendiente" : "órdenes pendientes"}</div>
          <div style={{ fontSize: 13, color: C.sub }}>Seleccioná una orden para recibir</div>
        </div>
        {!cargando && ordenes.length === 0 && <Vacio icono="🚚">No hay órdenes pendientes</Vacio>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ordenes.map((r) => {
            const o = r.orden
            const enProgreso = o.recepcion?.estado === "en_proceso" || r.lineas.some((l) => l.sinEnviar) || !!r.conformidad
            const { ok } = resumen(r)
            const total = o.ordenes_compra_detalle?.length || 0
            const pct = total > 0 ? Math.round((ok / total) * 100) : 0
            return (
              <div key={o.id} style={{ background: C.white, border: `1px solid ${enProgreso ? C.orangeB : C.border}`, borderRadius: 18, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{o.numero_orden}</div>
                    <div style={{ color: C.green, fontWeight: 600, fontSize: 14, marginTop: 2 }}>🏭 {o.proveedores?.nombre}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 999, background: enProgreso ? C.orangeL : C.bg, color: enProgreso ? C.orange : C.sub, border: `1px solid ${enProgreso ? C.orangeB : C.border}` }}>
                    {enProgreso ? "En progreso" : "Pendiente"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 13, color: C.sub, marginBottom: enProgreso ? 10 : 14 }}>
                  <span>📦 {total} artículos</span>
                  <span>📅 {fechaAR(o.fecha_orden)}</span>
                </div>
                {enProgreso && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ background: C.border, borderRadius: 999, height: 6, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: C.green, borderRadius: 999, width: `${pct}%` }} />
                    </div>
                    <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>{ok}/{total} artículos recibidos</div>
                  </div>
                )}
                <button onClick={() => navigate(`/recibir/${o.id}`)} style={{ width: "100%", background: C.green, color: "#fff", fontWeight: 700, fontSize: 15, padding: 14, borderRadius: 14, border: "none" }}>
                  {enProgreso ? "Continuar recepción →" : "Iniciar recepción →"}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </Marco>
  )
}

// ─── Acciones ────────────────────────────────────────────────────────────────

const iniciadasEstaSesion = new Set<string>()

function useAccionesRecepcion(r: RecepcionVista | null, mostrar: Mostrar) {
  const encolar = useEncolar()
  const navigate = useNavigate()
  const ops = useNoEnviados()
  const { indice } = useArticulos()
  const oc = r?.orden

  // Paridad con la web: entrar a la orden crea/retoma la recepción (la OC pasa a "recibida parcial")
  useEffect(() => {
    if (!oc || oc.recepcion || r?.cierrePendiente || iniciadasEstaSesion.has(oc.id)) return
    if (ops.some((o) => o.tipo === "recepcion.iniciar" && (o.payload as { orden_compra_id: string }).orden_compra_id === oc.id)) return
    iniciadasEstaSesion.add(oc.id)
    void encolar("recepcion.iniciar", { orden_compra_id: oc.id }, `Iniciar recepción ${oc.numero_orden}`)
  }, [oc, r?.cierrePendiente, ops, encolar])

  const contar = useCallback(
    async (articuloId: string, descripcion: string, cantidadFisica: number) => {
      if (!oc) return
      const que = cantidadFisica === -1 ? "a pendientes" : cantidadFisica === 0 ? "faltante" : `${cantidadFisica} u`
      await encolar("recepcion.item", { orden_compra_id: oc.id, articulo_id: articuloId, cantidad_fisica: cantidadFisica }, `Recepción ${oc.numero_orden}: ${descripcion} → ${que}`)
    },
    [oc, encolar],
  )

  /** Código leído → id de artículo (de la OC o del catálogo: lo no pedido también se recibe). */
  const resolverCodigo = useCallback(
    (codigo: string): string | null => {
      if (!r) return null
      if (esQrOUrl(codigo)) { lecturaError(); mostrar("QR ignorado — escaneá el código de barras", "err"); return null }
      const buscado = new Set([codigo, padEan13(codigo)])
      const deLaOC = r.lineas.find((l) => l.articulo && [...eansDe(l.articulo), l.articulo.codigo_bulto || ""].some((c) => c && (buscado.has(c) || buscado.has(padEan13(c)))))
      const id = deLaOC?.articulo_id ?? buscarPorCodigo(indice, codigo)[0]?.id
      if (!id) { lecturaError(); mostrar(`No se encontró el código ${codigo}`, "err"); return null }
      lecturaOk()
      return id
    },
    [r, indice, mostrar],
  )

  const abrirItem = useCallback(
    (articuloId: string, opts: { replace?: boolean } = {}) => oc && navigate(`/recibir/${oc.id}/item/${articuloId}`, { replace: opts.replace }),
    [oc, navigate],
  )
  return { contar, resolverCodigo, abrirItem }
}

function OrdenNoDisponible({ cargando, finalizada }: { cargando: boolean; finalizada?: boolean }) {
  const navigate = useNavigate()
  if (cargando && !finalizada) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: C.light }}>Cargando orden...</div>
  return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 44, marginBottom: 10 }}>{finalizada ? "✅" : "🚚"}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{finalizada ? "Recepción finalizada" : "Esta orden ya no está pendiente de recibir"}</div>
      <div style={{ fontSize: 14, color: C.sub, marginTop: 6 }}>{finalizada ? "Quedó guardada en el equipo y se envía sola apenas haya señal." : "La finalizó otro operario o cambió en la oficina."}</div>
      <button onClick={() => navigate("/recibir", { replace: true })} style={{ marginTop: 18, width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}` }}>← Volver a la lista</button>
    </div>
  )
}

function Linea({ l, accion }: { l: LineaRecepcion; accion: { fondo: string; icono: string; etiqueta: string; onConfirmar: () => void } }) {
  const ok = l.estado_linea === "ok"
  const faltante = l.estado_linea === "faltante"
  return (
    <TarjetaSwipe bg={ok ? C.greenL : faltante ? C.redL : C.white} borde={ok ? C.greenB : faltante ? C.redB : C.border} accion={accion}>
      <div style={{ width: 13, height: 13, borderRadius: "50%", background: ok ? C.green : faltante ? C.red : "#fbbf24", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 22, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {l.fuera_de_oc ? "⚠ " : ""}{l.articulo?.descripcion || l.articulo_id}{l.fuera_de_oc ? " (NO PEDIDO)" : ""}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <span style={{ color: C.light, fontSize: 15, fontFamily: "monospace" }}>{l.articulo?.sku}</span>
          {l.sinEnviar && <SinEnviar />}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {ok ? (
          <><div style={{ color: C.green, fontWeight: 800, fontSize: 27 }}>{l.cantidad_fisica}</div><div style={{ color: C.light, fontSize: 15 }}>de {l.cantidad_oc}</div></>
        ) : faltante ? (
          <div style={{ color: C.red, fontWeight: 700, fontSize: 16 }}>FALTANTE</div>
        ) : (
          <><div style={{ color: C.text, fontWeight: 800, fontSize: 27 }}>{l.cantidad_oc}</div><div style={{ color: C.light, fontSize: 15 }}>esperadas</div></>
        )}
      </div>
    </TarjetaSwipe>
  )
}

function useFinalizarRecepcion(r: RecepcionVista | null, mostrar: Mostrar) {
  const encolar = useEncolar()
  const volver = useVolver()
  return (pasos = 1) => {
    if (!r) return
    const pend = resumen(r).pendientes
    if (pend > 0) { mostrar(`Faltan ${pend} artículos por escanear o marcar`, "err"); return }
    void encolar("recepcion.cerrar", { orden_compra_id: r.orden.id }, `Finalizar recepción ${r.orden.numero_orden} — ${r.orden.proveedores?.nombre ?? ""}`).then(() => {
      dejarAviso("✅ Recepción finalizada")
      volver(pasos)
    })
  }
}

// ─── Control de bultos (compuerta previa al escaneo, igual que la web) ───────

function ControlBultos({ r, mostrar }: { r: RecepcionVista; mostrar: Mostrar }) {
  const encolar = useEncolar()
  const { transportes } = useCatalogos()
  const [transporte, setTransporte] = useState("")
  const [declarados, setDeclarados] = useState("")
  const [recibidos, setRecibidos] = useState("")
  const [obs, setObs] = useState("")
  const decl = parseInt(declarados) || 0
  const recib = parseInt(recibidos) || 0
  const difieren = decl > 0 && recibidos !== "" && decl !== recib

  const guardar = (estado: "conforme" | "no_conforme" | "omitida") => {
    if (estado !== "omitida") {
      if (decl <= 0 || recib < 0) { mostrar("Cargá los bultos del remito y los contados", "err"); return }
      if (estado === "no_conforme" && !obs.trim()) { mostrar("Si faltan bultos, la observación es obligatoria", "err"); return }
    }
    void encolar(
      "recepcion.conformidad",
      {
        orden_compra_id: r.orden.id,
        conformidad: {
          transporte_id: transporte || null,
          bultos_declarados: estado === "omitida" ? null : decl,
          bultos_recibidos: estado === "omitida" ? null : recib,
          estado, observaciones: obs || null,
        },
      },
      `Recepción ${r.orden.numero_orden}: control de bultos (${estado.replace("_", " ")})`,
    ).then(() => mostrar(estado === "omitida" ? "Control salteado (quedó registrado)" : "✓ Control de bultos registrado"))
  }

  const campo = { width: "100%", background: C.bg, color: C.text, fontSize: 32, fontWeight: 800, textAlign: "center" as const, borderRadius: 12, padding: 12, border: `2px solid ${C.border}`, outline: "none", boxSizing: "border-box" as const }
  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 20, padding: 20 }}>
        <div style={{ fontSize: 12, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Antes de escanear</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>🚚 Control de bultos</div>
        <div style={{ fontSize: 14, color: C.sub, marginTop: 6, lineHeight: 1.4 }}>Contá los bultos contra el remito del transporte antes de firmar. Si faltan, quedará registrado para reclamar al transporte.</div>
      </div>
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 20, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ color: C.sub, fontSize: 14, marginBottom: 6 }}>Transporte</div>
          <select value={transporte} onChange={(e) => setTransporte(e.target.value)} style={{ width: "100%", background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "14px 12px", fontSize: 16, color: C.text, fontWeight: 600 }}>
            <option value="">Sin transporte / retiro propio</option>
            {transportes.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ color: C.sub, fontSize: 14, marginBottom: 6 }}>Bultos según remito</div>
            <input type="number" inputMode="numeric" value={declarados} onChange={(e) => setDeclarados(e.target.value)} style={campo} />
          </div>
          <div>
            <div style={{ color: C.sub, fontSize: 14, marginBottom: 6 }}>Bultos contados</div>
            <input type="number" inputMode="numeric" value={recibidos} onChange={(e) => setRecibidos(e.target.value)} style={{ ...campo, background: difieren ? C.redL : C.bg, color: difieren ? C.red : C.text, border: `2px solid ${difieren ? C.redB : C.border}` }} />
          </div>
        </div>
        {difieren && (
          <div style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: C.red, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>⚠ Faltan {Math.abs(decl - recib)} bulto{Math.abs(decl - recib) !== 1 ? "s" : ""} — NO firmes conforme. Detallá qué pasó:</div>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Ej: llegaron 18 de 20 bultos, faltan 2 cajas de..." style={{ width: "100%", background: C.white, border: `1.5px solid ${C.redB}`, borderRadius: 10, padding: 10, fontSize: 15, boxSizing: "border-box" }} />
          </div>
        )}
      </div>
      <button onClick={() => guardar(difieren ? "no_conforme" : "conforme")} style={{ background: difieren ? C.orange : C.green, color: "#fff", fontWeight: 800, fontSize: 19, padding: 20, borderRadius: 20, border: "none" }}>
        {difieren ? "⚠ Registrar con faltante de bultos" : "✓ Bultos OK — empezar a escanear"}
      </button>
      <button onClick={() => guardar("omitida")} style={{ background: C.white, color: C.sub, fontWeight: 600, padding: 14, borderRadius: 16, border: `1.5px solid ${C.border}`, fontSize: 15 }}>Saltear control (queda registrado)</button>
      <div style={{ color: C.light, fontSize: 13, textAlign: "center" }}>Después sacale foto al remito firmado desde "Documentos"</div>
    </div>
  )
}

// ─── /recibir/:id — lista principal ──────────────────────────────────────────

export function Recepcion() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { recepcion: r, cargando } = useRecepcion(id)
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)
  const { contar, resolverCodigo, abrirItem } = useAccionesRecepcion(r, mostrar)
  const finalizar = useFinalizarRecepcion(r, mostrar)
  const online = useOnline()
  const conBultos = !!r && !r.cierrePendiente && !r.conformidad
  useLector({ enabled: !!r && !conBultos, onCodigo: (c) => { const a = resolverCodigo(c); if (a) abrirItem(a) } })

  if (!r || r.cierrePendiente) return <Marco titulo="Recibir Mercadería" dataset={DATASET}>{toast}<OrdenNoDisponible cargando={cargando} finalizada={r?.cierrePendiente} /></Marco>
  if (conBultos) return <Marco titulo="Recibir Mercadería" dataset={DATASET}>{toast}<ControlBultos r={r} mostrar={mostrar} /></Marco>

  const s = resumen(r)
  const pendientes = r.lineas.filter((l) => l.estado_linea === "pendiente")
  const recibidos = r.lineas.filter((l) => l.estado_linea === "ok")
  const aFaltante = (l: LineaRecepcion) => ({
    fondo: C.red, icono: "✕", etiqueta: "Faltante",
    onConfirmar: () => void contar(l.articulo_id, l.articulo?.descripcion ?? "artículo", 0).then(() => mostrar("Marcado como faltante")),
  })
  const irDocumentos = () => {
    if (!online) { mostrar("Las fotos y el OCR necesitan señal. Acercate al WiFi.", "err"); return }
    if (!r.recepcionId) { mostrar("La recepción todavía se está enviando al servidor. Probá en unos segundos.", "err"); return }
    navigate(`/recibir/${r.orden.id}/documentos`)
  }

  return (
    <Marco titulo="Recibir Mercadería" dataset={DATASET}>
      {toast}
      <Rechazos items={r.rechazos} ayuda="La lista ya muestra el estado real del servidor." />
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>{r.orden.numero_orden || "Recepción"}</div>
            <div style={{ color: C.green, fontWeight: 600, fontSize: 14, marginTop: 3 }}>🏭 {r.orden.proveedores?.nombre}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <button onClick={irDocumentos} style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 14, padding: "8px 14px", minHeight: 44, display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#1d4ed8", opacity: online ? 1 : 0.5 }}>
              📷 Documentos{r.documentos > 0 ? ` (${r.documentos})` : ""}
            </button>
            {s.faltantes > 0 && (
              <button onClick={() => navigate(`/recibir/${r.orden.id}/faltantes`)} style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 12, padding: "7px 14px", minHeight: 44, fontSize: 13, fontWeight: 700, color: C.red }}>
                ✕ {s.faltantes} faltante{s.faltantes > 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
        <BarraProgreso resueltos={s.ok + s.faltantes} total={s.total} pendientes={s.pendientes} ok={s.ok} faltantes={s.faltantes} />
      </div>

      {pendientes.length > 0 && (
        <div style={{ background: C.greenL, borderBottom: `1px solid ${C.greenB}`, padding: "10px 18px", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 16 }}>👈</span>
          <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>Swipeá para marcar faltante · Escaneá para registrar cantidad</span>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px 0" }}>
        {pendientes.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", padding: "2px 2px 10px" }}>Pendientes ({pendientes.length})</div>
            {pendientes.map((l) => <Linea key={l.articulo_id} l={l} accion={aFaltante(l)} />)}
          </>
        )}
        {recibidos.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", padding: "8px 2px 10px" }}>Recibidos ({recibidos.length})</div>
            {recibidos.map((l) => <Linea key={l.articulo_id} l={l} accion={aFaltante(l)} />)}
          </>
        )}
        <div style={{ height: 16 }} />
      </div>

      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 12 }}>
        <button onClick={() => navigate(`/recibir/${r.orden.id}/buscar`)} style={{ flex: 2, background: C.white, color: C.text, fontWeight: 700, fontSize: 18, padding: "19px 0", borderRadius: 18, border: `1.5px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔍</span> Buscar artículo
        </button>
        <button onClick={() => finalizar(1)} style={{ flex: 1, background: s.pendientes === 0 ? "#15803d" : "#f3f4f6", color: s.pendientes === 0 ? "#fff" : C.light, fontWeight: 800, fontSize: 16, padding: "19px 0", borderRadius: 18, border: s.pendientes === 0 ? "none" : `1.5px solid ${C.border}` }}>✅ Finalizar</button>
      </div>
    </Marco>
  )
}

// ─── /recibir/:id/buscar ─────────────────────────────────────────────────────

export function RecepcionBuscar() {
  const { id } = useParams()
  const { recepcion: r, cargando } = useRecepcion(id)
  const { toast, mostrar } = useToast()
  const { resolverCodigo, abrirItem } = useAccionesRecepcion(r, mostrar)
  const finalizar = useFinalizarRecepcion(r, mostrar)
  const volver = useVolver()
  if (!r || r.cierrePendiente) return <Marco titulo="Buscar artículo">{toast}<OrdenNoDisponible cargando={cargando} finalizada={r?.cierrePendiente} /></Marco>
  const s = resumen(r)
  return (
    <Marco titulo="Buscar artículo">
      {toast}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "14px 16px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{r.orden.numero_orden}</div>
        <div style={{ color: C.green, fontWeight: 600, fontSize: 14, marginTop: 2 }}>🏭 {r.orden.proveedores?.nombre}</div>
        <Contadores pendientes={s.pendientes} ok={s.ok} faltantes={s.faltantes} estilo={{ marginTop: 6 }} />
      </div>
      <PanelBuscar
        placeholder="Escanear EAN o buscar artículo..."
        vacio={{ icono: "📱", texto: <>Escaneá el código de barras<br />o escribí para buscar</> }}
        mostrar={mostrar}
        priorizar={(art) => r.lineas.some((x) => x.articulo_id === art.id)}
        decorar={(art) => {
          const l = r.lineas.find((x) => x.articulo_id === art.id)
          if (!l) return null
          const ok = l.estado_linea === "ok"
          return { bg: ok ? C.greenL : C.orangeL, borde: ok ? C.greenB : C.orangeB, leyenda: <span style={{ color: ok ? C.green : C.orange }}>OC: {l.cantidad_oc} u · {l.estado_linea.toUpperCase()}</span> }
        }}
        onElegir={(art) => abrirItem(art.id, { replace: true })}
        onCodigo={(c) => { const a = resolverCodigo(c); if (a) abrirItem(a, { replace: true }) }}
      />
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 10 }}>
        <button onClick={() => volver()} style={{ flex: 1, background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "19px 0", borderRadius: 18, border: `1.5px solid ${C.border}` }}>📋 Lista</button>
        <button onClick={() => finalizar(2)} style={{ flex: 1, background: s.pendientes === 0 ? C.green : "#e5e7eb", color: s.pendientes === 0 ? "#fff" : C.light, fontWeight: 800, fontSize: 16, padding: "19px 0", borderRadius: 18, border: "none" }}>✅ Finalizar</button>
      </div>
    </Marco>
  )
}

// ─── /recibir/:id/item/:articuloId — cantidad ────────────────────────────────

export function RecepcionItem() {
  const { id, articuloId } = useParams()
  const navigate = useNavigate()
  const { recepcion: r, cargando } = useRecepcion(id)
  const { indice } = useArticulos()
  const { toast, mostrar } = useToast()
  const { contar } = useAccionesRecepcion(r, mostrar)
  const volver = useVolver()
  const linea = r?.lineas.find((l) => l.articulo_id === articuloId)
  const articulo = linea?.articulo ?? (articuloId ? indice.porId.get(articuloId) : undefined)

  if (!r || r.cierrePendiente || !articulo || !articuloId) return <Marco titulo="Cantidad">{toast}<OrdenNoDisponible cargando={cargando} finalizada={r?.cierrePendiente} /></Marco>
  const guardar = async (cantidad: number, esFaltante: boolean) => {
    // Igual que la web: manda la cantidad tal cual (0 = el servidor la deja como faltante)
    await contar(articuloId, articulo.descripcion ?? "artículo", esFaltante ? 0 : Math.max(0, cantidad))
    dejarAviso(esFaltante ? "Marcado como faltante" : "✓ Guardado")
    volver()
  }
  const enOC = !!linea && !linea.fuera_de_oc
  return (
    <Marco titulo="Cantidad">
      {toast}
      <PanelCantidad
        articulo={{ id: articuloId, ...articulo }}
        titulo="Artículo"
        etiquetaInput="Cantidad recibida físicamente:"
        inicial={enOC ? String(linea!.cantidad_oc) : ""}
        mostrar={mostrar}
        cabecera={
          enOC ? (
            <div style={{ background: C.greenL, border: `1.5px solid ${C.greenB}`, borderRadius: 16, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ color: C.green, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Cantidad en OC</div>
              <div style={{ color: C.green, fontWeight: 800, fontSize: 52, lineHeight: 1.1 }}>{linea!.cantidad_oc}</div>
            </div>
          ) : (
            <div style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 16, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ color: C.red, fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>⚠ NO PEDIDO EN ESTA OC</div>
              <div style={{ color: C.red, fontSize: 14, marginTop: 6, lineHeight: 1.4 }}>Si lo recibís igual, queda registrado como "fuera de OC" y la oficina lo va a ver en la verificación.</div>
            </div>
          )
        }
        onConfirmar={(c) => void guardar(c, false)}
        onFaltante={() => void guardar(0, true)}
        onVolverBuscar={() => navigate(`/recibir/${r.orden.id}/buscar`, { replace: true })}
      />
    </Marco>
  )
}

// ─── /recibir/:id/faltantes ──────────────────────────────────────────────────

export function RecepcionFaltantes() {
  const { id } = useParams()
  const { recepcion: r, cargando } = useRecepcion(id)
  const { toast, mostrar } = useToast()
  const { contar, resolverCodigo, abrirItem } = useAccionesRecepcion(r, mostrar)
  const volver = useVolver()
  useLector({ enabled: !!r, onCodigo: (c) => { const a = resolverCodigo(c); if (a) abrirItem(a, { replace: true }) } })
  if (!r || r.cierrePendiente) return <Marco titulo="Faltantes">{toast}<OrdenNoDisponible cargando={cargando} finalizada={r?.cierrePendiente} /></Marco>
  const faltantes = r.lineas.filter((l) => l.estado_linea === "faltante")
  return (
    <Marco titulo="Faltantes">
      {toast}
      <div style={{ padding: "16px 14px" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Artículos faltantes ({faltantes.length})</div>
          <div style={{ fontSize: 14, color: C.sub, marginTop: 4 }}>Swipeá hacia la izquierda para devolver a pendientes</div>
        </div>
        {faltantes.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: C.light, fontSize: 16 }}>No hay faltantes</div>}
        {faltantes.map((l) => (
          <Linea key={l.articulo_id} l={l} accion={{ fondo: C.green, icono: "↩", etiqueta: "Pendiente", onConfirmar: () => void contar(l.articulo_id, l.articulo?.descripcion ?? "artículo", -1).then(() => mostrar("Devuelto a pendientes")) }} />
        ))}
        <button onClick={() => volver()} style={{ width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}`, marginTop: 12 }}>← Volver a la lista</button>
      </div>
    </Marco>
  )
}

// ─── /recibir/:id/documentos — fotos + OCR (ONLINE-ONLY, MOBILE.md §9) ───────

interface Documento {
  id: string
  tipo_documento?: string
  url_imagen?: string | null
  nombre_archivo?: string | null
  procesado?: boolean
  datos_ocr?: { comprobante?: { numero_comprobante?: string; total_factura?: number } } | null
}

export function RecepcionDocumentos() {
  const { id } = useParams()
  const { recepcion: r, cargando } = useRecepcion(id)
  const { api, sync } = useRuntime()
  const online = useOnline()
  const { toast, mostrar } = useToast()
  const [docs, setDocs] = useState<Documento[] | null>(null)
  const [tipo, setTipo] = useState<"remito" | "factura" | "foto">("remito")
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const recepcionId = r?.recepcionId ?? null
  const ordenId = r?.orden.id

  useEffect(() => {
    if (!ordenId || !online) return
    let vivo = true
    api.post<{ recepciones_documentos?: Documento[] }>("/api/deposito/recepciones", { orden_compra_id: ordenId })
      .then((rec) => vivo && setDocs((rec.recepciones_documentos || []).filter(Boolean)))
      .catch(() => vivo && mostrar("No se pudieron cargar los documentos", "err"))
    return () => { vivo = false }
  }, [api, ordenId, online, mostrar])

  if (!r) return <Marco titulo="Documentos">{toast}<OrdenNoDisponible cargando={cargando} /></Marco>

  const subir = async (file: File) => {
    if (!recepcionId) return
    setSubiendo(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("tipo_documento", tipo)
      const data = await api.postForm<{ document: Documento; ocr_processing_results?: unknown[] }>(`/api/recepciones/${recepcionId}/ocr`, fd)
      setDocs((p) => [...(p || []), data.document])
      const cnt = data.ocr_processing_results?.length || 0
      mostrar(cnt > 0 ? `📷 OCR: ${cnt} artículo${cnt > 1 ? "s" : ""} detectados` : "📷 Foto adjuntada")
      void sync.dataset(DATASET)
    } catch (e) {
      mostrar(e instanceof ErrorHttp ? e.message : "Sin señal: la foto no se subió. Probá de nuevo cerca del WiFi.", "err")
    } finally {
      setSubiendo(false)
    }
  }
  const eliminar = async (docId: string) => {
    if (!recepcionId) return
    try {
      await api.delete(`/api/recepciones/${recepcionId}/ocr`, { document_id: docId })
      setDocs((p) => (p || []).filter((d) => d.id !== docId))
      mostrar("Documento eliminado")
      void sync.dataset(DATASET)
    } catch {
      mostrar("Error al eliminar", "err")
    }
  }

  const habilitado = online && !!recepcionId
  return (
    <Marco titulo="Documentos">
      {toast}
      <div style={{ padding: "16px 14px" }}>
        {!habilitado && (
          <div style={{ background: C.yellowL, border: `1px solid ${C.yellowB}`, borderRadius: 14, padding: 14, color: C.yellow, fontWeight: 600, fontSize: 14, marginBottom: 14 }}>
            {online ? "La recepción todavía se está enviando al servidor. Probá en unos segundos." : "Sin señal: las fotos y el OCR necesitan conexión. Seguí contando y sacá las fotos cuando vuelvas a tener WiFi."}
          </div>
        )}
        <div style={{ marginBottom: 14, display: "flex", gap: 8 }}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = "" }} />
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 15, color: C.text, fontWeight: 600, flex: 1, minHeight: 48 }}>
            <option value="remito">Remito</option>
            <option value="factura">Factura</option>
            <option value="foto">Foto</option>
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={!habilitado || subiendo} style={{ background: C.green, color: "#fff", border: "none", borderRadius: 14, padding: "10px 20px", minHeight: 48, fontSize: 15, fontWeight: 700, opacity: !habilitado || subiendo ? 0.5 : 1 }}>
            {subiendo ? "⏳ OCR..." : "📷 Foto"}
          </button>
        </div>
        {docs && docs.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.light }}>
            <div style={{ fontSize: 48 }}>📎</div>
            <div style={{ fontSize: 15, marginTop: 10 }}>No hay documentos adjuntos</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Tomá una foto de la factura, remito o comprobante</div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(docs || []).map((doc) => {
            const nro = doc.datos_ocr?.comprobante?.numero_comprobante
            const total = doc.datos_ocr?.comprobante?.total_factura
            return (
              <div key={doc.id} style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 18, padding: "14px 16px", display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ fontSize: 32 }}>{doc.url_imagen && !doc.url_imagen.includes(".pdf") ? "🖼️" : "📄"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.nombre_archivo || doc.tipo_documento || "Documento"}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, background: "#e0f2fe", color: "#0369a1", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>{doc.tipo_documento}</span>
                    {nro && <span style={{ fontSize: 11, color: C.sub }}>{nro}</span>}
                    {total != null && <span style={{ fontSize: 11, color: C.sub }}>${Number(total).toFixed(2)}</span>}
                    {doc.procesado && <span style={{ fontSize: 11, background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>OCR ✓</span>}
                  </div>
                </div>
                {doc.url_imagen && (
                  <a href={doc.url_imagen} target="_blank" rel="noopener noreferrer" aria-label="Ver documento" style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 10, minWidth: 44, minHeight: 44, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>👁️</a>
                )}
                <button onClick={() => void eliminar(doc.id)} disabled={!habilitado} aria-label="Eliminar documento" style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 10, minWidth: 44, minHeight: 44, fontSize: 16 }}>🗑️</button>
              </div>
            )
          })}
        </div>
      </div>
    </Marco>
  )
}
