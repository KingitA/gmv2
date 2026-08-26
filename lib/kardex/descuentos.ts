import type { DescuentoKardex } from "./insertar-kardex"

const round2 = (n: number) => Math.round(n * 100) / 100

export interface KardexDescuentosLinea {
  precio_lista: number
  descuentos_json: DescuentoKardex[]
  descuento_oferta_pct: number | null
  descuento_oferta_monto: number | null
  descuento_general_pct: number | null
  descuento_general_monto: number | null
  descuento_viajante_pct: number | null
  descuento_viajante_monto: number | null
}

/**
 * Arma el desglose de descuentos por línea para el kardex.
 * Cascada escalonada (neto basis, pre-IVA adj): P.Lista bruto −oferta −general −viajante.
 *   - oferta (descuento_propio): YA viene incluida en precioLista; back-calculamos su monto.
 *   - general: sobre precioLista.
 *   - viajante: sobre el neto post-general (= precioConDescuento).
 * kardex.precio_lista se mantiene = precioLista (post-oferta, pre-bonif) para no alterar el margen.
 *
 * Única implementación: la usan createPedido / agregarItemPedido (lib/actions/pedidos.ts)
 * y el sincronizador de kardex desde los renglones (lib/kardex/sincronizar-pedido.ts).
 */
export function buildKardexDescuentos(
  precioLista: number,        // engine: post-recargo, post-oferta, PRE-bonif (pre-IVA adj)
  precioConDescuento: number, // engine: precioLista * (1-general/100)*(1-viajante/100)
  ofertaPct: number,          // descuento_propio del artículo
  generalPct: number,         // bonificación general del cliente (por segmento)
  viajantePct: number,        // bonificación viajante del cliente (por segmento)
): KardexDescuentosLinea {
  const descuentos_json: DescuentoKardex[] = []

  let descuento_oferta_pct: number | null = null
  let descuento_oferta_monto: number | null = null
  if (ofertaPct > 0) {
    const bruto = round2(precioLista / (1 - ofertaPct / 100))
    descuento_oferta_pct = ofertaPct
    descuento_oferta_monto = round2(bruto - precioLista)
    descuentos_json.push({ tipo: 'oferta', porcentaje: ofertaPct, monto_unitario: descuento_oferta_monto })
  }

  const afterGeneral = round2(precioLista * (1 - generalPct / 100))
  let descuento_general_pct: number | null = null
  let descuento_general_monto: number | null = null
  if (generalPct > 0) {
    descuento_general_pct = generalPct
    descuento_general_monto = round2(precioLista - afterGeneral)
    descuentos_json.push({ tipo: 'general', porcentaje: generalPct, monto_unitario: descuento_general_monto })
  }

  let descuento_viajante_pct: number | null = null
  let descuento_viajante_monto: number | null = null
  if (viajantePct > 0) {
    descuento_viajante_pct = viajantePct
    descuento_viajante_monto = round2(afterGeneral - precioConDescuento)
    descuentos_json.push({ tipo: 'viajante', porcentaje: viajantePct, monto_unitario: descuento_viajante_monto })
  }

  return {
    precio_lista: precioLista,
    descuentos_json,
    descuento_oferta_pct,
    descuento_oferta_monto,
    descuento_general_pct,
    descuento_general_monto,
    descuento_viajante_pct,
    descuento_viajante_monto,
  }
}
