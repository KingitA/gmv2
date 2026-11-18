import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { useNavigate, useParams } from "react-router"
import { ErrorHttp, esQrOUrl, lecturaError, lecturaOk, useLector, useNoEnviados, useOnline, useOverlay, useRuntime } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { fecha, moneda, parseMonto } from "@gm/formato"
import { aUnidadesBase, cant, cantidadConUnidad, textoCantidad, type UnidadConteo } from "@gm/deposito"
import { comprimirFoto } from "@gm/cheques/foto"
import { DS } from "../../datasets"
import { borrarBorradorBultos, faltaParaRegistrarBultos, guardarBorradorBultos, leerBorradorBultos } from "../../datos/borradorBultos"
import { buscarPorCodigo, eansDe, padEan13 } from "../../datos/busqueda"
import { lecturaDeDocumento, LIMITE_SUBIDA_BYTES, megas, revisarArchivo, type DocumentoRecepcion } from "../../datos/documentos"
import { useArticulos, useCatalogos, useEncolar, useRecepcion, useRecepciones, useRefrescarAlEntrar } from "../../datos/hooks"
import { lineaIncompleta, resumenCierre, textoFalta, unidadesFaltantes, type LineaRecepcion, type RecepcionVista } from "../../datos/overlay"
import { BarraProgreso, C, Contadores, dejarAviso, DESCRIPCION, Marco, META, Rechazos, SinEnviar, TarjetaSwipe, TITULO_GRUPO, useAvisoEntrante, useTecladoAbierto, useToast, useVolver, Vacio } from "../../ui"
import { FichaArticulo, useAbrirFicha, useFichaAbierta, type DatosFicha } from "../comunes/FichaArticulo"
import { PanelBuscar } from "../comunes/Buscar"
import { useDadoDeBaja } from "../comunes/DadoDeBaja"
import { PanelCantidad } from "../comunes/Cantidad"

const DATASET = DS.recepciones
type Mostrar = (m: string, t?: "ok" | "err") => void

/** "15/09/2026" sin corrimiento de huso: "2026-09-15" es el 15, no el 14 a las 21 h. */
const fechaAR = (f: string) => fecha(f) || f

const resumen = (r: RecepcionVista) => {
  const ok = r.lineas.filter((l) => l.estado_linea === "ok").length
  const faltantes = r.lineas.filter((l) => l.estado_linea === "faltante").length
  const pendientes = r.lineas.filter((l) => l.estado_linea === "pendiente").length
  // Contadas con menos de lo pedido (E-92): están resueltas, pero NO completas
  const incompletas = r.lineas.filter(lineaIncompleta).length
  return { ok, faltantes, pendientes, incompletas, total: r.lineas.length }
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
            const res = resumen(r)
            const ok = res.ok - res.incompletas
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
                    <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>{ok}/{total} artículos completos{res.incompletas > 0 ? ` · ${res.incompletas} con menos de lo pedido` : ""}</div>
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
  // Código de un artículo dado de baja ⇒ "¿Reactivarlo?" (MOBILE.md §17)
  const baja = useDadoDeBaja(mostrar)

  // Paridad con la web: entrar a la orden crea/retoma la recepción (la OC pasa a "recibida parcial")
  useEffect(() => {
    if (!oc || oc.recepcion || r?.cierrePendiente || iniciadasEstaSesion.has(oc.id)) return
    if (ops.some((o) => o.tipo === "recepcion.iniciar" && (o.payload as { orden_compra_id: string }).orden_compra_id === oc.id)) return
    iniciadasEstaSesion.add(oc.id)
    void encolar("recepcion.iniciar", { orden_compra_id: oc.id }, `Iniciar recepción ${oc.numero_orden}`)
  }, [oc, r?.cierrePendiente, ops, encolar])

  const contar = useCallback(
    // `unidad`: en qué se contó (bulto | unidad). El servidor convierte a unidades al finalizar (E-30).
    async (articuloId: string, descripcion: string, cantidadFisica: number, unidad?: UnidadConteo) => {
      if (!oc) return
      const que = cantidadFisica === -1 ? "a pendientes" : cantidadFisica === 0 ? "faltante" : cantidadConUnidad(cantidadFisica, unidad ?? "unidad")
      const payload = { orden_compra_id: oc.id, articulo_id: articuloId, cantidad_fisica: cantidadFisica, ...(cantidadFisica > 0 && unidad ? { unidad } : {}) }
      await encolar("recepcion.item", payload, `Recepción ${oc.numero_orden}: ${descripcion} → ${que}`)
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
      if (!id) { void baja.noEncontrado(codigo); return null }
      lecturaOk()
      return id
    },
    [r, indice, mostrar, baja.noEncontrado],
  )

  const abrirItem = useCallback(
    (articuloId: string, opts: { replace?: boolean } = {}) => oc && navigate(`/recibir/${oc.id}/item/${articuloId}`, { replace: opts.replace }),
    [oc, navigate],
  )
  return { contar, resolverCodigo, abrirItem, baja }
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

/**
 * Renglón de la recepción. Tocarlo abre la pantalla de CANTIDAD (lo que el operario viene a
 * hacer); la ficha del artículo queda en el botón ⓘ de la derecha.
 * Una línea contada con menos de lo pedido va en ÁMBAR ("1 de 2 bultos — faltan 36 u"): verde
 * es solo lo que llegó completo (E-92).
 */
function Linea({ l, accion, onAbrir, onFicha }: { l: LineaRecepcion; accion: { fondo: string; icono: string; etiqueta: string; onConfirmar: () => void }; onAbrir?: () => void; onFicha?: () => void }) {
  const ok = l.estado_linea === "ok"
  const faltante = l.estado_linea === "faltante"
  const incompleta = lineaIncompleta(l)
  const color = incompleta ? C.orange : C.green
  return (
    <TarjetaSwipe
      bg={incompleta ? C.orangeL : ok ? C.greenL : faltante ? C.redL : C.white}
      borde={incompleta ? C.orangeB : ok ? C.greenB : faltante ? C.redB : C.border}
      accion={accion} onAbrir={onAbrir}
    >
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: incompleta ? C.orange : ok ? C.green : faltante ? C.red : "#fbbf24", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={DESCRIPCION}>
          {l.fuera_de_oc ? "⚠ " : ""}{l.articulo?.descripcion || l.articulo_id}{l.fuera_de_oc ? " (NO PEDIDO)" : ""}
        </div>
        <div style={META}>
          <span style={{ color: C.light, fontSize: 13, fontFamily: "monospace", flexShrink: 0 }}>{l.articulo?.sku}</span>
          {l.sinEnviar && <SinEnviar />}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {incompleta ? (
          <>
            <div style={{ color, fontWeight: 800, fontSize: 18, lineHeight: 1.15 }}>
              {l.unidadConteo === l.unidadOC ? `${cant(l.cantidad_fisica)} de ${cantidadConUnidad(l.cantidad_oc, l.unidadOC)}` : `${cantidadConUnidad(l.cantidad_fisica, l.unidadConteo)} de ${cantidadConUnidad(l.cantidad_oc, l.unidadOC)}`}
            </div>
            <div style={{ color, fontSize: 13, fontWeight: 800 }}>faltan {cant(unidadesFaltantes(l))} u</div>
          </>
        ) : ok ? (
          <>
            <div style={{ color: C.green, fontWeight: 800, fontSize: 22, lineHeight: 1.1 }}>{cantidadConUnidad(l.cantidad_fisica, l.unidadConteo)}</div>
            {l.unidadConteo === "bulto" && <div style={{ color: l.sinUnidadesPorBulto ? C.red : C.green, fontSize: 12, fontWeight: 700 }}>{l.sinUnidadesPorBulto ? "⚠ sin u. por bulto" : `= ${cant(l.fisicaUnidades)} u`}</div>}
            {!l.fuera_de_oc && <div style={{ color: C.light, fontSize: 12 }}>de {cantidadConUnidad(l.cantidad_oc, l.unidadOC)}</div>}
          </>
        ) : faltante ? (
          <div style={{ color: C.red, fontWeight: 800, fontSize: 13 }}>FALTANTE</div>
        ) : (
          <>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 22, lineHeight: 1.1 }}>{cantidadConUnidad(l.cantidad_oc, l.unidadOC)}</div>
            <div style={{ color: l.sinUnidadesPorBulto ? C.red : C.light, fontSize: 12 }}>{l.unidadOC === "bulto" ? (l.sinUnidadesPorBulto ? "⚠ sin u. por bulto" : `× ${cant(l.unidadesPorBulto)} = ${cant(l.ocUnidades)} u`) : "esperadas"}</div>
          </>
        )}
      </div>
      {onFicha && (
        <button
          onClick={(e) => { e.stopPropagation(); onFicha() }}
          aria-label="Ver la ficha del artículo"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.white, color: C.sub, fontSize: 18, fontWeight: 800 }}
        >
          ⓘ
        </button>
      )}
    </TarjetaSwipe>
  )
}

/** Datos para la ficha de un artículo que no esté en el catálogo replicado (p. ej. fuera de OC). */
const respaldoDe = (r: RecepcionVista | null) => (articuloId: string): DatosFicha | undefined => {
  const a = r?.lineas.find((l) => l.articulo_id === articuloId)?.articulo
  return a ? { id: articuloId, descripcion: a.descripcion, sku: a.sku, unidades_por_bulto: a.unidades_por_bulto, ean13: a.ean13 } : undefined
}

/**
 * Finalizar la entrega. Si falta algo de lo pedido (líneas marcadas faltante, o contadas con
 * menos) NO finaliza de una: abre una hoja con qué llegó y qué falta, y el operario confirma.
 * Antes finalizaba sin preguntar y la línea incompleta quedaba verde (E-92, E-93).
 * `pedir(pasos)`: cuántas pantallas hay que volver después (1 desde la lista, 2 desde Buscar).
 */
function useFinalizarRecepcion(r: RecepcionVista | null, mostrar: Mostrar) {
  const encolar = useEncolar()
  const volver = useVolver()
  const confirmar = useOverlay("finalizar")
  const pasosRef = useRef(1)
  const [enviando, setEnviando] = useState(false)
  const cierre = useMemo(() => (r ? resumenCierre(r) : null), [r])

  const enviar = (pasos: number) => {
    if (!r || enviando) return
    setEnviando(true)
    void encolar("recepcion.cerrar", { orden_compra_id: r.orden.id }, `Finalizar recepción ${r.orden.numero_orden} — ${r.orden.proveedores?.nombre ?? ""}`).then(() => {
      dejarAviso(cierre?.hayFaltantes ? "✅ Entrega finalizada — la orden queda abierta por lo que falta" : "✅ Recepción finalizada")
      volver(pasos)
    }).finally(() => setEnviando(false))
  }

  const pedir = (pasos = 1) => {
    if (!r || !cierre) return
    if (cierre.pendientes > 0) { mostrar(`Faltan ${cierre.pendientes} artículos por escanear o marcar`, "err"); return }
    if (!cierre.hayFaltantes) { enviar(pasos); return }
    pasosRef.current = pasos
    confirmar.abrir()
  }

  const llego = cierre ? [
    cierre.completas > 0 ? `${cierre.completas} artículo${cierre.completas === 1 ? "" : "s"} completo${cierre.completas === 1 ? "" : "s"}` : null,
    cierre.incompletas.length > 0 ? `${cierre.incompletas.length} en parte` : null,
    cierre.fueraDeOC > 0 ? `${cierre.fueraDeOC} que no estaba${cierre.fueraDeOC === 1 ? "" : "n"} pedido${cierre.fueraDeOC === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ") || "nada" : ""

  const hoja = (
    <Hoja abierta={confirmar.abierto && !!cierre} onCerrar={confirmar.cerrar} titulo="¿Finalizar con faltantes?">
      {cierre && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: C.greenL, border: `1.5px solid ${C.greenB}`, borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.green, textTransform: "uppercase", letterSpacing: "0.08em" }}>Llegó</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginTop: 2 }}>{llego}</div>
          </div>
          <div style={{ background: C.orangeL, border: `1.5px solid ${C.orangeB}`, borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.orange, textTransform: "uppercase", letterSpacing: "0.08em" }}>Falta</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6, maxHeight: "34vh", overflow: "auto" }}>
              {[...cierre.incompletas, ...cierre.noLlegaron].map((x) => (
                <div key={x.articulo_id} style={{ fontSize: 15, color: C.text, lineHeight: 1.3 }}>
                  <b>{x.falta}</b> de {x.descripcion}
                  <span style={{ color: C.sub, fontSize: 13 }}> — {x.llego === "nada" ? "no llegó nada" : `llegó ${x.llego}`}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 15, color: C.text, fontWeight: 600, lineHeight: 1.35 }}>
            La orden queda abierta para recibir el resto. Si contaste mal algo, volvé y corregilo antes de finalizar.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={confirmar.cerrar} disabled={enviando} style={{ flex: 1, background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: "17px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>Volver a contar</button>
            {/* +1: la hoja también es una entrada del historial */}
            <button onClick={() => enviar(pasosRef.current + 1)} disabled={enviando} style={{ flex: 1.3, background: C.orange, color: "#fff", fontWeight: 800, fontSize: 16, padding: "17px 0", borderRadius: 16, border: "none", opacity: enviando ? 0.6 : 1 }}>
              {enviando ? "Finalizando…" : "Sí, finalizar así"}
            </button>
          </div>
        </div>
      )}
    </Hoja>
  )
  return { pedir, hoja }
}

// ─── Control de bultos (compuerta previa al escaneo, igual que la web) ───────

function ControlBultos({ r, mostrar }: { r: RecepcionVista; mostrar: Mostrar }) {
  const encolar = useEncolar()
  const { transportes } = useCatalogos()
  const ordenId = r.orden.id
  // Lo escrito se guarda en el equipo en cada tecla: salir con "atrás" (con el teclado abierto es
  // lo más fácil de tocar sin querer) no lo pierde, y al volver está como se dejó.
  const [borrador, setBorrador] = useState(() => leerBorradorBultos(ordenId))
  const cambiar = (c: Partial<typeof borrador>) => setBorrador((p) => { const n = { ...p, ...c }; guardarBorradorBultos(ordenId, n); return n })
  const { transporte, declarados, recibidos, obs } = borrador
  const saltear = useOverlay("saltear-bultos")
  const [guardando, setGuardando] = useState(false)
  const decl = Math.trunc(parseMonto(declarados) ?? 0)
  const recib = Math.trunc(parseMonto(recibidos) ?? 0)
  const difieren = declarados !== "" && recibidos !== "" && decl !== recib
  // "Bultos OK" queda deshabilitado hasta tener LOS DOS números (y la observación si no coinciden)
  const falta = faltaParaRegistrarBultos(borrador)

  const guardar = (estado: "conforme" | "no_conforme" | "omitida") => {
    if (guardando) return
    if (estado !== "omitida" && falta) { mostrar(falta, "err"); return }
    setGuardando(true)
    void encolar(
      "recepcion.conformidad",
      {
        orden_compra_id: ordenId,
        conformidad: {
          transporte_id: transporte || null,
          bultos_declarados: estado === "omitida" ? null : decl,
          bultos_recibidos: estado === "omitida" ? null : recib,
          estado, observaciones: obs || null,
        },
      },
      `Recepción ${r.orden.numero_orden}: control de bultos (${estado.replace("_", " ")})`,
    ).then(() => {
      borrarBorradorBultos(ordenId)
      mostrar(estado === "omitida" ? "Control salteado (quedó registrado)" : "✓ Control de bultos registrado")
    }).finally(() => setGuardando(false))
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
          <select value={transporte} onChange={(e) => cambiar({ transporte: e.target.value })} style={{ width: "100%", background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "14px 12px", fontSize: 16, color: C.text, fontWeight: 600 }}>
            <option value="">Sin transporte / retiro propio</option>
            {transportes.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ color: C.sub, fontSize: 14, marginBottom: 6 }}>Bultos según remito</div>
            <input type="text" inputMode="numeric" value={declarados} onChange={(e) => cambiar({ declarados: e.target.value.replace(/\D/g, "").slice(0, 6) })} style={campo} />
          </div>
          <div>
            <div style={{ color: C.sub, fontSize: 14, marginBottom: 6 }}>Bultos contados</div>
            <input type="text" inputMode="numeric" value={recibidos} onChange={(e) => cambiar({ recibidos: e.target.value.replace(/\D/g, "").slice(0, 6) })} style={{ ...campo, background: difieren ? C.redL : C.bg, color: difieren ? C.red : C.text, border: `2px solid ${difieren ? C.redB : C.border}` }} />
          </div>
        </div>
        {difieren && (
          <div style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: C.red, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
              ⚠ {recib < decl ? `Faltan ${decl - recib}` : `Sobran ${recib - decl}`} bulto{Math.abs(decl - recib) !== 1 ? "s" : ""} — NO firmes conforme. Detallá qué pasó:
            </div>
            <textarea value={obs} onChange={(e) => cambiar({ obs: e.target.value.slice(0, 500) })} rows={2} placeholder="Ej: llegaron 18 de 20 bultos, faltan 2 cajas de..." style={{ width: "100%", background: C.white, border: `1.5px solid ${C.redB}`, borderRadius: 10, padding: 10, fontSize: 15, boxSizing: "border-box" }} />
          </div>
        )}
      </div>
      <button
        onClick={() => guardar(difieren ? "no_conforme" : "conforme")}
        disabled={!!falta || guardando}
        style={{ background: falta ? "#e5e7eb" : difieren ? C.orange : C.green, color: falta ? C.light : "#fff", fontWeight: 800, fontSize: 19, padding: 20, borderRadius: 20, border: "none" }}
      >
        {difieren ? "⚠ Registrar con diferencia de bultos" : "✓ Bultos OK — empezar a escanear"}
      </button>
      {falta && <div style={{ color: C.sub, fontSize: 14, textAlign: "center", fontWeight: 600, marginTop: -6 }}>{falta}</div>}
      <button onClick={saltear.abrir} disabled={guardando} style={{ background: C.white, color: C.sub, fontWeight: 600, padding: 14, borderRadius: 16, border: `1.5px solid ${C.border}`, fontSize: 15 }}>Saltear control (queda registrado)</button>
      <div style={{ color: C.light, fontSize: 13, textAlign: "center" }}>Después sacale foto al remito firmado desde "Documentos"</div>

      {/* Saltear es una decisión, no un botón que se toca sin querer: se confirma */}
      <Hoja abierta={saltear.abierto} onCerrar={saltear.cerrar} titulo="¿Saltear el control de bultos?">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 15, color: C.text, lineHeight: 1.4 }}>
            Queda registrado que <b>no se contaron los bultos</b> de esta entrega: si después falta mercadería, no se le va a poder reclamar al transporte.
            {(declarados !== "" || recibidos !== "") && <> Los números que escribiste no se guardan.</>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={saltear.cerrar} style={{ flex: 1, background: C.green, color: "#fff", fontWeight: 800, fontSize: 16, padding: "17px 0", borderRadius: 16, border: "none" }}>Volver a contar</button>
            <button onClick={() => guardar("omitida")} disabled={guardando} style={{ flex: 1, background: C.white, color: C.red, fontWeight: 700, fontSize: 16, padding: "17px 0", borderRadius: 16, border: `1.5px solid ${C.redB}` }}>Sí, saltear</button>
          </div>
        </div>
      </Hoja>
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
  const { contar, resolverCodigo, abrirItem, baja } = useAccionesRecepcion(r, mostrar)
  const finalizar = useFinalizarRecepcion(r, mostrar)
  const abrirFicha = useAbrirFicha()
  const fichaAbierta = useFichaAbierta()
  const respaldoFicha = useMemo(() => respaldoDe(r), [r])
  const online = useOnline()
  const conBultos = !!r && !r.cierrePendiente && !r.conformidad
  // Con la ficha abierta, la cantidad la reemplaza (atrás vuelve a la lista, no a la ficha)
  useLector({ enabled: !!r && !conBultos, onCodigo: (c) => { const a = resolverCodigo(c); if (a) abrirItem(a, { replace: fichaAbierta }) } })

  if (!r || r.cierrePendiente) return <Marco titulo="Recibir Mercadería" dataset={DATASET}>{toast}<OrdenNoDisponible cargando={cargando} finalizada={r?.cierrePendiente} /></Marco>
  if (conBultos) return <Marco titulo="Recibir Mercadería" dataset={DATASET}>{toast}<ControlBultos r={r} mostrar={mostrar} /></Marco>

  const s = resumen(r)
  const pendientes = r.lineas.filter((l) => l.estado_linea === "pendiente")
  const enParte = r.lineas.filter(lineaIncompleta)
  const recibidos = r.lineas.filter((l) => l.estado_linea === "ok" && !lineaIncompleta(l))
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
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "10px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{r.orden.numero_orden || "Recepción"}</div>
            <div style={{ color: C.green, fontWeight: 600, fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🏭 {r.orden.proveedores?.nombre}</div>
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
        <BarraProgreso resueltos={s.ok + s.faltantes} total={s.total} pendientes={s.pendientes} ok={s.ok - s.incompletas} faltantes={s.faltantes} />
        {s.incompletas > 0 && <div style={{ color: C.orange, fontWeight: 700, fontSize: 13, marginTop: 3 }}>◐ {s.incompletas} con menos de lo pedido</div>}
      </div>

      {pendientes.length > 0 && s.ok + s.faltantes === 0 && (
        <div style={{ background: C.greenL, borderBottom: `1px solid ${C.greenB}`, padding: "5px 14px", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>👈</span>
          <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>Tocá o escaneá para cargar la cantidad · Swipeá para faltante · ⓘ ficha</span>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "10px 14px 0" }}>
        {pendientes.length > 0 && (
          <>
            <div style={TITULO_GRUPO}>Pendientes ({pendientes.length})</div>
            {pendientes.map((l) => <Linea key={l.articulo_id} l={l} accion={aFaltante(l)} onAbrir={() => abrirItem(l.articulo_id)} onFicha={() => abrirFicha(l.articulo_id)} />)}
          </>
        )}
        {enParte.length > 0 && (
          <>
            <div style={{ ...TITULO_GRUPO, paddingTop: 8, color: C.orange }}>Llegó menos de lo pedido ({enParte.length})</div>
            {enParte.map((l) => <Linea key={l.articulo_id} l={l} accion={aFaltante(l)} onAbrir={() => abrirItem(l.articulo_id)} onFicha={() => abrirFicha(l.articulo_id)} />)}
          </>
        )}
        {recibidos.length > 0 && (
          <>
            <div style={{ ...TITULO_GRUPO, paddingTop: 8 }}>Recibidos completos ({recibidos.length})</div>
            {recibidos.map((l) => <Linea key={l.articulo_id} l={l} accion={aFaltante(l)} onAbrir={() => abrirItem(l.articulo_id)} onFicha={() => abrirFicha(l.articulo_id)} />)}
          </>
        )}
        <div style={{ height: 16 }} />
      </div>
      <FichaArticulo respaldo={respaldoFicha} />
      {baja.hoja}
      {finalizar.hoja}

      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 12 }}>
        <button onClick={() => navigate(`/recibir/${r.orden.id}/buscar`)} style={{ flex: 2, background: C.white, color: C.text, fontWeight: 700, fontSize: 18, padding: "19px 0", borderRadius: 18, border: `1.5px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔍</span> Buscar artículo
        </button>
        <button onClick={() => finalizar.pedir(1)} style={{ flex: 1, background: s.pendientes === 0 ? "#15803d" : "#f3f4f6", color: s.pendientes === 0 ? "#fff" : C.light, fontWeight: 800, fontSize: 16, padding: "19px 0", borderRadius: 18, border: s.pendientes === 0 ? "none" : `1.5px solid ${C.border}` }}>✅ Finalizar</button>
      </div>
    </Marco>
  )
}

// ─── /recibir/:id/buscar ─────────────────────────────────────────────────────

export function RecepcionBuscar() {
  const { id } = useParams()
  const { recepcion: r, cargando } = useRecepcion(id)
  const { toast, mostrar } = useToast()
  const { resolverCodigo, abrirItem, baja } = useAccionesRecepcion(r, mostrar)
  const finalizar = useFinalizarRecepcion(r, mostrar)
  const volver = useVolver()
  const teclado = useTecladoAbierto() // con el teclado abierto, encabezado y pie le dejan lugar a los resultados
  if (!r || r.cierrePendiente) return <Marco titulo="Buscar artículo">{toast}<OrdenNoDisponible cargando={cargando} finalizada={r?.cierrePendiente} /></Marco>
  const s = resumen(r)
  return (
    <Marco titulo="Buscar artículo">
      {toast}
      {!teclado && (
        <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "14px 16px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{r.orden.numero_orden}</div>
          <div style={{ color: C.green, fontWeight: 600, fontSize: 14, marginTop: 2 }}>🏭 {r.orden.proveedores?.nombre}</div>
          <Contadores pendientes={s.pendientes} ok={s.ok} faltantes={s.faltantes} estilo={{ marginTop: 6 }} />
        </div>
      )}
      <PanelBuscar
        placeholder="Escanear EAN o buscar artículo..."
        vacio={{ icono: "📱", texto: <>Escaneá el código de barras<br />o escribí para buscar</> }}
        mostrar={mostrar}
        priorizar={(art) => r.lineas.some((x) => x.articulo_id === art.id)}
        decorar={(art) => {
          const l = r.lineas.find((x) => x.articulo_id === art.id)
          if (!l) return null
          const ok = l.estado_linea === "ok" && !lineaIncompleta(l)
          const estado = lineaIncompleta(l) ? `FALTAN ${textoFalta(l)}` : l.estado_linea.toUpperCase()
          return { bg: ok ? C.greenL : C.orangeL, borde: ok ? C.greenB : C.orangeB, leyenda: <span style={{ color: ok ? C.green : C.orange }}>OC: {textoCantidad(l.cantidad_oc, l.unidadOC, l.unidadesPorBulto)} · {estado}</span> }
        }}
        onElegir={(art) => abrirItem(art.id, { replace: true })}
        onCodigo={(c) => { const a = resolverCodigo(c); if (a) abrirItem(a, { replace: true }) }}
        dadoDeBaja={baja}
      />
      {baja.hoja}
      {finalizar.hoja}
      {!teclado && (
        <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 10 }}>
          <button onClick={() => volver()} style={{ flex: 1, background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "19px 0", borderRadius: 18, border: `1.5px solid ${C.border}` }}>📋 Lista</button>
          <button onClick={() => finalizar.pedir(2)} style={{ flex: 1, background: s.pendientes === 0 ? C.green : "#e5e7eb", color: s.pendientes === 0 ? "#fff" : C.light, fontWeight: 800, fontSize: 16, padding: "19px 0", borderRadius: 18, border: "none" }}>✅ Finalizar</button>
        </div>
      )}
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

  // En qué cuenta el operario (E-30). Arranca en la unidad de la línea de la OC (fuera de OC: unidades)
  // y la puede cambiar; lo que sube al stock son SIEMPRE unidades y se le muestra antes de confirmar.
  const [unidadElegida, setUnidadElegida] = useState<UnidadConteo | null>(null)

  if (!r || r.cierrePendiente || !articulo || !articuloId) return <Marco titulo="Cantidad">{toast}<OrdenNoDisponible cargando={cargando} finalizada={r?.cierrePendiente} /></Marco>
  const enOC = !!linea && !linea.fuera_de_oc
  const upb = linea?.unidadesPorBulto ?? (Number(articulo.unidades_por_bulto) > 1 ? Number(articulo.unidades_por_bulto) : 1)
  const unidad: UnidadConteo = unidadElegida ?? (enOC ? linea!.unidadOC : "unidad")
  const sinBulto = unidad === "bulto" && upb === 1
  const guardar = async (cantidad: number, esFaltante: boolean) => {
    // La cantidad viaja tal cual se contó, con su unidad (0 = el servidor la deja como faltante)
    await contar(articuloId, articulo.descripcion ?? "artículo", esFaltante ? 0 : Math.max(0, cantidad), unidad)
    dejarAviso(esFaltante ? "Marcado como faltante" : "✓ Guardado")
    volver()
  }
  const textoOC = enOC ? textoCantidad(linea!.cantidad_oc, linea!.unidadOC, upb) : ""
  const botonUnidad = (u: UnidadConteo, texto: string) => (
    <button
      key={u} onClick={() => setUnidadElegida(u)}
      style={{ flex: 1, padding: "10px 6px", borderRadius: 12, fontSize: 15, fontWeight: 800, border: `2px solid ${unidad === u ? C.green : C.border}`, background: unidad === u ? C.greenL : C.white, color: unidad === u ? C.green : C.sub }}
    >
      {texto}
    </button>
  )
  return (
    <Marco titulo="Cantidad">
      {toast}
      <PanelCantidad
        articulo={{ id: articuloId, ...articulo }}
        titulo="Artículo"
        etiquetaInput={unidad === "bulto" ? "¿Cuántos BULTOS recibiste?" : "¿Cuántas UNIDADES recibiste?"}
        // Arranca VACÍA aunque esté en la OC (P2-16 llevado a recepción, 30/10): se cuenta, no se confirma la OC
        inicial=""
        exigirCantidad
        ayudaInput="Escribí lo que contaste · 0 = no llegó"
        mostrar={mostrar}
        selector={
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {botonUnidad("bulto", upb > 1 ? `Bultos (× ${cant(upb)} u)` : "Bultos")}
            {botonUnidad("unidad", "Unidades sueltas")}
          </div>
        }
        equivalente={(c) =>
          sinBulto ? (
            <div style={{ color: C.red, fontSize: 14, fontWeight: 700, marginTop: 8, textAlign: "center" }}>⚠ Este artículo no tiene unidades por bulto cargadas: contalo por UNIDADES o cargá el dato en Modificar artículos.</div>
          ) : c !== null && c > 0 ? (
            <div style={{ color: C.green, fontSize: 17, fontWeight: 800, marginTop: 8, textAlign: "center" }}>
              {unidad === "bulto" ? `${textoCantidad(c, "bulto", upb)} → suman ${cant(aUnidadesBase(c, upb))} unidades al stock` : `Suman ${cant(c)} unidades al stock`}
            </div>
          ) : null
        }
        resumenTeclado={enOC ? <div style={{ color: C.green, fontSize: 14, fontWeight: 700, marginTop: 2 }}>OC: {textoOC}</div> : <div style={{ color: C.red, fontSize: 14, fontWeight: 700, marginTop: 2 }}>⚠ No pedido en esta OC</div>}
        cabecera={
          enOC ? (
            <div style={{ background: C.greenL, border: `1.5px solid ${C.greenB}`, borderRadius: 16, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ color: C.green, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Pedido en la OC</div>
              <div style={{ color: C.green, fontWeight: 800, fontSize: 44, lineHeight: 1.1 }}>{cantidadConUnidad(linea!.cantidad_oc, linea!.unidadOC)}</div>
              {linea!.unidadOC === "bulto" && <div style={{ color: linea!.sinUnidadesPorBulto ? C.red : C.green, fontSize: 16, fontWeight: 700, marginTop: 4 }}>{linea!.sinUnidadesPorBulto ? "⚠ sin unidades por bulto cargadas" : `× ${cant(upb)} u = ${cant(linea!.ocUnidades)} unidades`}</div>}
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
  const { contar, resolverCodigo, abrirItem, baja } = useAccionesRecepcion(r, mostrar)
  const volver = useVolver()
  const abrirFicha = useAbrirFicha()
  const respaldoFicha = useMemo(() => respaldoDe(r), [r])
  useLector({ enabled: !!r, onCodigo: (c) => { const a = resolverCodigo(c); if (a) abrirItem(a, { replace: true }) } })
  if (!r || r.cierrePendiente) return <Marco titulo="Faltantes">{toast}<OrdenNoDisponible cargando={cargando} finalizada={r?.cierrePendiente} /></Marco>
  const faltantes = r.lineas.filter((l) => l.estado_linea === "faltante")
  return (
    <Marco titulo="Faltantes">
      {toast}
      <div style={{ padding: "16px 14px" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Artículos faltantes ({faltantes.length})</div>
          <div style={{ fontSize: 14, color: C.sub, marginTop: 4 }}>Tocá para cargar lo que llegó · Swipeá hacia la izquierda para devolver a pendientes</div>
        </div>
        {faltantes.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: C.light, fontSize: 16 }}>No hay faltantes</div>}
        {faltantes.map((l) => (
          <Linea key={l.articulo_id} l={l} onAbrir={() => abrirItem(l.articulo_id)} onFicha={() => abrirFicha(l.articulo_id)} accion={{ fondo: C.green, icono: "↩", etiqueta: "Pendiente", onConfirmar: () => void contar(l.articulo_id, l.articulo?.descripcion ?? "artículo", -1).then(() => mostrar("Devuelto a pendientes")) }} />
        ))}
        <button onClick={() => volver()} style={{ width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}`, marginTop: 12 }}>← Volver a la lista</button>
      </div>
      <FichaArticulo respaldo={respaldoFicha} />
      {baja.hoja}
    </Marco>
  )
}

// ─── /recibir/:id/documentos — fotos, PDF y lo que leyó el sistema (ONLINE-ONLY, MOBILE.md §9) ───

type Documento = DocumentoRecepcion

/** Lo que el sistema leyó de un documento (o por qué no pudo), en castellano. */
function LecturaDoc({ doc, destacado }: { doc: Documento; destacado?: boolean }) {
  const l = lecturaDeDocumento(doc)
  if (l.estado === "adjunto") return destacado ? <div style={{ fontSize: 14, color: C.sub, fontWeight: 600 }}>📎 Quedó adjunto (no se lee: es una foto de respaldo).</div> : null
  if (l.estado === "no_leido") {
    return (
      <div style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 12, padding: "8px 10px", marginTop: destacado ? 0 : 6 }}>
        <div style={{ color: C.red, fontWeight: 800, fontSize: 13 }}>NO SE PUDO LEER</div>
        <div style={{ color: C.text, fontSize: 13, lineHeight: 1.35, marginTop: 2 }}>{l.motivo}</div>
      </div>
    )
  }
  const dato = (etiqueta: string, valor: string, falta = false) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, color: C.light, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{etiqueta}</div>
      <div style={{ fontSize: destacado ? 16 : 14, fontWeight: 800, color: falta ? C.orange : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{valor}</div>
    </div>
  )
  return (
    <div style={{ background: C.greenL, border: `1.5px solid ${C.greenB}`, borderRadius: 12, padding: "8px 10px", marginTop: destacado ? 0 : 6 }}>
      <div style={{ color: C.green, fontWeight: 800, fontSize: 12, marginBottom: 4 }}>✓ EL SISTEMA LEYÓ</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
        {dato("Tipo", l.tipo ?? "sin identificar", !l.tipo)}
        {dato("Número", l.numero ?? "no se leyó", !l.numero)}
        {dato("Total", l.total != null ? moneda(l.total) : "no se leyó", l.total == null)}
        {dato("Renglones", String(l.renglones), l.renglones === 0)}
      </div>
      {(!l.numero || l.total == null) && <div style={{ color: C.orange, fontSize: 12, fontWeight: 700, marginTop: 4 }}>Falta algún dato: la oficina lo completa en la verificación.</div>}
    </div>
  )
}

export function RecepcionDocumentos() {
  const { id } = useParams()
  const { recepcion: r, cargando } = useRecepcion(id)
  const { api, sync } = useRuntime()
  const online = useOnline()
  const { toast, mostrar } = useToast()
  const [docs, setDocs] = useState<Documento[] | null>(null)
  const [tipo, setTipo] = useState<"remito" | "factura" | "foto">("remito")
  const [subiendo, setSubiendo] = useState<string | null>(null)
  // El último documento subido, para mostrarle al operario enseguida qué leyó el sistema
  const [ultimo, setUltimo] = useState<Documento | null>(null)
  const camaraRef = useRef<HTMLInputElement>(null)
  const archivoRef = useRef<HTMLInputElement>(null)
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

  const subir = async (original: File) => {
    if (!recepcionId || subiendo) return
    const revision = revisarArchivo(original)
    if (!revision.ok) { mostrar(revision.motivo, "err"); return }
    setUltimo(null)
    try {
      // Las fotos se achican ANTES de viajar: la cámara saca 3–6 MB y el servidor corta en 4,5 MB
      let file = original
      if (revision.esImagen) {
        setSubiendo("Achicando la foto…")
        const c = await comprimirFoto(original, { maxLado: 2000, calidad: 0.78 })
        file = new File([c.blob], c.nombre, { type: c.mime })
      }
      if (file.size > LIMITE_SUBIDA_BYTES) {
        mostrar(`El archivo pesa ${megas(file.size)} y el máximo es ${megas(LIMITE_SUBIDA_BYTES)}. ${revision.esPdf ? "Sacale fotos a las hojas en vez de subir el PDF." : "Sacá la foto de nuevo."}`, "err")
        return
      }
      setSubiendo(tipo === "foto" ? "Subiendo…" : "Subiendo y leyendo…")
      const fd = new FormData()
      fd.append("file", file)
      fd.append("tipo_documento", tipo)
      const data = await api.postForm<{ document: Documento; ocr_processing_results?: unknown[]; no_leido?: boolean; aviso?: string }>(`/api/recepciones/${recepcionId}/ocr`, fd)
      setDocs((p) => [...(p || []), data.document])
      setUltimo(data.document)
      const l = lecturaDeDocumento(data.document)
      // Un comprobante que ya estaba cargado llega como error (409) y lo muestra el catch.
      if (l.estado === "no_leido") mostrar("No se pudo leer: mirá el detalle arriba", "err")
      else if (l.estado === "leido") mostrar(`✓ Leído: ${l.renglones} renglón${l.renglones === 1 ? "" : "es"}`)
      else mostrar("📎 Adjuntado")
      void sync.dataset(DATASET)
    } catch (e) {
      mostrar(e instanceof ErrorHttp ? e.message : "Sin señal: el archivo no se subió. Probá de nuevo cerca del WiFi.", "err")
    } finally {
      setSubiendo(null)
    }
  }
  const eliminar = async (docId: string) => {
    if (!recepcionId) return
    try {
      await api.delete(`/api/recepciones/${recepcionId}/ocr`, { document_id: docId })
      setDocs((p) => (p || []).filter((d) => d.id !== docId))
      setUltimo((u) => (u?.id === docId ? null : u))
      mostrar("Documento eliminado")
      void sync.dataset(DATASET)
    } catch (e) {
      mostrar(e instanceof ErrorHttp ? e.message : "No se pudo eliminar: sin señal", "err")
    }
  }
  const elegido = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void subir(f) }

  const habilitado = online && !!recepcionId
  const ocupado = !habilitado || !!subiendo
  const boton = { border: "none", borderRadius: 14, padding: "10px 14px", minHeight: 52, fontSize: 15, fontWeight: 800, opacity: ocupado ? 0.5 : 1 } as const
  return (
    <Marco titulo="Documentos">
      {toast}
      <div style={{ padding: "16px 14px" }}>
        {!habilitado && (
          <div style={{ background: C.yellowL, border: `1px solid ${C.yellowB}`, borderRadius: 14, padding: 14, color: C.yellow, fontWeight: 600, fontSize: 14, marginBottom: 14 }}>
            {online ? "La recepción todavía se está enviando al servidor. Probá en unos segundos." : "Sin señal: las fotos y la lectura necesitan conexión. Seguí contando y sacá las fotos cuando vuelvas a tener WiFi."}
          </div>
        )}
        <input ref={camaraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={elegido} />
        <input ref={archivoRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={elegido} />
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: C.sub, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>¿Qué vas a subir?</div>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", fontSize: 16, color: C.text, fontWeight: 700, width: "100%", minHeight: 50 }}>
            <option value="remito">Remito (controla cantidades)</option>
            <option value="factura">Factura (cantidades y precios)</option>
            <option value="foto">Foto de respaldo (no se lee)</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => camaraRef.current?.click()} disabled={ocupado} style={{ ...boton, flex: 1.3, background: C.green, color: "#fff" }}>📷 Sacar foto</button>
          <button onClick={() => archivoRef.current?.click()} disabled={ocupado} style={{ ...boton, flex: 1, background: C.white, color: C.text, border: `1.5px solid ${C.border}` }}>📄 PDF o archivo</button>
        </div>
        {subiendo && (
          <div style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 14, padding: 14, color: "#1d4ed8", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
            ⏳ {subiendo} <span style={{ fontWeight: 500 }}>No cierres esta pantalla: leer una factura puede tardar hasta un minuto.</span>
          </div>
        )}
        {ultimo && !subiendo && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: C.sub, fontWeight: 700, marginBottom: 4 }}>Recién subido: {ultimo.nombre_archivo || ultimo.tipo_documento}</div>
            <LecturaDoc doc={ultimo} destacado />
          </div>
        )}
        {docs && docs.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.light }}>
            <div style={{ fontSize: 48 }}>📎</div>
            <div style={{ fontSize: 15, marginTop: 10 }}>No hay documentos adjuntos</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Sacale una foto a la factura o al remito, o subí el PDF</div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(docs || []).map((doc) => {
            const esPdf = (doc.tipo_mime || "").includes("pdf") || (doc.nombre_archivo || "").toLowerCase().endsWith(".pdf") || (doc.url_imagen || "").includes(".pdf")
            return (
              <div key={doc.id} style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 18, padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ fontSize: 30 }}>{esPdf ? "📄" : "🖼️"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.nombre_archivo || doc.tipo_documento || "Documento"}</div>
                    <span style={{ fontSize: 11, background: "#e0f2fe", color: "#0369a1", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>{doc.tipo_documento}</span>
                  </div>
                  {doc.url_imagen && (
                    <a href={doc.url_imagen} target="_blank" rel="noopener noreferrer" aria-label="Ver documento" style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 10, minWidth: 44, minHeight: 44, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>👁️</a>
                  )}
                  <button onClick={() => void eliminar(doc.id)} disabled={ocupado} aria-label="Eliminar documento" style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 10, minWidth: 44, minHeight: 44, fontSize: 16 }}>🗑️</button>
                </div>
                <LecturaDoc doc={doc} />
              </div>
            )
          })}
        </div>
      </div>
    </Marco>
  )
}
