import { useMemo, useState } from "react"
import { fecha } from "@gm/formato"
import { armarExtracto, esComprobanteConPdf, etiquetaMovimiento } from "@gm/vendedor"
import type { CuentaCliente, MovimientoCC } from "../../datasets"
import { type ComprobantePdf, usePdfComprobantes } from "../../datos/comprobantes-pdf"
import { formatCurrency } from "../../ui"

// Comprobantes como PDF (pedido del dueño, 14/10/2026): tocar un comprobante abre su PDF
// listo para compartir; "Compartir varios" permite elegir y mandar varios juntos.


/** Selección para "Compartir varios" (ids de comprobantes de venta). */
export function useSeleccionCompartir() {
  const [activo, setActivo] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  return {
    activo,
    sel,
    alternarModo: () => { setActivo((a) => !a); setSel(new Set()) },
    toggle: (id: string) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n }),
    salir: () => { setActivo(false); setSel(new Set()) },
  }
}

/** Encabezado de una lista de comprobantes con el botón "Compartir varios". */
export function TituloCompartible({ titulo, sel, hayPdf }: { titulo: string; sel: ReturnType<typeof useSeleccionCompartir>; hayPdf: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-lg font-bold text-gray-700">{titulo}</h2>
      {hayPdf && (
        <button onClick={sel.alternarModo} className={`min-h-10 rounded-xl px-3 text-xs font-bold ${sel.activo ? "bg-gray-900 text-white" : "border border-gray-300 bg-white text-gray-700"}`}>
          {sel.activo ? "Cancelar" : "📤 Compartir varios"}
        </button>
      )}
    </div>
  )
}

/** Barra fija para mandar lo elegido (aparece en modo "Compartir varios"). */
export function BarraCompartir({ sel, comprobantes, pdf }: { sel: ReturnType<typeof useSeleccionCompartir>; comprobantes: ComprobantePdf[]; pdf: ReturnType<typeof usePdfComprobantes> }) {
  if (!sel.activo) return null
  const elegidos = comprobantes.filter((c) => sel.sel.has(c.id))
  return (
    <div className="sticky bottom-2 z-10 mt-3 rounded-2xl bg-gray-900 p-3 shadow-lg">
      <button
        onClick={() => { if (elegidos.length) void pdf.compartir(elegidos).then(() => sel.salir()) }}
        disabled={!elegidos.length || pdf.ocupado || !pdf.online}
        className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white disabled:opacity-40"
      >
        {pdf.ocupado ? "Bajando los PDF…" : !pdf.online ? "Necesitás señal para compartir" : elegidos.length ? `📤 Compartir ${elegidos.length} comprobante${elegidos.length === 1 ? "" : "s"}` : "Elegí los comprobantes"}
      </button>
    </div>
  )
}

/** Casilla / ícono de la fila según el modo. */
export function MarcaPdf({ id, sel }: { id: string; sel: ReturnType<typeof useSeleccionCompartir> }) {
  return sel.activo
    ? <span className="w-6 shrink-0 text-center text-lg">{sel.sel.has(id) ? "☑" : "☐"}</span>
    : <span className="w-6 shrink-0 text-center text-lg" aria-hidden>📄</span>
}

/** Comprobante de venta que referencia un movimiento del libro (para abrir/compartir su PDF). */
const comprobanteDe = (m: MovimientoCC): ComprobantePdf | null =>
  esComprobanteConPdf(m) ? { id: m.referencia_id!, tipo_comprobante: m.comprobante_tipo ?? null, numero_comprobante: m.numero_comprobante ?? null, fecha: m.fecha } : null

/**
 * Resumen de cuenta = el EXTRACTO del ERP (lib/cuenta-corriente/extracto.ts): facturas,
 * presupuestos, pagos, notas de crédito/débito y ajustes con el saldo acumulado; los
 * cobros en la calle sin verificar en gris (no suman) y el saldo proyectado. Más nuevo arriba.
 */
export function ResumenCuenta({ cuenta, avisar }: { cuenta: CuentaCliente; avisar: (m: string) => void }) {
  const pdf = usePdfComprobantes(avisar)
  const sel = useSeleccionCompartir()
  const extracto = useMemo(() => armarExtracto(cuenta.movimientos ?? []).reverse(), [cuenta.movimientos])
  const comprobantes = useMemo(() => extracto.map(comprobanteDe).filter((c): c is ComprobantePdf => !!c), [extracto])
  const enCalle = cuenta.pagos_recientes.filter((p) => p.estado === "pendiente" || p.estado === "pendiente_rendicion")
  const saldo = cuenta.cliente.saldo_actual
  const proyectado = cuenta.cliente.saldo_proyectado ?? saldo

  if (cuenta.movimientos === undefined) {
    return <p className="rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">El resumen se descarga con la próxima actualización de la cuenta (tocá “Actualizar” con señal).</p>
  }
  if (cuenta.movimientos === null) {
    return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-800">No se pudo cargar el resumen de este cliente. Probá “Actualizar” con señal.</p>
  }

  const fila = (m: (typeof extracto)[number], i: number) => {
    const c = comprobanteDe(m)
    const contenido = (
      <>
        {c ? <MarcaPdf id={c.id} sel={sel} /> : <span className="w-6 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-gray-900">{etiquetaMovimiento(m)}{m.numero_comprobante ? ` ${m.numero_comprobante}` : ""}</span>
          <span className="block truncate text-xs text-gray-400">{fecha(m.fecha)}{m.observaciones ? ` · ${m.observaciones}` : ""}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`block text-sm font-bold ${Number(m.haber) > 0 ? "text-green-700" : "text-gray-900"}`}>
            {Number(m.debe) > 0 ? formatCurrency(Number(m.debe)) : `−${formatCurrency(Number(m.haber))}`}
          </span>
          <span className={`block text-[11px] font-bold ${m.saldo_acumulado > 0.005 ? "text-red-600" : "text-green-600"}`}>saldo {formatCurrency(m.saldo_acumulado)}</span>
        </span>
      </>
    )
    return c ? (
      <button key={m.id ?? i} onClick={() => (sel.activo ? sel.toggle(c.id) : void pdf.abrir(c))} disabled={pdf.ocupado}
        className={`flex min-h-14 w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left active:bg-gray-50 ${sel.activo && sel.sel.has(c.id) ? "bg-emerald-50" : ""}`}>
        {contenido}
      </button>
    ) : (
      <div key={m.id ?? i} className="flex min-h-14 items-center gap-2 border-b border-gray-100 px-3 py-2">{contenido}</div>
    )
  }

  return (
    <div>
      <TituloCompartible titulo="Resumen de cuenta" sel={sel} hayPdf={comprobantes.length > 0} />
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between bg-gray-50 px-3 py-2.5">
          <span className="text-sm font-bold text-gray-700">Saldo actual</span>
          <span className={`font-bold ${saldo > 0.005 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(saldo)}</span>
        </div>
        {/* Cobros en la calle: promesas sin verificar — en gris, no suman (igual que el ERP) */}
        {enCalle.map((p) => (
          <div key={`calle-${p.id}`} className="flex min-h-12 items-center gap-2 border-b border-gray-100 bg-slate-50/70 px-3 py-2 italic text-gray-400">
            <span className="w-6 shrink-0" />
            <span className="min-w-0 flex-1 text-sm">Cobro en calle — sin verificar<span className="block text-xs">{fecha(p.fecha_pago)} · {p.estado === "pendiente_rendicion" ? "pendiente de rendición" : "pendiente de confirmación"}</span></span>
            <span className="shrink-0 text-sm">(−{formatCurrency(p.monto)})</span>
          </div>
        ))}
        {enCalle.length > 0 && (
          <div className="flex items-center justify-between border-b border-gray-200 bg-slate-100 px-3 py-2 text-sm">
            <span className="font-semibold text-gray-600">Saldo proyectado</span>
            <span className={`font-bold ${proyectado > 0.005 ? "text-red-500" : "text-green-600"}`}>{formatCurrency(proyectado)}</span>
          </div>
        )}
        {extracto.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">Sin movimientos registrados.</p> : extracto.map(fila)}
      </div>
      {!sel.activo && comprobantes.length > 0 && <p className="mt-2 px-1 text-xs text-gray-400">Tocá un comprobante para ver su PDF y compartirlo. {pdf.online ? "" : "(Necesitás señal.)"}</p>}
      <BarraCompartir sel={sel} comprobantes={comprobantes} pdf={pdf} />
    </div>
  )
}
