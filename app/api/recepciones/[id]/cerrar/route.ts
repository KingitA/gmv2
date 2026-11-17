import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { conversionesDeRecepcion } from '@/lib/deposito/recepciones';
import { aUnidadesBase, unidadesPorBultoDe } from '@/lib/deposito/unidades';
import { calcularDiferencia, reclamablePorDevolucion, type DiferenciaLinea, type LineaFactura, type LineaOC } from '@/lib/compras/diferencias';
import { TIPOS_CON_PRECIOS } from '@/lib/compras/finalizar-oc';
import { registrarCostoEnHistorial } from '@/lib/compras/costo-y-kardex';
import { insertarKardex } from '@/lib/kardex/insertar-kardex';
import { faltaLaFuncion } from '@/lib/utils/migracion-pendiente';
import { nowArgentina } from '@/lib/utils';
import { hoyISO, moneda } from '@/lib/formato';

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
// Sin ella: los mismos pasos, de a uno, con las marcas de la línea como compuerta.
//
// Las imputaciones al proveedor NO acreditan la cuenta corriente: crean una NC 'esperada'
// (comprobantes_compra estado=esperada) que se confirma con ncp_registrar cuando llega el
// documento y se imputa contra la factura con ccp_imputar_credito.

type Destino = 'empresa' | 'proveedor' | 'transporte' | 'descuento_fuera_factura';
const DESTINOS: Destino[] = ['empresa', 'proveedor', 'transporte', 'descuento_fuera_factura'];
const NO_ES_FACTURA = '(NC,NCA,NCB,NCC,Reversa,Remito)';

class Rechazo extends Error {
    constructor(message: string, public codigo: string) { super(message); }
}

/** Lo pedido, lo recibido y lo facturado de la línea, con la cuenta hecha. */
async function contexto(supabase: any, item: any, ocId: string | null): Promise<DiferenciaLinea> {
    const articuloId = item.articulo_id;
    const { data: art } = await supabase.from('articulos').select('unidades_por_bulto').eq('id', articuloId).maybeSingle();
    const upb = unidadesPorBultoDe(art?.unidades_por_bulto);

    let oc: LineaOC | null = null;
    const lineasFactura: LineaFactura[] = [];
    let recibido = 0;

    if (ocId) {
        const { data: ocd, error: ocErr } = await supabase
            .from('ordenes_compra_detalle')
            .select('cantidad_pedida, tipo_cantidad, precio_unitario, descuento1, descuento2, descuento3, descuento4')
            .eq('orden_compra_id', ocId)
            .eq('articulo_id', articuloId)
            .limit(1);
        if (ocErr) throw ocErr;
        const d = ocd?.[0];
        if (d) {
            oc = {
                cantidad_pedida: Number(d.cantidad_pedida || 0),
                factor: d.tipo_cantidad === 'unidad' ? 1 : upb,
                precio_unitario: Number(d.precio_unitario || 0),
                descuentos: [d.descuento1, d.descuento2, d.descuento3, d.descuento4].map((x: any) => Number(x) || 0),
            };
        }

        // Lo recibido del artículo en todas las tandas de la orden (en unidades)
        const { data: recs, error: recErr } = await supabase.from('recepciones').select('id').eq('orden_compra_id', ocId).neq('estado', 'cancelada');
        if (recErr) throw recErr;
        const recIds = (recs || []).map((r: any) => r.id);
        const { data: filas, error: filasErr } = recIds.length
            ? await supabase.from('recepciones_items').select('*').in('recepcion_id', recIds).eq('articulo_id', articuloId)
            : { data: [], error: null };
        if (filasErr) throw filasErr;
        const items: any[] = filas || [];
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
            .select('id, tipo_comprobante')
            .eq('orden_compra_id', ocId)
            .neq('estado', 'esperada')
            .in('tipo_comprobante', TIPOS_CON_PRECIOS);
        if (compErr) throw compErr;
        const compIds = (comps || []).map((c: any) => c.id);
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

    return calcularDiferencia({ oc, factura: lineasFactura, recibido_unidades: recibido });
}

/** Qué se va a hacer, con los importes ya calculados. Lanza Rechazo si no corresponde. */
function plan(dif: DiferenciaLinea, tipo: 'precio' | 'cantidad', destino: Destino, d: any, sku: string) {
    const devolver = Math.max(0, Number(d.devolver_unidades) || 0);
    if (devolver > dif.recibido_unidades + 0.0001) {
        throw new Rechazo(`No se pueden devolver ${devolver} unidades: de este artículo entraron ${dif.recibido_unidades}.`, 'devolucion_mayor_a_lo_recibido');
    }
    const base = { devolver_unidades: devolver, transporte_id: d.transporte_id || null, descripcion: (d.descripcion || '').trim() || null, detalle: dif };

    if (tipo === 'precio') {
        const p = dif.precio;
        if (!p || !dif.factura) throw new Rechazo('Este artículo no tiene diferencia de precio entre la orden y la factura.', 'sin_diferencia');
        if (destino === 'empresa') {
            // Se toma el precio facturado como costo: lista y descuentos del renglón de la factura
            const [d1 = 0, d2 = 0, d3 = 0, d4 = 0] = dif.factura.descuentos;
            return { ...base, unidades: p.unidades, neto: p.neto, iva: p.iva, total: p.total, origen_nc: null,
                costo: { precio_compra: dif.factura.lista_unidad, descuento1: d1, descuento2: d2, descuento3: d3, descuento4: d4 } };
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
    if (c.tipo === 'sobrante' && destino !== 'empresa') {
        throw new Rechazo(`Llegaron ${c.unidades} unidades MÁS de las facturadas: no corresponde una nota de crédito ni un cargo al transporte. Se puede aceptar el sobrante o devolverlo.`, 'sobrante');
    }
    if (destino === 'empresa') return { ...base, unidades: c.unidades, neto: c.neto, iva: c.iva, total: c.total, origen_nc: null };
    return { ...base, unidades: c.unidades, neto: c.neto, iva: c.iva, total: c.total,
        origen_nc: devolver > 0 ? 'devolucion' : 'faltante',
        descripcion: base.descripcion || `Faltante ${sku}: ${c.unidades} u facturadas y no recibidas` };
}

/** Los mismos pasos que recepcion_resolver_diferencia, de a uno (migración 20261117b sin aplicar). */
async function resolverSinFuncion(supabase: any, item: any, rec: any, tipo: 'precio' | 'cantidad', destino: Destino, p: any, usuarioId: string) {
    if ((tipo === 'precio' && item.precio_verificado) || (tipo === 'cantidad' && item.cantidad_diferencia_destino)) {
        return { ya_resuelta: true, destino: tipo === 'cantidad' ? item.cantidad_diferencia_destino : null };
    }
    // Compuerta: la marca de la línea se pone primero y solo si no estaba (dos clicks a la vez = uno)
    const marca = tipo === 'precio'
        ? supabase.from('recepciones_items').update({ precio_verificado: true }).eq('id', item.id).or('precio_verificado.is.null,precio_verificado.eq.false')
        : supabase.from('recepciones_items').update({ cantidad_diferencia_destino: destino === 'descuento_fuera_factura' ? 'proveedor' : destino }).eq('id', item.id).is('cantidad_diferencia_destino', null);
    const { data: ganada, error: marcaErr } = await marca.select('id');
    if (marcaErr) throw marcaErr;
    if (!ganada || ganada.length === 0) return { ya_resuelta: true, destino: null };

    const deshacerMarca = () => supabase.from('recepciones_items')
        .update(tipo === 'precio' ? { precio_verificado: false } : { cantidad_diferencia_destino: null }).eq('id', item.id);

    try {
        let ncId: string | null = null;
        let movId: string | null = null;
        let stockAntes: number | null = null;

        if (destino === 'proveedor' || destino === 'descuento_fuera_factura') {
            if (!rec.proveedorId) throw new Rechazo('La recepción no tiene proveedor: no se puede dejar la nota de crédito esperada.', 'sin_proveedor');
            if (!(p.total > 0)) throw new Rechazo('La diferencia no tiene importe: no hay nada para reclamarle al proveedor.', 'sin_importe');
            let asociadoId: string | null = null;
            if (rec.ocId) {
                const { data: fa } = await supabase.from('comprobantes_compra').select('id')
                    .eq('orden_compra_id', rec.ocId).not('tipo_comprobante', 'in', NO_ES_FACTURA).neq('estado', 'esperada')
                    .order('fecha_comprobante', { ascending: false }).limit(1).maybeSingle();
                asociadoId = fa?.id || null;
            }
            const { data: nc, error } = await supabase.from('comprobantes_compra').insert({
                orden_compra_id: rec.ocId || null,
                proveedor_id: rec.proveedorId,
                tipo_comprobante: 'NC',
                numero_comprobante: `ESPERADA-${Date.now()}`,
                fecha_comprobante: hoyISO(),
                total_factura_declarado: p.total,
                total_neto: p.neto,
                total_iva: p.iva,
                estado: 'esperada',
                origen_nc: p.origen_nc,
                comprobante_asociado_id: asociadoId,
                ajusta_stock: false,
            }).select('id').single();
            if (error) throw error;
            ncId = nc.id;
        }

        if (destino === 'transporte') {
            const transporteId = p.transporte_id || rec.transporteId;
            if (!transporteId) throw new Rechazo('Elegí el transporte al que se le carga la diferencia.', 'sin_transporte');
            if (!(p.total > 0)) throw new Rechazo('La diferencia no tiene importe: no hay nada para cargarle al transporte.', 'sin_importe');
            const { data: mov, error } = await supabase.from('cuenta_corriente_transportes').insert({
                transporte_id: transporteId,
                tipo_movimiento: 'faltante_mercaderia',
                monto: p.total,
                descripcion: p.descripcion || 'Faltante de mercadería',
                referencia_id: item.recepcion_id,
                referencia_tipo: 'recepcion',
                creado_por: usuarioId,
            }).select('id').single();
            if (error) throw error;
            movId = mov.id;
        }

        if (destino === 'empresa' && tipo === 'precio' && p.costo?.precio_compra > 0) {
            const { error } = await supabase.from('articulos').update({ ...p.costo, actualizado_por: usuarioId }).eq('id', item.articulo_id);
            if (error) throw error;
        }

        if (p.devolver_unidades > 0) {
            const { data: art, error: leerErr } = await supabase.from('articulos').select('stock_actual').eq('id', item.articulo_id).single();
            if (leerErr) throw leerErr;
            stockAntes = Number(art.stock_actual || 0);
            const { error } = await supabase.from('articulos').update({ stock_actual: stockAntes - p.devolver_unidades }).eq('id', item.articulo_id);
            if (error) throw error;
        }

        return { ya_resuelta: false, destino, neto: p.neto, iva: p.iva, total: p.total, nc_esperada_id: ncId, movimiento_transporte_id: movId, unidades_devueltas: p.devolver_unidades, stock_antes: stockAntes };
    } catch (e) {
        await deshacerMarca();
        throw e;
    }
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
            .select('proveedor_id, transporte_id, orden_compra:ordenes_compra(id, proveedor_id)')
            .eq('id', recepcion_id)
            .single();
        const ocRel: any = Array.isArray(recepcion?.orden_compra) ? recepcion?.orden_compra[0] : recepcion?.orden_compra;
        const rec = {
            proveedorId: (recepcion?.proveedor_id || ocRel?.proveedor_id || null) as string | null,
            ocId: (ocRel?.id || null) as string | null,
            // Transporte por defecto: el registrado en el control de bultos de la recepción
            transporteId: (recepcion?.transporte_id || null) as string | null,
        };

        const results: any[] = [];

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
                    .select(`*, articulo:articulos(sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas)`)
                    .eq('id', item_id)
                    .maybeSingle();
                if (itemErr) throw itemErr;
                if (!item) throw new Rechazo('La línea de la recepción ya no existe.', 'no_encontrado');
                const articuloInfo = Array.isArray(item.articulo) ? item.articulo[0] : item.articulo;

                // La cuenta la hace el servidor: lo que mande el navegador como cantidad o precio no se usa
                const dif = await contexto(supabase, item, rec.ocId);
                const p = plan(dif, tipo, destino, decision, articuloInfo?.sku || '');

                let r: any;
                const rpc = await supabase.rpc('recepcion_resolver_diferencia', {
                    p_item_id: item_id, p_tipo: tipo, p_destino: destino, p_usuario_id: auth.user.id, p_datos: p,
                });
                if (!rpc.error) r = rpc.data;
                else if (faltaLaFuncion(rpc.error, 'recepcion_resolver_diferencia')) r = await resolverSinFuncion(supabase, item, rec, tipo, destino, p, auth.user.id);
                else if (rpc.error.code === 'P0001' || rpc.error.code === 'P0002') throw new Rechazo(rpc.error.message, String(rpc.error.details || 'rechazado'));
                else throw rpc.error;

                // Cambió el costo de lista del artículo (se aceptó el precio facturado): queda en el historial
                const costo = (p as { costo?: { precio_compra: number; descuento1: number; descuento2: number; descuento3: number; descuento4: number } }).costo;
                if (!r.ya_resuelta && destino === 'empresa' && tipo === 'precio' && costo && costo.precio_compra > 0) {
                    await registrarCostoEnHistorial(supabase, {
                        articulo_id: item.articulo_id, proveedor_id: rec.proveedorId, precio_compra: costo.precio_compra,
                        descuentos: [costo.descuento1, costo.descuento2, costo.descuento3, costo.descuento4],
                    });
                }

                // Kardex de la devolución: solo si de verdad se devolvió mercadería que había entrado
                if (!r.ya_resuelta && Number(r.unidades_devueltas) > 0 && dif.factura) {
                    const precio = dif.factura.neto_unidad;
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
                    }
                }

                const mensaje = r.ya_resuelta
                    ? 'Esta diferencia ya estaba resuelta: no se generó nada nuevo.'
                    : destino === 'proveedor' || destino === 'descuento_fuera_factura'
                        ? `Quedó una nota de crédito esperada por ${moneda(p.total)} (${moneda(p.neto)} neto + ${moneda(p.iva)} de IVA).`
                        : destino === 'transporte'
                            ? `Se cargaron ${moneda(p.total)} a la cuenta del transporte.`
                            : tipo === 'precio'
                                ? 'Se tomó el precio facturado como costo del artículo.'
                                : 'La diferencia quedó asumida por la empresa.';
                const devueltas = !r.ya_resuelta && Number(r.unidades_devueltas) > 0 ? ` Salieron ${Number(r.unidades_devueltas)} unidades del stock (mercadería devuelta).` : "";
                results.push({ item_id, tipo, destino, accion: decision.accion, success: true, ...r, unidades: p.unidades, mensaje: mensaje + devueltas });
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
