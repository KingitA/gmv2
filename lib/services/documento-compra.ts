/**
 * De la foto/PDF de un comprobante de compra al registro en comprobantes_compra.
 * Lo comparten las dos entradas de documentos:
 *   · oficina  → POST /api/ordenes-compra/[id]/documentos
 *   · depósito → POST /api/recepciones/[id]/ocr (web /deposito y app Depósito)
 *
 * Reglas (prueba integral de entrada):
 *   E-37  Si la IA falla o no lee ningún renglón, el documento se guarda como
 *         "no leído" con el motivo: NO se marca procesado ni se crea un comprobante vacío.
 *   E-36  La misma factura (proveedor + clase + número normalizado) no se carga dos
 *         veces, aunque la otra esté en otra orden de compra: se avisa cuál es.
 *   E-36  Sin número legible no se crea un comprobante "PENDIENTE-…" por cada foto:
 *         las fotos sin número de una misma orden y tipo van al MISMO comprobante
 *         provisorio (típico: las hojas 2 y 3 de una factura).
 */

import { todayArgentina } from '@/lib/utils';
import { inferirTipoComprobante, type ParseResult } from '@/lib/services/ocr';
import { matchAndCreateDetalle } from '@/lib/services/detalle';
import { esNumeroProvisorio, normalizarNumeroComprobante, tiposCompatibles } from '@/lib/services/numero-comprobante';
import { fechaISO } from '@/lib/formato';

export { esNumeroProvisorio, normalizarNumeroComprobante, tiposCompatibles };

export interface ComprobanteDuplicado {
    id: string;
    tipo_comprobante: string;
    numero_comprobante: string;
    estado: string;
    orden_compra_id: string | null;
    numero_orden: string | null;
}

/** ¿Ya está cargado este comprobante del proveedor (en esta orden o en cualquier otra)? */
export async function buscarComprobanteDuplicado(
    supabase: any,
    p: { proveedor_id: string; tipo: string; numero: unknown; excluirId?: string | null },
): Promise<ComprobanteDuplicado | null> {
    const clave = normalizarNumeroComprobante(p.numero);
    if (!clave) return null;
    const tipos = tiposCompatibles(p.tipo);
    if (tipos.length === 0) return null;
    // Se filtra EN LA CONSULTA (un proveedor puede tener miles de comprobantes): mismo tipo o
    // compatible, y el número tiene que contener los dígitos del número buscado. La comparación
    // exacta (punto de venta + número, sin ceros) se hace después sobre esos pocos.
    const digitos = clave.split('-').pop() || '';
    let q = supabase
        .from('comprobantes_compra')
        .select('id, tipo_comprobante, numero_comprobante, estado, orden_compra_id')
        .eq('proveedor_id', p.proveedor_id)
        .in('tipo_comprobante', tipos)
        .neq('estado', 'esperada') // una NC esperada no es el documento: es lo que se espera recibir
        .order('created_at', { ascending: true })
        .limit(500);
    if (/^\d+$/.test(digitos)) q = q.ilike('numero_comprobante', `%${digitos}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const dup = (data || []).find((c: any) =>
        c.id !== p.excluirId
        && normalizarNumeroComprobante(c.numero_comprobante) === clave);
    if (!dup) return null;
    let numero_orden: string | null = null;
    if (dup.orden_compra_id) {
        const { data: oc } = await supabase.from('ordenes_compra').select('numero_orden').eq('id', dup.orden_compra_id).maybeSingle();
        numero_orden = oc?.numero_orden ?? null;
    }
    return { ...dup, numero_orden };
}

export function mensajeDuplicado(dup: ComprobanteDuplicado, ordenActualId?: string | null): string {
    const donde = dup.orden_compra_id && dup.orden_compra_id === ordenActualId
        ? 'en esta orden'
        : dup.numero_orden ? `en la orden ${dup.numero_orden}` : 'sin orden de compra';
    const validado = ['validado', 'cerrado'].includes(dup.estado);
    const estado = validado ? ', ya validado' : '';
    // Otra hoja de la misma factura trae el mismo número: todavía no se suman hojas solas (E-38)
    const otraHoja = !validado ? ' Si es otra hoja de la misma factura, la oficina tiene que agregarle los renglones a mano desde la verificación de la orden.' : '';
    return `El comprobante ${dup.tipo_comprobante} ${dup.numero_comprobante} de este proveedor ya está cargado ${donde}${estado}. No se cargó de nuevo.${otraHoja}`;
}

/** Lo que se le dice a la persona cuando un documento no se pudo leer (el detalle técnico va aparte, en `motivo`). E-95 */
export const AVISO_NO_LEIDO = "No se pudo leer el archivo. Probá de nuevo o cargá el comprobante a mano.";

/** null = la lectura sirve; texto = el motivo TÉCNICO por el que el documento queda como "no leído". */
export function motivoNoLeido(ocr: ParseResult): string | null {
    if (ocr.error) return `La lectura automática falló: ${ocr.error}`;
    if (!ocr.items || ocr.items.length === 0) return 'La lectura automática no encontró ningún renglón en el documento.';
    return null;
}

/** Lo que se guarda en recepciones_documentos.datos_ocr de un documento no leído. */
export function datosNoLeido(ocr: ParseResult, motivo: string) {
    return { ...ocr, items: ocr.items || [], no_leido: true, motivo };
}

/**
 * Crea el comprobante de compra de un documento ya leído (o suma la hoja al comprobante
 * provisorio de la orden si no trae número), lo vincula al documento y carga su detalle.
 * Quien llama ya verificó: lectura válida (motivoNoLeido) y que no es un duplicado.
 */
export async function comprobanteDesdeOCR(supabase: any, p: {
    orden_compra_id: string;
    proveedor_id: string;
    recepcion_id: string;
    documento_id?: string | null;
    ocr: ParseResult;
    tipo_documento?: string;
    foto_url?: string | null;
}): Promise<{ comprobante: any | null; sumado_a_provisorio: boolean; otro_provisorio?: boolean; error?: string; vinculados: any[] }> {
    const meta = p.ocr.comprobante;
    const numero = meta?.numero_comprobante && !esNumeroProvisorio(meta.numero_comprobante) ? String(meta.numero_comprobante).trim() : '';
    const tipoComp = inferirTipoComprobante(p.ocr, p.tipo_documento);
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const totalFactura = Number(meta?.total_factura || 0);
    const percIva = Number(meta?.percepcion_iva || 0);
    const percIibb = Number(meta?.percepcion_iibb || 0);
    const ivaLeido = Number(meta?.total_iva || 0);
    const netoLeido = Number(meta?.subtotal_neto || 0);
    // Lo que el total trae además de neto e IVA (para que la cabecera siempre cierre: neto + impuestos = total)
    const extras = percIva + percIibb + Number(meta?.impuestos_internos || 0) + Number(meta?.otros_impuestos || 0);
    // No discrimina IVA: adquisición, remito, o una factura B / C a la que no se le leyó IVA. Ahí
    // neto = total (menos percepciones) e IVA = 0: antes se inventaba neto = total ÷ 1,21 y el control
    // de suma rechazaba los renglones cuando lo que estaba mal era la cabecera.
    const sinIva = tipoComp === 'Adquisicion' || tipoComp === 'ADQ' || tipoComp === 'Remito' || ((tipoComp === 'FB' || tipoComp === 'FC') && !(ivaLeido > 0));
    const totalNeto = sinIva
        ? r2(Math.max(0, totalFactura - extras))
        : r2(netoLeido > 0 ? netoLeido : ivaLeido > 0 ? totalFactura - ivaLeido - extras : (totalFactura > 0 ? (totalFactura - extras) / 1.21 : 0));
    const totalIva = sinIva ? 0 : r2(ivaLeido > 0 ? ivaLeido : (totalNeto > 0 && totalFactura > 0 ? totalFactura - extras - totalNeto : 0));
    const retGanancias = Number(meta?.retencion_ganancias || 0);
    const internos = Number(meta?.impuestos_internos || 0);
    const otros = Number(meta?.otros_impuestos || 0);
    const totales = {
        total_factura_declarado: totalFactura,
        total_neto: totalNeto,
        total_iva: totalIva,
        percepcion_iva_monto: percIva,
        percepcion_iibb_monto: percIibb,
        retencion_ganancias_monto: retGanancias,
        impuestos_internos: internos,
        otros_impuestos: otros,
        // la retención de Ganancias no es parte del total de una factura (se hace al pagar)
        total_calculado: totalNeto + totalIva + percIva + percIibb + internos + otros,
    };

    let comprobante: any = null;
    let sumado = false;
    let otroProvisorio = false;

    // Sin número: ¿ya hay un comprobante provisorio abierto de esta orden y este tipo?
    if (!numero) {
        const { data: abiertos } = await supabase
            .from('comprobantes_compra')
            .select('*')
            .eq('orden_compra_id', p.orden_compra_id)
            .eq('tipo_comprobante', tipoComp)
            .not('estado', 'in', '(validado,cerrado,esperada)')
            .ilike('numero_comprobante', 'PENDIENTE-%')
            .order('created_at', { ascending: true })
            .limit(1);
        // Solo se suma si puede ser OTRA HOJA del mismo documento. Si lo leído dice otra cosa
        // (otro total, u otra fecha) es otro comprobante sin número: va aparte, con su total.
        const esOtroDocumento = (prov: any) => {
            const totalProv = Number(prov.total_factura_declarado || 0);
            if (totalProv > 0 && totalFactura > 0 && Math.abs(totalProv - totalFactura) > 0.01) return true;
            const fechaProv = String(prov.fecha_comprobante || '').slice(0, 10);
            // la fecha del provisorio solo vale si se leyó del documento (no si es el día en que se cargó)
            const fechaLeida = !!fechaProv && fechaProv !== (fechaISO(prov.created_at) || '');
            return !!meta?.fecha && fechaLeida && fechaProv !== meta.fecha;
        };
        if (abiertos?.[0] && esOtroDocumento(abiertos[0])) {
            otroProvisorio = true;
        } else if (abiertos?.[0]) {
            comprobante = abiertos[0];
            sumado = true;
            // La hoja con los totales suele ser la última: se toman si el provisorio no los tenía
            if (!(Number(comprobante.total_factura_declarado) > 0) && totalFactura > 0) {
                const { data: act } = await supabase.from('comprobantes_compra').update(totales).eq('id', comprobante.id).select().single();
                if (act) comprobante = act;
            }
        }
    }

    if (!comprobante) {
        const { data: comp, error } = await supabase.from('comprobantes_compra').insert({
            orden_compra_id: p.orden_compra_id,
            proveedor_id: p.proveedor_id,
            tipo_comprobante: tipoComp,
            numero_comprobante: numero || `PENDIENTE-${Date.now()}`,
            fecha_comprobante: meta?.fecha || todayArgentina(),
            ...totales,
            foto_url: p.foto_url || null,
            estado: 'pendiente_recepcion',
            ajusta_stock: true,
            descuento_fuera_factura: Number(meta?.descuento_global || 0),
        }).select().single();
        if (error || !comp) {
            console.error('[documento-compra] no se pudo crear el comprobante:', error?.message);
            return { comprobante: null, sumado_a_provisorio: false, error: error?.message || 'No se pudo crear el comprobante', vinculados: [] };
        }
        comprobante = comp;
    }

    // Vincular documento → comprobante (permite revertir al eliminar el documento)
    if (p.documento_id) {
        await supabase.from('recepciones_documentos').update({ comprobante_id: comprobante.id }).eq('id', p.documento_id);
    }

    // Detalle (todas las líneas, con o sin match) + cantidades/precios documentados de la recepción
    const vinculados = await matchAndCreateDetalle(supabase, {
        comprobante_id: comprobante.id,
        recepcion_id: p.recepcion_id,
        proveedor_id: p.proveedor_id,
        items: p.ocr.items,
        documento_id: p.documento_id || undefined,
    });

    return { comprobante, sumado_a_provisorio: sumado, otro_provisorio: otroProvisorio, vinculados };
}
