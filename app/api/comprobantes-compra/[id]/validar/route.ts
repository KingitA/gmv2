import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { nowArgentina } from '@/lib/utils';
import { fechaISO, mediodiaAR, sumarDiasISO } from '@/lib/formato';
import { unidadesPorBultoDe } from '@/lib/deposito/unidades';

// ─────────────────────────────────────────────────────────────────────────────
// Validar un comprobante de compra (E-32).
//
// Reglas (las mismas con y sin la migración 20261116c):
//   · Un comprobante ya validado NO vuelve a generar deuda ni vencimiento.
//   · Con renglones sin artículo no se valida.
//   · Sin total no se valida, salvo que sea un Remito: el remito queda validado como
//     respaldo de cantidades, sin deuda, sin vencimiento y sin tocar la provisión.
//   · La provisión de la OC baja por lo que se va facturando y se elimina recién cuando
//     no quedan comprobantes de deuda sin validar en esa OC.
//   · Nota de débito = deuda (suma); nota de crédito / reversa = crédito (resta).
//
// Con la migración: todo lo que mueve plata (estado, cuenta corriente, provisión,
// vencimiento) lo hace la función SQL `comprobante_compra_validar` en una transacción.
// Sin la migración: los mismos pasos, de a uno, con el cambio de estado como compuerta
// (UPDATE ... WHERE estado no validado): dos clicks a la vez validan una sola vez, pero
// un corte a mitad de camino puede dejar el comprobante validado sin su vencimiento.
// ─────────────────────────────────────────────────────────────────────────────

const CREDITO = ['NC', 'NCA', 'NCB', 'NCC', 'Reversa'];
const NOTA_DEBITO = ['ND', 'NDA', 'NDB', 'NDC'];
const YA_VALIDADO = ['validado', 'cerrado'];

const faltaFuncion = (e: any) => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(String(e.message || '')));

class Rechazo extends Error {
    constructor(message: string, public codigo: string, public status = 422) { super(message); }
}

interface PlanVencimiento {
    canal: 'blanco' | 'negro';
    fecha_vencimiento: string | null;
    forma_pago: string | null;
    modalidad: string | null;
    fecha_validez: string | null;
    numero_orden: string | null;
}

interface Resultado {
    ya_validado: boolean;
    sin_deuda?: boolean;
    movimiento_cc_id?: string | null;
    vencimiento_id?: string | null;
    sin_vencimiento?: boolean;
    provision?: string;
}

/** Vencimiento según el acuerdo de pago del CANAL del proveedor (Ficha Fiscal, fase S3). Solo calcula: no escribe. */
async function armarPlan(supabase: any, comprobante: any, proveedorId: string | null, ocId: string | null, numeroOrden: string | null): Promise<PlanVencimiento> {
    // Adquisición = canal negro
    const canal: 'blanco' | 'negro' = comprobante.tipo_comprobante === 'Adquisicion' ? 'negro' : 'blanco';
    const plan: PlanVencimiento = {
        canal,
        fecha_vencimiento: comprobante.fecha_vencimiento ? String(comprobante.fecha_vencimiento).slice(0, 10) : null,
        forma_pago: null, modalidad: null, fecha_validez: null, numero_orden: numeroOrden,
    };
    if (!proveedorId) return plan;

    const { data: prov } = await supabase
        .from('proveedores')
        .select('dias_vencimiento, pago_blanco_medio, pago_blanco_plazo_cheque, pago_blanco_entrega, pago_blanco_dias, pago_blanco_desde, pago_negro_medio, pago_negro_plazo_cheque, pago_negro_entrega, pago_negro_dias, pago_negro_desde')
        .eq('id', proveedorId)
        .maybeSingle();
    const p: any = prov || {};
    // Canal negro sin configurar → hereda el acuerdo blanco
    const cfg = canal === 'negro' && (p.pago_negro_medio || p.pago_negro_dias != null || p.pago_negro_entrega)
        ? { medio: p.pago_negro_medio, plazoCheque: p.pago_negro_plazo_cheque, entrega: p.pago_negro_entrega, dias: p.pago_negro_dias, desde: p.pago_negro_desde }
        : { medio: p.pago_blanco_medio, plazoCheque: p.pago_blanco_plazo_cheque, entrega: p.pago_blanco_entrega, dias: p.pago_blanco_dias, desde: p.pago_blanco_desde };

    // Medio → forma_pago del vencimiento (cheques y mixto = 'cheque')
    plan.forma_pago = cfg.medio === 'transferencia' ? 'transferencia'
        : cfg.medio === 'efectivo' ? 'efectivo'
        : (cfg.medio === 'cheques' || cfg.medio === 'cheques_y_efectivo') ? 'cheque'
        : null;
    // Entrega → modalidad
    plan.modalidad = cfg.entrega === 'deposito_bancario' ? 'deposito'
        : cfg.entrega === 'retira_oficina' ? 'entrega'
        : cfg.entrega === 'envio_grimar' ? 'grimar'
        : null;

    if (!plan.fecha_vencimiento) {
        // Base del plazo: fecha de factura o de recepción según el acuerdo
        let fechaBase: string | null = comprobante.fecha_comprobante || null;
        if (cfg.desde === 'recepcion' && ocId) {
            const { data: rec } = await supabase
                .from('recepciones')
                .select('fecha_fin, fecha_inicio, created_at')
                .eq('orden_compra_id', ocId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            const f = (rec as any)?.fecha_fin || (rec as any)?.fecha_inicio || (rec as any)?.created_at;
            if (f) fechaBase = fechaISO(f) || null; // timestamptz → día argentino
        }
        const dias = Number(cfg.dias ?? p.dias_vencimiento ?? 0);
        // cfg.dias explícito admite 0 (contado); sin config, exige > 0
        if (fechaBase && (cfg.dias != null || dias > 0)) plan.fecha_vencimiento = sumarDiasISO(fechaBase, dias);
    }
    // Cheques con plazo: validez = vencimiento + plazo del cheque
    if (plan.fecha_vencimiento && plan.forma_pago === 'cheque' && Number(cfg.plazoCheque ?? 0) > 0) {
        plan.fecha_validez = sumarDiasISO(plan.fecha_vencimiento, Number(cfg.plazoCheque));
    }
    return plan;
}

/**
 * Los mismos pasos que la función SQL, de a uno (migración 20261116c sin aplicar).
 * La compuerta es el UPDATE de estado con condición: solo UNA llamada lo gana.
 */
async function validarSinFuncion(supabase: any, comprobante: any, proveedorId: string | null, ocId: string | null, plan: PlanVencimiento, usuarioId: string): Promise<Resultado> {
    const id = comprobante.id;
    const movimientoPropio = async (): Promise<string | null> => {
        const { data } = await supabase.from('cuenta_corriente_proveedores')
            .select('id').eq('referencia_tipo', 'comprobante_compra').eq('referencia_id', id)
            .order('created_at', { ascending: true }).limit(1);
        return data?.[0]?.id ?? null;
    };

    if (YA_VALIDADO.includes(comprobante.estado)) return { ya_validado: true, movimiento_cc_id: await movimientoPropio() };
    if (comprobante.estado === 'esperada') {
        throw new Rechazo('Es una nota de crédito esperada: se registra desde "NC pendientes" cuando llega el documento, no se valida acá.', 'nc_esperada');
    }

    const { count: sinArticulo, error: detErr } = await supabase
        .from('comprobantes_compra_detalle')
        .select('id', { count: 'exact', head: true })
        .eq('comprobante_id', id)
        .is('articulo_id', null);
    if (detErr) throw detErr;
    if ((sinArticulo || 0) > 0) {
        throw new Rechazo(`Hay ${sinArticulo} renglón(es) del comprobante sin vincular a un artículo. Vinculalos (o quitá los que no son mercadería) en "Revisar matches" antes de validar.`, 'lineas_sin_articulo');
    }

    const total = Number(comprobante.total_factura_declarado || 0);
    const esCredito = CREDITO.includes(comprobante.tipo_comprobante);
    const esNotaDebito = NOTA_DEBITO.includes(comprobante.tipo_comprobante);
    const esRemito = comprobante.tipo_comprobante === 'Remito';
    if (!esRemito && total <= 0) {
        throw new Rechazo(`El comprobante ${comprobante.tipo_comprobante} ${comprobante.numero_comprobante} no tiene total. Cargale el total (lápiz de editar) antes de validarlo; si es solo un remito, cambiale el tipo a Remito.`, 'sin_total');
    }

    // ── Compuerta: pasa a validado solo si todavía no lo estaba ──
    const pasarAValidado = (conAuditoria: boolean) => supabase
        .from('comprobantes_compra')
        .update({
            estado: 'validado',
            ...(conAuditoria ? { usuario_validador: usuarioId, fecha_validacion: nowArgentina() } : {}),
            saldo_pendiente: esRemito ? 0 : esCredito ? -total : total,
            estado_pago: 'pendiente',
        })
        .eq('id', id)
        .not('estado', 'in', '(validado,cerrado,esperada)')
        .select('id');
    let { data: ganado, error: updErr } = await pasarAValidado(true);
    // Si las columnas de "quién validó" no existieran, el estado se cambia igual: lo que
    // nunca puede pasar es seguir generando deuda con el comprobante sin validar.
    if (updErr && (updErr.code === 'PGRST204' || updErr.code === '42703')) ({ data: ganado, error: updErr } = await pasarAValidado(false));
    if (updErr) throw updErr;
    if (!ganado || ganado.length === 0) return { ya_validado: true, movimiento_cc_id: await movimientoPropio() };

    if (esRemito) return { ya_validado: false, sin_deuda: true, movimiento_cc_id: null, vencimiento_id: null, provision: 'intacta' };

    // ── Cuenta corriente (igual que siempre: solo comprobantes de una OC) ──
    let ccMovId: string | null = null;
    let provision = 'sin_provision';
    if (ocId && proveedorId) {
        const tipoMovimiento = esCredito ? 'nota_credito' : esNotaDebito ? 'nota_debito' : 'factura';
        const monto = esCredito ? -total : total;
        const descripcion = `${comprobante.tipo_comprobante} ${comprobante.numero_comprobante} — OC ${plan.numero_orden || ''}`;
        const fecha = comprobante.fecha_comprobante ? mediodiaAR(comprobante.fecha_comprobante) : nowArgentina();

        ccMovId = await movimientoPropio();
        if (!ccMovId && comprobante.numero_comprobante) {
            // Entró por mail: la provisión ya se convirtió en la factura (sigue referenciada a la OC). Se adopta.
            const { data: porMail } = await supabase.from('cuenta_corriente_proveedores')
                .select('id')
                .eq('referencia_tipo', 'orden_compra').eq('referencia_id', ocId)
                .neq('tipo_movimiento', 'orden_compra')
                .eq('numero_comprobante', comprobante.numero_comprobante)
                .order('created_at', { ascending: true }).limit(1);
            if (porMail?.[0]?.id) {
                const { error } = await supabase.from('cuenta_corriente_proveedores')
                    .update({ referencia_tipo: 'comprobante_compra', referencia_id: id, tipo_movimiento: tipoMovimiento, monto, descripcion, tipo_comprobante: comprobante.tipo_comprobante, fecha })
                    .eq('id', porMail[0].id);
                if (error) throw error;
                ccMovId = porMail[0].id;
            }
        }
        if (!ccMovId) {
            const { data: ccMov, error } = await supabase.from('cuenta_corriente_proveedores').insert({
                proveedor_id: proveedorId,
                tipo_movimiento: tipoMovimiento,
                monto,
                descripcion,
                referencia_id: id,
                referencia_tipo: 'comprobante_compra',
                numero_comprobante: comprobante.numero_comprobante,
                tipo_comprobante: comprobante.tipo_comprobante,
                fecha,
            }).select('id').single();
            if (error) throw error;
            ccMovId = ccMov.id;
        }

        // ── Provisión de la OC: baja por lo facturado; se va cuando no queda nada por validar ──
        if (!esCredito) {
            const { count: otros } = await supabase
                .from('comprobantes_compra')
                .select('id', { count: 'exact', head: true })
                .eq('orden_compra_id', ocId)
                .neq('id', id)
                .not('estado', 'in', '(validado,cerrado,esperada)')
                .not('tipo_comprobante', 'in', '(Remito,NC,NCA,NCB,NCC,Reversa)');
            const { data: provisiones } = await supabase.from('cuenta_corriente_proveedores')
                .select('id, monto')
                .eq('referencia_tipo', 'orden_compra').eq('referencia_id', ocId).eq('tipo_movimiento', 'orden_compra')
                .order('created_at', { ascending: true });
            let restante = total;
            for (const pr of provisiones || []) {
                const montoProv = Number(pr.monto || 0);
                if ((otros || 0) === 0 || montoProv - restante <= 0.01) {
                    const { error } = await supabase.from('cuenta_corriente_proveedores').delete().eq('id', pr.id);
                    if (error) throw error;
                    restante = Math.max(0, restante - montoProv);
                    provision = 'eliminada';
                } else {
                    const { error } = await supabase.from('cuenta_corriente_proveedores')
                        .update({ monto: Math.round((montoProv - restante) * 100) / 100, descripcion: `Provisión OC: ${plan.numero_orden || ''} (resto sin facturar)` })
                        .eq('id', pr.id);
                    if (error) throw error;
                    restante = 0;
                    provision = 'reducida';
                }
            }
        }
    }

    // ── Vencimiento (solo deuda), uno solo ──
    let vencimientoId: string | null = null;
    if (!esCredito) {
        if (plan.fecha_vencimiento && !comprobante.fecha_vencimiento) {
            await supabase.from('comprobantes_compra').update({ fecha_vencimiento: plan.fecha_vencimiento }).eq('id', id);
        }
        const filtros = [`and(referencia_tipo.eq.comprobante_compra,referencia_id.eq.${id})`];
        if (ccMovId) filtros.push(`and(referencia_tipo.eq.cuenta_corriente,referencia_id.eq.${ccMovId})`);
        const { data: yaHay } = await supabase.from('vencimientos').select('id').neq('estado', 'cancelado').or(filtros.join(',')).limit(1);
        vencimientoId = yaHay?.[0]?.id ?? null;

        if (!vencimientoId && plan.fecha_vencimiento) {
            const { data: venc, error: vencErr } = await supabase.from('vencimientos').insert({
                proveedor_id: proveedorId,
                tipo: 'factura',
                canal: plan.canal,
                concepto: `${comprobante.tipo_comprobante} ${comprobante.numero_comprobante} — OC ${plan.numero_orden || ''}`,
                monto: total,
                fecha_vencimiento: plan.fecha_vencimiento,
                estado: 'pendiente',
                forma_pago: plan.forma_pago,
                modalidad: plan.modalidad,
                fecha_validez: plan.fecha_validez,
                referencia_id: ccMovId || id,
                referencia_tipo: ccMovId ? 'cuenta_corriente' : 'comprobante_compra',
            }).select('id').single();
            if (vencErr) console.error('[Validar] no se pudo crear el vencimiento:', vencErr.message);
            vencimientoId = venc?.id ?? null;
        }
    }

    return { ya_validado: false, sin_deuda: false, movimiento_cc_id: ccMovId, vencimiento_id: vencimientoId, sin_vencimiento: !esCredito && !vencimientoId, provision };
}

/**
 * Kardex de la compra: confirma lo pendiente de la OC y revaloriza lo que entró a $0.
 * No mueve plata y es repetible (lo ya confirmado / ya valorizado no se vuelve a tocar),
 * así que corre siempre, también cuando el comprobante ya estaba validado.
 */
async function actualizarKardex(supabase: any, comprobante: any, ocId: string) {
    const comprobante_id = comprobante.id;
    // En OC mixtas (parte factura, parte adquisición de stock) cada comprobante confirma
    // solo las líneas de su régimen: una factura confirma lo blanco, una adquisición lo
    // negro; 'mixto' con cualquiera.
    const esAdquisicion = ['Adquisicion', 'Reversa'].includes(comprobante.tipo_comprobante);
    const { data: pendientes } = await supabase.from('kardex')
        .select('id, articulo_iva_compras')
        .eq('orden_compra_id', ocId)
        .eq('estado', 'pendiente');

    const idsAConfirmar = (pendientes || [])
        .filter((k: any) => {
            const regimen = k.articulo_iva_compras;
            if (!regimen || regimen === 'mixto') return true;
            return esAdquisicion ? regimen === 'adquisicion_stock' : regimen === 'factura';
        })
        .map((k: any) => k.id);

    if (idsAConfirmar.length > 0) {
        await supabase.from('kardex')
            .update({
                estado: 'confirmado',
                comprobante_compra_id: comprobante_id,
                // kardex.fecha es timestamptz: del comprobante solo se sabe el día
                fecha: comprobante.fecha_comprobante ? mediodiaAR(comprobante.fecha_comprobante) : nowArgentina(),
                color_dinero: esAdquisicion ? 'NEGRO' : 'BLANCO',
            })
            .in('id', idsAConfirmar);
    }

    // Revalorizar kardex ingresado a $0 (flujo depósito sin factura) con los precios de
    // este comprobante. El kardex va en UNIDADES (E-30): si el renglón de la factura es
    // por bulto, el precio se lleva a unidad con el factor con que se documentó.
    const { data: detalle } = await supabase
        .from('comprobantes_compra_detalle')
        .select('articulo_id, precio_unitario, descuento1, tipo_cantidad, recepcion_item_id')
        .eq('comprobante_id', comprobante_id)
        .not('articulo_id', 'is', null);
    if (!detalle || detalle.length === 0) return;

    // El kardex de depósito lleva recepcion_id (no orden_compra_id)
    const { data: recs } = await supabase.from('recepciones').select('id').eq('orden_compra_id', ocId);
    const recIds = (recs || []).map((r: any) => r.id);
    const orFilter = recIds.length > 0
        ? `orden_compra_id.eq.${ocId},recepcion_id.in.(${recIds.join(',')})`
        : `orden_compra_id.eq.${ocId}`;

    const { data: kardexCero } = await supabase
        .from('kardex')
        .select('id, articulo_id, cantidad')
        .or(orFilter)
        .eq('tipo_movimiento', 'compra')
        .eq('precio_unitario_final', 0);
    if (!kardexCero || kardexCero.length === 0) return;

    const porBulto = detalle.filter((d: any) => d.tipo_cantidad === 'bulto');
    const factorItem = new Map<string, number>();
    const upbArticulo = new Map<string, number>();
    if (porBulto.length > 0) {
        const itemIds = [...new Set(porBulto.map((d: any) => d.recepcion_item_id).filter(Boolean))];
        if (itemIds.length > 0) {
            const { data: its } = await supabase.from('recepciones_items').select('id, factor_conversion').in('id', itemIds);
            for (const it of its || []) factorItem.set(it.id, Number(it.factor_conversion) || 0);
        }
        const { data: arts } = await supabase.from('articulos').select('id, unidades_por_bulto').in('id', [...new Set(porBulto.map((d: any) => d.articulo_id))]);
        for (const a of arts || []) upbArticulo.set(a.id, unidadesPorBultoDe(a.unidades_por_bulto));
    }
    const factorDe = (d: any) => {
        if (d.tipo_cantidad !== 'bulto') return 1;
        const f = factorItem.get(d.recepcion_item_id) || 0;
        return f > 1 ? f : (upbArticulo.get(d.articulo_id) || 1);
    };

    for (const k of kardexCero) {
        const det = detalle.find((d: any) => d.articulo_id === k.articulo_id);
        if (!det) continue;
        const factor = factorDe(det);
        const lista = Number(det.precio_unitario || 0) / factor;
        const precio = lista * (1 - Number(det.descuento1 || 0) / 100);
        if (precio <= 0) continue;
        const cantidad = Number(k.cantidad || 0);
        await supabase.from('kardex').update({
            precio_lista: Math.round(lista * 10000) / 10000,
            precio_unitario_final: Math.round(precio * 10000) / 10000,
            subtotal_neto: Math.round(precio * cantidad * 100) / 100,
            subtotal_total: Math.round(precio * cantidad * 100) / 100,
            comprobante_compra_id: comprobante_id,
        }).eq('id', k.id);
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: comprobante_id } = await params;
        const supabase = createAdminClient();

        const { data: comprobante, error: compErr } = await supabase
            .from('comprobantes_compra')
            .select(`
                *,
                orden_compra:ordenes_compra(id, proveedor_id, numero_orden)
            `)
            .eq('id', comprobante_id)
            .single();

        if (compErr || !comprobante) return NextResponse.json({ error: 'El comprobante no existe (puede que lo hayan eliminado).' }, { status: 404 });

        const oc: any = Array.isArray(comprobante.orden_compra) ? comprobante.orden_compra[0] : comprobante.orden_compra;
        const proveedorId: string | null = comprobante.proveedor_id || oc?.proveedor_id || null;
        const ocId: string | null = oc?.id || null;
        const yaEstaba = YA_VALIDADO.includes(comprobante.estado);
        const esRemito = comprobante.tipo_comprobante === 'Remito';
        const esCredito = CREDITO.includes(comprobante.tipo_comprobante);

        // El plan solo hace falta para generar el vencimiento de una deuda nueva
        const plan: PlanVencimiento = yaEstaba || esRemito || esCredito
            ? { canal: 'blanco', fecha_vencimiento: null, forma_pago: null, modalidad: null, fecha_validez: null, numero_orden: oc?.numero_orden || null }
            : await armarPlan(supabase, comprobante, proveedorId, ocId, oc?.numero_orden || null);

        let resultado: Resultado;
        let atomico = true;
        try {
            const rpc = await supabase.rpc('comprobante_compra_validar', {
                p_comprobante_id: comprobante_id,
                p_usuario_id: auth.user.id,
                p_plan: plan,
            });
            if (!rpc.error) {
                resultado = rpc.data as Resultado;
            } else if (faltaFuncion(rpc.error)) {
                atomico = false;
                resultado = await validarSinFuncion(supabase, comprobante, proveedorId, ocId, plan, auth.user.id);
            } else if (rpc.error.code === 'P0001') {
                throw new Rechazo(rpc.error.message, String(rpc.error.details || 'rechazado'));
            } else if (rpc.error.code === 'P0002') {
                throw new Rechazo(rpc.error.message, 'no_encontrado', 404);
            } else {
                throw rpc.error;
            }
        } catch (e) {
            if (e instanceof Rechazo) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status });
            throw e;
        }

        // Kardex: repetible, no mueve plata. Un remito no confirma ni valoriza nada.
        if (ocId && !resultado.sin_deuda && !esRemito) {
            try {
                await actualizarKardex(supabase, comprobante, ocId);
            } catch (e: any) {
                console.error('[Validar Comprobante] kardex:', e?.message || e);
            }
        }

        const avisos: string[] = [];
        if (resultado.ya_validado) avisos.push('Este comprobante ya estaba validado: no se generó ninguna deuda ni vencimiento nuevo.');
        if (resultado.sin_deuda) avisos.push('Es un remito: quedó validado como respaldo de las cantidades, sin deuda ni vencimiento.');
        if (resultado.sin_vencimiento) avisos.push('Quedó validado pero SIN vencimiento: el proveedor no tiene plazo de pago cargado y el comprobante no trae fecha de vencimiento. Cargá el vencimiento a mano en Finanzas.');

        return NextResponse.json({ success: true, comprobante_id, ...resultado, atomico, avisos });

    } catch (error: any) {
        console.error('[Validar Comprobante] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
