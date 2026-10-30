// P2-29 (vendedor, 30/10/2026): en un cobro, una devolución descuenta SOLO del comprobante
// al que pertenece. Misma regla que el servidor (`POST /api/viajante/cobro` →
// devolucionesFueraDelCobro, rechazo 422 DEVOLUCION_OTRO_COMPROBANTE) y que la app chofer
// (devolucionAplica). Solo "atan" los orígenes que todavía se deben: uno ya pagado, anulado,
// el PRES de respaldo 0002-00000001, un renglón sin origen o rechazado no frenan.
// Isomórfico: lo usan la ficha del servidor, la web /vendedor y la app (vía @gm/vendedor).

/** Origen de una devolución pendiente tal como lo manda la ficha del cliente. */
export interface OrigenDevolucionCobro {
  comprobante_venta_id: string
  /** "PRES 0001-00000028" */
  comprobante: string
  /** true = se debe todavía: la devolución solo descuenta si este comprobante se cobra */
  ata: boolean
}

/** Los comprobantes que tiene que cobrar el cobro para que la devolución descuente. */
export function origenesQueAtan(origenes: OrigenDevolucionCobro[] | null | undefined): OrigenDevolucionCobro[] {
  const vistos = new Set<string>()
  return (origenes ?? []).filter((o) => o.ata && !vistos.has(o.comprobante_venta_id) && !!vistos.add(o.comprobante_venta_id))
}

/**
 * ¿La devolución descuenta en este cobro? Sí si TODOS sus orígenes que atan están entre los
 * comprobantes que se cobran (`seleccionados`: comprobante_id → monto imputado). Sin `origenes`
 * (ficha vieja) se comporta como antes: descuenta.
 */
export function devolucionDescuentaEnCobro(
  origenes: OrigenDevolucionCobro[] | null | undefined,
  seleccionados: Record<string, number | undefined>,
): { descuenta: boolean; faltan: string[] } {
  const faltan = origenesQueAtan(origenes).filter((o) => !((seleccionados[o.comprobante_venta_id] ?? 0) > 0.005))
  return { descuenta: faltan.length === 0, faltan: faltan.map((o) => o.comprobante) }
}

/** "Va contra PRES 0001-00000028" (o null si no ata a ningún comprobante que se deba). */
export function vaContra(origenes: OrigenDevolucionCobro[] | null | undefined): string | null {
  const l = origenesQueAtan(origenes).map((o) => o.comprobante)
  return l.length ? `Va contra ${l.join(", ")}` : null
}

/** Renglón de devoluciones_detalle con su comprobante (embed) → origen para la ficha. */
export function origenDeRenglon(r: {
  comprobante_venta_id: string | null
  estado_renglon?: string | null
  comprobante?: { tipo_comprobante?: string | null; numero_comprobante?: string | null; saldo_pendiente?: number | string | null; anulado_en?: string | null } | null
}, numeroRespaldo: string): OrigenDevolucionCobro | null {
  if (!r.comprobante_venta_id || r.estado_renglon === "rechazado") return null
  const c = r.comprobante
  const respaldo = c?.tipo_comprobante === "PRES" && c?.numero_comprobante === numeroRespaldo
  const ata = !!c && !respaldo && !c.anulado_en && Number(c.saldo_pendiente ?? 0) > 0.005
  return { comprobante_venta_id: r.comprobante_venta_id, comprobante: c ? `${c.tipo_comprobante} ${c.numero_comprobante}` : "otro comprobante", ata }
}
