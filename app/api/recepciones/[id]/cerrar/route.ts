import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { conversionesDeRecepcion } from '@/lib/deposito/recepciones';
import { aUnidadesBase, unidadesPorBultoDe } from '@/lib/deposito/unidades';
import { calcularDiferencia, combinarLineasOC, cuentaSobrante, reclamablePorDevolucion, type DiferenciaLinea, type LineaFactura, type LineaOC } from '@/lib/compras/diferencias';
import { TIPOS_CON_PRECIOS } from '@/lib/compras/finalizar-oc';
import { registrarCostoEnHistorial } from '@/lib/compras/costo-y-kardex';
import { tipoDescuentoProveedor } from '@/lib/compras/tipo-descuento-proveedor';
import type { TipoDescuento } from '@/lib/compras/diferencias';
import { insertarKardex } from '@/lib/kardex/insertar-kardex';
import { faltaLaFuncion } from '@/lib/utils/migracion-pendiente';
import { nowArgentina } from '@/lib/utils';
import { moneda } from '@/lib/formato';

// POST /api/recepciones/[id]/cerrar — resolver diferencias de una recepción.
// Body: {
//   decisions: [{
//     item_id: string,
//     tipo: 'precio' | 'cantidad' ('mercaderia' = cantidad),
//     destino?: 'empresa' | 'proveedor' | 'transporte' | 'descuento_fuera_factura',
//     accion?: 'A' | 'B' | 'C' | 'D',   // forma vieja: A=empresa, B=transporte, C=proveedor, D=descuento fuera de factura
//     transporte_id?: string,
//     descripcion?: string,
//     devolver_unidades?: number,       // SOLO si se devuelve mercadería que SÍ entró (baja stock)
//   }]
// }
//
// Reglas (prueba en pantalla del 17/11):
//   E-90  Resolver un faltante NO toca el stock: la recepción ya sumó solo lo que llegó.
//         El stock baja únicamente si se pide devolver mercadería que entró (devolver_unidades).
//   E-91  Los importes los calcula el servidor con la misma cuenta que la pantalla
//         (lib/compras/diferencias.ts): precios NETOS por unidad e IVA discriminado. Lo que
//         mande el navegador como cantidad o precio se ignora.
//   Idempotente: una línea y tipo se resuelve una sola vez (no hay dos NC esperadas).
//
// Con la migración 20261117b todo lo hace recepcion_resolver_diferencia en una transacción.
// Sin ella solo se permite "la empresa lo asume" (no mueve plata ni stock); para el proveedor,
// el transporte o una devolución se contesta que falta aplicar la migración.
//
// Las imputaciones al proveedor NO acreditan la cuenta corriente: crean una NC 'esperada'
// (comprobantes_compra estado=esperada) que se confirma con ncp_registrar cuando llega el
// documento y se imputa contra la factura con ccp_imputar_credito.

// espera_factura / bonificado: las dos formas de quedarse con un SOBRANTE (decisión de Juan, 17/11)
type Destino = 'empresa' | 'proveedor' | 'transporte' | 'descuento_fuera_factura' | 'espera_factura' | 'bonificado';
const DESTINOS: Destino[] = ['empresa', 'proveedor', 'transporte', 'descuento_fuera_factura', 'espera_factura', 'bonificado'];

class Rechazo extends Error {
    constructor(message: string, public codigo: string) { super(message); }
}

/** Lo pedido, lo recibido y lo facturado de la línea, con la cuenta hecha. */
async function contexto(supabase: any, item: any, ocId: string | null, tipoDto: TipoDescuento): Promise<{ dif: DiferenciaLinea; hermanas: any[]; descuentoAlPie: boolean }> {
    const articuloId = item.articulo_id;
    const { data: art } = await supabase.from('articulos').select('unidades_por_bulto').eq('id', articuloId).maybeSingle();
    const upb = unidadesPorBultoDe(art?.unidades_por_bulto);

    let oc: LineaOC | null = null;
    const lineasFactura: LineaFactura[] = [];
    let recibido = 0;
    /** Otras líneas de recepción del MISMO artículo en la orden (otras entregas) */
    let hermanas: any[] = [];
    /** Algún comprobante de la orden trae un descuento al pie: el precio del renglón no es el neto real */
    let descuentoAlPie = false;

    if (ocId) {
        const { data: ocd, error: ocErr } = await supabase
            .from('ordenes_compra_detalle')
            .select('cantidad_pedida, tipo_cantidad, precio_unitario, descuento1, descuento2, descuento3, descuento4')
            .eq('orden_compra_id', ocId)
            .eq('articulo_id', articuloId);
        if (ocErr) throw ocErr;
        // El artículo puede estar en más de un renglón de la orden: se suman
        oc = combinarLineasOC((ocd || []).map((d: any) => ({
            cantidad_pedida: Number(d.cantidad_pedida || 0),
            factor: d.tipo_cantidad === 'unidad' ? 1 : upb,
            precio_unitario: Number(d.precio_unitario || 0),
            descuentos: [d.descuento1, d.descuento2, d.descuento3, d.descuento4].map((x: any) => Number(x) || 0),
        })));

        // Lo recibido del artículo en todas las tandas de la orden (en unidades)
        const { data: recs, error: recErr } = await supabase.from('recepciones').select('id').eq('orden_compra_id', ocId).neq('estado', 'cancelada');
        if (recErr) throw recErr;
        const recIds = (recs || []).map((r: any) => r.id);
        const { data: filas, error: filasErr } = recIds.length
            ? await supabase.from('recepciones_items').select('*').in('recepcion_id', recIds).eq('articulo_id', articuloId)
            : { data: [], error: null };
        if (filasErr) throw filasErr;
        const items: any[] = filas || [];
        hermanas = items.filter((ri) => ri.id !== item.id);
        const { porItem } = await conversionesDeRecepcion(supabase, ocId, items);
        for (const ri of items) {
            // filas fuera_de_oc de un artículo que SÍ está en la orden: duplicados de documentación, no suman
            if (ri.fuera_de_oc && oc) continue;
            recibido += ri.cantidad_fisica_base != null
                ? Number(ri.cantidad_fisica_base)
                : aUnidadesBase(ri.cantidad_fisica, porItem.get(ri.id)?.factorConteo ?? 1);
        }
        const factorPorItem = new Map<string, number>(items.map((ri) => [ri.id, Number(ri.factor_conversion) || 0]));

        // Lo facturado: renglones del artículo en los comprobantes CON precios de la orden
        const { data: comps, error: compErr } = await supabase
            .from('comprobantes_compra')
            .select('id, tipo_comprobante, descuento_fuera_factura')
            .eq('orden_compra_id', ocId)
            .neq('estado', 'esperada')
            .in('tipo_comprobante', TIPOS_CON_PRECIOS);
        if (compErr) throw compErr;
        const compIds = (comps || []).map((c: any) => c.id);
        descuentoAlPie = (comps || []).some((c: any) => Number(c.descuento_fuera_factura) > 0);
        if (compIds.length > 0) {
            const { data: det, error: detErr } = await supabase
                .from('comprobantes_compra_detalle')
                .select('cantidad_facturada, precio_unitario, descuento1, descuento2, descuento3, descuento4, tipo_cantidad, recepcion_item_id, iva_porcentaje')
                .in('comprobante_id', compIds)
                .eq('articulo_id', articuloId);
            if (detErr) throw detErr;
            for (const l of det || []) {
                const f = l.tipo_cantidad === 'bulto' ? ((factorPorItem.get(l.recepcion_item_id) || 0) > 1 ? factorPorItem.get(l.recepcion_item_id)! : upb) : 1;
                lineasFactura.push({
                    cantidad_facturada: Number(l.cantidad_facturada || 0),
                    factor: f,
                    precio_unitario: Number(l.precio_unitario || 0),
                    descuentos: [l.descuento1, l.descuento2, l.descuento3, l.descuento4].map((x: any) => Number(x) || 0),
                    iva_porcentaje: Number(l.iva_porcentaje ?? 21),
                });
            }
        }
    } else {
        const { porItem } = await conversionesDeRecepcion(supabase, null, [item]);
        recibido = item.cantidad_fisica_base != null ? Number(item.cantidad_fisica_base) : aUnidadesBase(item.cantidad_fisica, porItem.get(item.id)?.factorConteo ?? 1);
    }

    return { dif: calcularDiferencia({ oc, factura: lineasFactura, recibido_unidades: recibido, tipo_descuento: tipoDto }), hermanas, descuentoAlPie };
}

/** Qué se va a hacer, con los importes ya calculados. Lanza Rechazo si no corresponde. */
function plan(dif: DiferenciaLinea, tipo: 'precio' | 'cantidad', destino: Destino, d: any, sku: string, descuentoAlPie: boolean) {
    const devolver = Math.max(0, Number(d.devolver_unidades) || 0);
    // Devolver mercadería baja stock: solo tiene sentido en una diferencia de CANTIDAD que se le
    // reclama al proveedor o que asume la empresa. En cualquier otra combinación se rechaza.
    if (devolver > 0 && (tipo !== 'cantidad' || (destino !== 'proveedor' && destino !== 'empresa'))) {
        throw new Rechazo('Devolver mercadería solo se puede en una diferencia de cantidad, reclamándola al proveedor o asumiéndola la empresa. No se cambió nada.', 'devolucion_no_corresponde');
    }
    if (devolver > dif.recibido_unidades + 0.0001) {
        throw new Rechazo(`No se pueden devolver ${devolver} unidades: de este artículo entraron ${dif.recibido_unidades}.`, 'devolucion_mayor_a_lo_recibido');
    }
    const base = { devolver_unidades: devolver, transporte_id: d.transporte_id || null, descripcion: (d.descripcion || '').trim() || null, detalle: dif };

    if ((destino === 'espera_factura' || destino === 'bonificado') && (tipo !== 'cantidad' || dif.cantidad?.tipo !== 'sobrante')) {
        throw new Rechazo('"Esperamos la factura" y "sin cargo (bonificado)" son solo para mercadería que llegó de más.', 'destino_invalido');
    }

    if (tipo === 'precio') {
        const p = dif.precio;
        if (!p || !dif.factura) throw new Rechazo('Este artículo no tiene diferencia de precio entre la orden y la factura.', 'sin_diferencia');
        if (destino === 'empresa') {
            // Se toma el precio facturado como costo: lista y descuentos del renglón de la factura.
            // Si el artículo viene en renglones con precios distintos, o la factura trae un descuento al
            // pie, no hay UNA lista con sus descuentos que copiar: se deja solo el último costo (neto
            // promedio) y el precio de lista del artículo no se toca.
            const [d1 = 0, d2 = 0, d3 = 0, d4 = 0] = dif.factura.descuentos;
            const soloUltimoCosto = dif.factura.precios_distintos || descuentoAlPie;
            return { ...base, unidades: p.unidades, neto: p.neto, iva: p.iva, total: p.total, origen_nc: null,
                costo: soloUltimoCosto
                    ? { precio_compra: 0, descuento1: 0, descuento2: 0, descuento3: 0, descuento4: 0, ultimo_costo: Math.round(dif.factura.neto_unidad * 10000) / 10000 }
                    : { precio_compra: dif.factura.lista_unidad, descuento1: d1, descuento2: d2, descuento3: d3, descuento4: d4, ultimo_costo: Math.round(dif.factura.neto_unidad * 10000) / 10000 } };
        }
        if (p.a_favor !== 'nuestro') {
            throw new Rechazo('La factura vino MÁS BARATA que la orden: no hay nada para reclamarle al proveedor. Elegí "Empresa" para tomar el precio facturado como costo.', 'precio_a_favor_del_proveedor');
        }
        return { ...base, unidades: p.unidades, neto: p.neto, iva: p.iva, total: p.total,
            origen_nc: destino === 'descuento_fuera_factura' ? 'descuento_fuera_factura' : 'diferencia_precio',
            descripcion: base.descripcion || `Diferencia de precio ${sku}: ${p.unidades} u × ${moneda(p.por_unidad)}` };
    }

    // cantidad
    if (destino === 'descuento_fuera_factura') throw new Rechazo('"Descuento fuera de factura" es solo para diferencias de precio.', 'destino_invalido');
    const c = dif.cantidad;
    // Devolución al proveedor de mercadería que SÍ entró (rechazo, o un artículo que no se pidió):
    // se reclama lo facturado que no nos quedamos (incluye el faltante, si lo había).
    if (devolver > 0 && destino === 'proveedor') {
        const rec = reclamablePorDevolucion(dif, devolver);
        if (!(rec.total > 0)) {
            throw new Rechazo('Lo que se devuelve no estaba facturado: no corresponde una nota de crédito. Elegí devolverlo sin reclamo.', 'devolucion_sin_factura');
        }
        return { ...base, unidades: rec.unidades, neto: rec.neto, iva: rec.iva, total: rec.total, origen_nc: 'devolucion',
            descripcion: base.descripcion || `Devolución ${sku}: ${devolver} u devueltas${c?.tipo === 'faltante' ? ` + ${c.unidades} u facturadas y no recibidas` : ''}` };
    }
    if (!c) {
        // Sin factura (o coincide con lo recibido): no hay plata en juego. Solo se puede dar por cerrada.
        if (destino !== 'empresa') {
            throw new Rechazo(
                dif.factura
                    ? 'Lo facturado coincide con lo recibido: no hay diferencia de cantidad para reclamar.'
                    : 'Todavía no hay factura de este artículo: no hay nada para reclamar. Si falta mercadería que no se facturó, generá la orden de faltantes.',
                'sin_diferencia');
        }
        const faltaVsOC = dif.oc ? Math.max(0, dif.oc.unidades - dif.recibido_unidades) : 0;
        return { ...base, unidades: faltaVsOC, neto: 0, iva: 0, total: 0, origen_nc: null };
    }
    // ── SOBRANTE: llegó más de lo facturado. Hay que decir expresamente qué se hace (sin opción por defecto) ──
    if (c.tipo === 'sobrante') {
        const s = cuentaSobrante(dif)!;
        if (destino === 'espera_factura') {
            // Se recibe y el proveedor lo va a facturar: queda una nota de débito ESPERADA
            if (devolver > 0) throw new Rechazo('Si se devuelve el sobrante no hay factura que esperar.', 'destino_invalido');
            return { ...base, unidades: s.unidades, neto: s.espera_factura.neto, iva: s.espera_factura.iva, total: s.espera_factura.total, origen_nc: 'sobrante',
                descripcion: base.descripcion || `Mercadería de más ${sku}: ${s.unidades} u recibidas sin facturar` };
        }
        if (destino === 'bonificado') {
            // Se recibe sin cargo: no se paga de más; el costo real por unidad baja (solo último costo)
            if (devolver > 0) throw new Rechazo('Si se devuelve el sobrante no queda como bonificado.', 'destino_invalido');
            return { ...base, unidades: s.unidades, neto: 0, iva: 0, total: 0, origen_nc: null,
                costo: { precio_compra: 0, descuento1: 0, descuento2: 0, descuento3: 0, descuento4: 0, ultimo_costo: s.ultimo_costo_bonificado } };
        }
        if (destino === 'empresa' && devolver > 0) {
            // Se devuelve: sale del stock; no estaba facturado, no hay nada que reclamar
            return { ...base, unidades: c.unidades, neto: 0, iva: 0, total: 0, origen_nc: null };
        }
        throw new Rechazo(`Llegaron ${c.unidades} unidades MÁS de las facturadas. Hay que elegir qué se hace: se recibe y se espera la factura, se recibe sin cargo (bonificado), o se devuelve.`, 'sobrante');
    }
    if (destino === 'empresa') return { ...base, unidades: c.unidades, neto: c.neto, iva: c.iva, total: c.total, origen_nc: null };
    return { ...base, unidades: c.unidades, neto: c.neto, iva: c.iva, total: c.total,
        origen_nc: devolver > 0 ? 'devolucion' : 'faltante',
        descripcion: base.descripcion || `Faltante ${sku}: ${c.unidades} u facturadas y no recibidas` };
}

/**
 * Sin la función recepcion_resolver_diferencia (migración 20261117b sin aplicar) NO se puede
 * garantizar "todo o nada": una nota de crédito esperada creada y un fallo después dejarían la
 * nota suelta y el reintento crearía otra. Por eso, sin la migración solo se permite lo que no
 * mueve plata ni stock —"la empresa lo asume"— y para el proveedor, el transporte o una
 * devolución se contesta que falta aplicarla.
 */
async function resolverSinFuncion(supabase: any, item: any, hermanas: any[], tipo: 'precio' | 'cantidad', destino: Destino, p: any, usuarioId: string) {
    if (destino !== 'empresa' || p.devolver_unidades > 0) {
        throw new Rechazo('Todavía no se puede reclamar al proveedor, cargar al transporte, resolver un sobrante ni devolver mercadería desde acá: falta aplicar una actualización del sistema (migración 20261117b). No se cambió nada. Mientras tanto solo se puede elegir que la empresa lo asuma.', 'falta_migracion');
    }
    // Ya resuelta en esta línea o en otra entrega del mismo artículo de la orden
    const yaEsta = (l: any) => (tipo === 'precio' ? !!l.precio_verificado : !!l.cantidad_diferencia_destino);
    if (yaEsta(item) || hermanas.some(yaEsta)) return { ya_resuelta: true, destino: null };

    // Compuerta: la marca de la línea se pone solo si no estaba (dos clicks a la vez = uno)
    const marca = tipo === 'precio'
        ? supabase.from('recepciones_items').update({ precio_verificado: true }).eq('id', item.id).or('precio_verificado.is.null,precio_verificado.eq.false')
        : supabase.from('recepciones_items').update({ cantidad_diferencia_destino: 'empresa' }).eq('id', item.id).is('cantidad_diferencia_destino', null);
    const { data: ganada, error: marcaErr } = await marca.select('id');
    if (marcaErr) throw marcaErr;
    if (!ganada || ganada.length === 0) return { ya_resuelta: true, destino: null };

    // Aceptar el precio facturado: es el único cambio además de la marca. Si falla, la marca se saca.
    if (tipo === 'precio' && p.costo) {
        const cambios: Record<string, unknown> | null = p.costo.precio_compra > 0
            ? { precio_compra: p.costo.precio_compra, descuento1: p.costo.descuento1, descuento2: p.costo.descuento2, descuento3: p.costo.descuento3, descuento4: p.costo.descuento4, actualizado_por: usuarioId, ...(p.costo.ultimo_costo > 0 ? { ultimo_costo: p.costo.ultimo_costo } : {}) }
            : p.costo.ultimo_costo > 0 ? { ultimo_costo: p.costo.ultimo_costo } : null;
        if (cambios) {
            const { error } = await supabase.from('articulos').update(cambios).eq('id', item.articulo_id);
            if (error) {
                await supabase.from('recepciones_items').update({ precio_verificado: false }).eq('id', item.id);
                throw error;
            }
        }
    }
    return { ya_resuelta: false, destino, neto: p.neto, iva: p.iva, total: p.total, nc_esperada_id: null, movimiento_transporte_id: null, unidades_devueltas: 0, stock_antes: null };
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: recepcion_id } = await params;
        const body = await request.json();
        const { decisions } = body as { decisions: any[] };

        if (!decisions || decisions.length === 0) {
            return NextResponse.json({ error: 'decisions es requerido' }, { status: 400 });
        }

        const supabase = createAdminClient();

        const { data: recepcion } = await supabase
            .from('recepciones')
            .select('proveedor_id, transporte_id, conformidad_transporte, bultos_declarados, bultos_recibidos, conformidad_observaciones, orden_compra:ordenes_compra(id, proveedor_id)')
            .eq('id', recepcion_id)
            .single();
        const ocRel: any = Array.isArray(recepcion?.orden_compra) ? recepcion?.orden_compra[0] : recepcion?.orden_compra;
        const rec = {
            proveedorId: (recepcion?.proveedor_id || ocRel?.proveedor_id || null) as string | null,
            ocId: (ocRel?.id || null) as string | null,
            // Transporte por defecto: el registrado en el control de bultos de la recepción
            transporteId: (recepcion?.transporte_id || null) as string | null,
            // E-45: lo que el depósito dejó asentado contra el remito del transporte. Se lee de la base
            // (no del navegador) y va en la descripción del cargo y en el registro de la resolución.
            bultos: recepcion?.conformidad_transporte === 'no_conforme'
                ? `Control de bultos NO conforme: remito ${recepcion.bultos_declarados ?? '?'} bultos, contados ${recepcion.bultos_recibidos ?? '?'}${recepcion.conformidad_observaciones ? ` (${recepcion.conformidad_observaciones})` : ''}`
                : recepcion?.conformidad_transporte === 'conforme' ? 'Control de bultos firmado conforme' : null,
        };

        const results: any[] = [];

        // Cómo aplica los descuentos el proveedor (su ficha): en cascada o sobre la lista
        const tipoDto = await tipoDescuentoProveedor(supabase, rec.proveedorId);
        for (const decision of decisions) {
            const item_id = decision.item_id;
            const tipo: 'precio' | 'cantidad' = decision.tipo === 'precio' ? 'precio' : 'cantidad';
            // Forma vieja (accion A/B/C/D). En una diferencia de precio, "transporte" nunca existió: iba al proveedor.
            const porAccion: Record<string, Destino> = { A: 'empresa', B: tipo === 'precio' ? 'proveedor' : 'transporte', C: 'proveedor', D: 'descuento_fuera_factura' };
            const destino: Destino | undefined = DESTINOS.includes(decision.destino) ? decision.destino : porAccion[decision.accion];

            try {
                if (!destino) throw new Rechazo('Falta a quién se imputa la diferencia.', 'destino_invalido');

                // select('*'): trae también unidad_conteo / cantidad_fisica_base si la migración 20261116a está aplicada
                const { data: item, error: itemErr } = await supabase
                    .from('recepciones_items')
                    .select(`*, articulo:articulos(sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas, precio_compra, descuento1, descuento2, descuento3, descuento4)`)
                    .eq('id', item_id)
                    .maybeSingle();
                if (itemErr) throw itemErr;
                if (!item) throw new Rechazo('La línea de la recepción ya no existe.', 'no_encontrado');
                if (item.recepcion_id !== recepcion_id) throw new Rechazo('Esa línea no es de esta recepción.', 'linea_de_otra_recepcion');
                const articuloInfo = Array.isArray(item.articulo) ? item.articulo[0] : item.articulo;

                // La cuenta la hace el servidor: lo que mande el navegador como cantidad o precio no se usa
                const { dif, hermanas, descuentoAlPie } = await contexto(supabase, item, rec.ocId, tipoDto);
                const p: any = plan(dif, tipo, destino, decision, articuloInfo?.sku || '', descuentoAlPie);
                if (destino === 'transporte' && rec.bultos) {
                    p.descripcion = `${p.descripcion || 'Faltante de mercadería'}. ${rec.bultos}`;
                    p.detalle = { ...p.detalle, control_bultos: rec.bultos };
                }

                let r: any;
                let sinFuncion = false;
                const rpc = await supabase.rpc('recepcion_resolver_diferencia', {
                    p_item_id: item_id, p_tipo: tipo, p_destino: destino, p_usuario_id: auth.user.id, p_datos: p,
                });
                if (!rpc.error) r = rpc.data;
                else if (faltaLaFuncion(rpc.error, 'recepcion_resolver_diferencia')) { sinFuncion = true; r = await resolverSinFuncion(supabase, item, hermanas, tipo, destino, p, auth.user.id); }
                else if (rpc.error.code === 'P0001' || rpc.error.code === 'P0002') throw new Rechazo(rpc.error.message, String(rpc.error.details || 'rechazado'));
                else throw rpc.error;

                // Historial de costos: con la migración 20261117b lo anota la MISMA función, en la misma
                // transacción que cambia el costo (si no se puede anotar, no cambia nada). Sin la
                // migración se anota acá, y si falla se dice en pantalla.
                const costo = (p as { costo?: { precio_compra: number; descuento1: number; descuento2: number; descuento3: number; descuento4: number; ultimo_costo?: number } }).costo;
                let avisoHistorial = '';
                if (sinFuncion && !r.ya_resuelta && destino === 'empresa' && tipo === 'precio' && costo && (costo.precio_compra > 0 || (costo.ultimo_costo ?? 0) > 0)) {
                    const anotado = await registrarCostoEnHistorial(supabase, {
                        articulo_id: item.articulo_id, proveedor_id: rec.proveedorId,
                        precio_compra: costo.precio_compra > 0 ? costo.precio_compra : Number(articuloInfo?.precio_compra || 0),
                        descuentos: costo.precio_compra > 0
                            ? [costo.descuento1, costo.descuento2, costo.descuento3, costo.descuento4]
                            : [articuloInfo?.descuento1, articuloInfo?.descuento2, articuloInfo?.descuento3, articuloInfo?.descuento4].map((x: unknown) => Number(x) || 0),
                        ultimo_costo: (costo.ultimo_costo ?? 0) > 0 ? costo.ultimo_costo : null, origen: 'diferencia_precio', orden_compra_id: rec.ocId, usuario_id: auth.user.id,
                    });
                    if (!anotado) avisoHistorial = ' ATENCIÓN: el costo del artículo cambió pero no se pudo anotar en el historial de costos; avisá a sistemas.';
                }

                // Kardex de la devolución: solo si de verdad se devolvió mercadería que había entrado
                let avisoKardex = '';
                if (!r.ya_resuelta && Number(r.unidades_devueltas) > 0) {
                    // Valorizada a lo facturado; si no estaba facturado, al precio de la orden
                    const precio = dif.factura?.neto_unidad || dif.oc?.neto_unidad || 0;
                    const subtotal = Math.round(precio * Number(r.unidades_devueltas) * 100) / 100;
                    try {
                        await insertarKardex(supabase, {
                            tipo_movimiento: 'devolucion_compra',
                            estado: 'confirmado',
                            fecha: nowArgentina(),
                            articulo_id: item.articulo_id,
                            cantidad: Number(r.unidades_devueltas),
                            precio_lista: precio,
                            precio_unitario_final: precio,
                            subtotal_neto: subtotal,
                            subtotal_total: subtotal,
                            proveedor_id: rec.proveedorId || undefined,
                            recepcion_id,
                            orden_compra_id: rec.ocId || undefined,
                            stock_antes: r.stock_antes ?? undefined,
                            stock_despues: r.stock_antes != null ? Number(r.stock_antes) - Number(r.unidades_devueltas) : undefined,
                            operador_id: auth.user.id,
                        }, {
                            sku: articuloInfo?.sku, descripcion: articuloInfo?.descripcion, categoria: articuloInfo?.categoria,
                            marca_id: articuloInfo?.marca_id, proveedor_id: articuloInfo?.proveedor_id,
                            iva_compras: articuloInfo?.iva_compras, iva_ventas: articuloInfo?.iva_ventas,
                        });
                    } catch (e: any) {
                        console.error('[cerrar] kardex de devolución:', e?.message || e);
                        avisoKardex = ' ATENCIÓN: el stock bajó pero no se pudo anotar el movimiento en el kardex; avisá a sistemas.';
                    }
                }

                const mensaje = r.ya_resuelta
                    ? 'Esta diferencia ya estaba resuelta: no se generó nada nuevo.'
                    : destino === 'espera_factura'
                        ? `La mercadería de más quedó recibida y se espera la factura del proveedor por ${moneda(p.total)} (${moneda(p.neto)} neto + ${moneda(p.iva)} de IVA). No es deuda hasta que llegue.`
                    : destino === 'bonificado'
                        ? `La mercadería de más quedó recibida sin cargo: no se paga nada más${costo && (costo.ultimo_costo ?? 0) > 0 ? ` y el último costo del artículo pasó a ${moneda(costo.ultimo_costo)} por unidad` : ''}. El precio de lista no se tocó.`
                    : destino === 'proveedor' || destino === 'descuento_fuera_factura'
                        ? `Quedó una nota de crédito esperada por ${moneda(p.total)} (${moneda(p.neto)} neto + ${moneda(p.iva)} de IVA).`
                        : destino === 'transporte'
                            ? `Se cargaron ${moneda(p.total)} a la cuenta del transporte.`
                            : tipo === 'precio'
                                ? (costo && !(costo.precio_compra > 0)
                                    ? 'Se aceptó el precio facturado. Como el artículo viene con precios distintos o la factura tiene un descuento al pie, el precio de lista del artículo NO se tocó: quedó solo el último costo.'
                                    : 'Se tomó el precio facturado como costo del artículo.')
                                : 'La diferencia quedó asumida por la empresa.';
                const devueltas = !r.ya_resuelta && Number(r.unidades_devueltas) > 0 ? ` Salieron ${Number(r.unidades_devueltas)} unidades del stock (mercadería devuelta).` : "";
                results.push({ item_id, tipo, destino, accion: decision.accion, success: true, ...r, unidades: p.unidades, mensaje: mensaje + devueltas + avisoKardex + avisoHistorial });
            } catch (e: any) {
                if (e instanceof Rechazo) results.push({ item_id, tipo, destino, accion: decision.accion, error: e.message, codigo: e.codigo });
                else {
                    console.error('[Cerrar Recepción] línea', item_id, e);
                    results.push({ item_id, tipo, destino, accion: decision.accion, error: `No se pudo resolver y no se aplicó ningún cambio. Detalle para sistemas: ${e?.message || e}`, codigo: 'error_interno' });
                }
            }
        }

        return NextResponse.json({ success: results.every((r) => !r.error), results });

    } catch (error: any) {
        console.error('[Cerrar Recepción] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
