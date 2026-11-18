import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { nowArgentina } from '@/lib/utils';
import { fechaISO, mediodiaAR, moneda, sumarDiasISO } from '@/lib/formato';
import { aplicarCostoDeFactura, sincronizarKardexEnCamino } from '@/lib/compras/costo-y-kardex';
import { tipoDescuentoProveedor } from '@/lib/compras/tipo-descuento-proveedor';
import { esAdquisicion } from '@/lib/compras/finalizar-oc';
import { acuerdoDelCanal, acuerdoDeProveedorConLegado, formaPagoVencimiento, modalidadVencimiento, normalizarAcuerdo, planDePagos, tienePlazo, type AcuerdoPago } from '@/lib/compras/acuerdo-pago';
import { controlSuma } from '@/lib/compras/control-suma';
import { normalizarNumeroComprobante } from '@/lib/services/numero-comprobante';
import { faltaLaColumna, faltaLaFuncion } from '@/lib/utils/migracion-pendiente';

// ─────────────────────────────────────────────────────────────────────────────
// Validar un comprobante de compra (E-32).
//
// Reglas (las mismas con y sin la migración 20261116c):
//   · Un comprobante ya validado NO vuelve a generar deuda ni vencimiento.
//   · Con renglones sin artículo no se valida (salvo los marcados "no es mercadería": flete, etc.).
//   · La deuda es SIEMPRE el total del comprobante (con flete, IVA y percepciones), tenga o no
//     orden de compra; nunca la suma de los renglones de mercadería.
//   · Sin total no se valida.
//   · Un REMITO no se valida nunca (17/11): solo controla cantidades. La orden no se puede
//     finalizar sin una factura validada (POST /api/ordenes-compra/[id]/finalizar).
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
    /**
     * Un vencimiento por pago acordado (uno solo, o uno por cuota "30/60/90"). Los campos sueltos de
     * arriba repiten el primero: es lo que entiende la función SQL anterior a la migración 20261117u.
     */
    pagos: Array<{ cuota: number; de: number; fecha: string; monto: number; forma_pago: string | null; modalidad: string | null; fecha_validez: string | null }>;
    /** El plazo salió del dato viejo de la ficha (el proveedor no tiene acuerdo de pago cargado) */
    acuerdo_de_legado?: boolean;
    /** Movimiento de cuenta corriente que dejó el mail y hay que reutilizar (buscarMovimientoPrevio) */
    movimiento_adoptar?: string | null;
}

interface Resultado {
    ya_validado: boolean;
    sin_deuda?: boolean;
    movimiento_cc_id?: string | null;
    vencimiento_id?: string | null;
    vencimiento_nuevo?: boolean;
    /** Importe del vencimiento (el que ya existía no se modifica) */
    vencimiento_monto?: number | null;
    /** Cuántos vencimientos reales se crearon (más de uno = cuotas). Migración 20261117u */
    vencimientos_creados?: number;
    /** Vencimientos ESTIMADOS de la orden que se quitaron al nacer el real. Migración 20261117u */
    estimados_reemplazados?: number;
    /** Lo que ya se había pagado de esta deuda antes de validarla (entró por mail). Migración 20261117u */
    pagado_antes?: number;
    sin_vencimiento?: boolean;
    provision?: string;
}

/**
 * Vencimiento(s) del comprobante según el acuerdo de pago: UNA sola regla, lib/compras/acuerdo-pago.ts
 * (la misma que usa la orden de compra para el vencimiento estimado). Solo calcula: no escribe.
 *   · El acuerdo es el que quedó COPIADO en la orden (ordenes_compra.acuerdo_pago, editable ahí);
 *     si la orden no lo tiene (orden vieja o comprobante sin orden), el de la ficha del proveedor.
 *   · Canal: adquisición = sin factura (negro); el resto, con factura (blanco). Negro sin acuerdo
 *     propio usa el de blanco.
 *   · Si el comprobante trae su fecha de vencimiento, manda esa (un solo pago).
 *   · Si no, el plazo corre desde la factura o desde la recepción, y con cuotas ("30/60/90") sale
 *     un vencimiento por cuota.
 *   · Sin plazo acordado y sin fecha en el comprobante: no hay vencimiento (se avisa en pantalla).
 */
async function armarPlan(supabase: any, comprobante: any, proveedorId: string | null, ocId: string | null, numeroOrden: string | null, total: number): Promise<PlanVencimiento> {
    // Adquisición = canal negro
    const canal: 'blanco' | 'negro' = esAdquisicion(comprobante.tipo_comprobante) ? 'negro' : 'blanco';
    const plan: PlanVencimiento = {
        canal,
        fecha_vencimiento: comprobante.fecha_vencimiento ? String(comprobante.fecha_vencimiento).slice(0, 10) : null,
        forma_pago: null, modalidad: null, fecha_validez: null, numero_orden: numeroOrden, pagos: [],
    };
    if (!proveedorId) return plan;

    // Acuerdo: el de la orden; si no tiene, el de la ficha (con el plazo viejo como respaldo).
    // select('*'): las columnas del acuerdo son de las migraciones 20261117m / n; si faltan, no rompe.
    let acuerdo: AcuerdoPago | null = null;
    if (ocId) {
        const { data: orden } = await supabase.from('ordenes_compra').select('*').eq('id', ocId).maybeSingle();
        acuerdo = normalizarAcuerdo((orden as any)?.acuerdo_pago);
    }
    if (!acuerdo) {
        const { data: prov } = await supabase.from('proveedores').select('*').eq('id', proveedorId).maybeSingle();
        acuerdo = acuerdoDeProveedorConLegado(prov);
    }
    const c = acuerdoDelCanal(acuerdo, canal);
    plan.forma_pago = formaPagoVencimiento(c.medio);
    plan.modalidad = modalidadVencimiento(c.entrega);
    plan.acuerdo_de_legado = c.de_legado === true;

    if (plan.fecha_vencimiento) {
        // La fecha la trae el comprobante: un solo pago, ese día
        const validez = plan.forma_pago === 'cheque' && Number(c.plazo_cheque ?? 0) > 0 ? sumarDiasISO(plan.fecha_vencimiento, Number(c.plazo_cheque)) : null;
        plan.pagos = total > 0 ? [{ cuota: 1, de: 1, fecha: plan.fecha_vencimiento, monto: total, forma_pago: plan.forma_pago, modalidad: plan.modalidad, fecha_validez: validez }] : [];
    } else if (tienePlazo(c)) {
        // Base del plazo: fecha de factura o de recepción según el acuerdo
        let fechaBase: string | null = comprobante.fecha_comprobante ? String(comprobante.fecha_comprobante).slice(0, 10) : null;
        if (c.desde === 'recepcion' && ocId) {
            const { data: rec } = await supabase
                .from('recepciones')
                .select('fecha_fin, fecha_inicio, created_at')
                .eq('orden_compra_id', ocId)
                .neq('estado', 'cancelada')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            const f = (rec as any)?.fecha_fin || (rec as any)?.fecha_inicio || (rec as any)?.created_at;
            if (f) fechaBase = fechaISO(f) || fechaBase; // timestamptz → día argentino
        }
        if (fechaBase) {
            plan.pagos = planDePagos(total, fechaBase, c).map((p) => ({ cuota: p.cuota, de: p.de, fecha: p.fecha, monto: p.monto, forma_pago: p.forma_pago, modalidad: p.modalidad, fecha_validez: p.fecha_validez }));
        }
    }
    // Lo que entiende la función anterior a 20261117u (un solo vencimiento): el primer pago
    plan.fecha_vencimiento = plan.pagos[0]?.fecha ?? plan.fecha_vencimiento;
    plan.fecha_validez = plan.pagos[0]?.fecha_validez ?? null;
    return plan;
}

const TIPOS_DEUDA_CC = ['factura', 'nota_credito', 'nota_debito'];

/**
 * ¿La deuda de este comprobante YA está en la cuenta corriente sin estar vinculada a él?
 * Pasa con lo que entró por mail antes del 16/11: el procesador convertía la provisión de
 * la OC en "factura" (queda referenciada a la OC) o creaba un movimiento 'gmail' suelto.
 * Desde el 16/11 el mail deja el vínculo y esto no hace falta.
 *
 * Devuelve el id del movimiento a ADOPTAR (validar lo reutiliza: no crea otro ni otro
 * vencimiento), null si no hay ninguno, o lanza Rechazo si no se puede saber cuál es:
 * ante la duda no se duplica deuda, se frena con un mensaje que dice cómo destrabarlo.
 * Solo lee; lo usan los dos caminos (con y sin la función SQL).
 */
async function buscarMovimientoPrevio(supabase: any, comprobante: any, proveedorId: string, ocId: string | null, total: number): Promise<string | null> {
    const { data: movs, error } = await supabase
        .from('cuenta_corriente_proveedores')
        .select('id, tipo_movimiento, monto, numero_comprobante, referencia_tipo, referencia_id, descripcion')
        .eq('proveedor_id', proveedorId)
        .in('tipo_movimiento', TIPOS_DEUDA_CC)
        .in('referencia_tipo', ['orden_compra', 'gmail']);
    if (error) throw error;
    const sueltos: any[] = movs || [];
    if (sueltos.length === 0) return null;

    const pesos = (m: any) => `$${Math.abs(Number(m.monto || 0))}`;
    const clave = normalizarNumeroComprobante(comprobante.numero_comprobante);

    // 1. Mismo número (normalizado: "A 0001-00000123" = "1-123")
    if (clave) {
        const porNumero = sueltos.filter((m) => normalizarNumeroComprobante(m.numero_comprobante) === clave);
        if (porNumero.length === 1) return porNumero[0].id;
        if (porNumero.length > 1) {
            throw new Rechazo(
                `En la cuenta corriente del proveedor hay ${porNumero.length} movimientos con el número ${comprobante.numero_comprobante} que entraron por mail y no se sabe cuál corresponde a este comprobante. No se validó: hay que revisar esa cuenta corriente y dejar uno solo.`,
                'movimiento_ambiguo', 409);
        }
    }

    // 2. Sin coincidencia por número. Candidatos: lo que el mail convirtió en ESTA orden, y
    //    movimientos 'gmail' sin número por el mismo importe. Se descartan los que por número
    //    son de OTRO comprobante del proveedor.
    const { data: otros, error: otrosErr } = await supabase
        .from('comprobantes_compra')
        .select('id, numero_comprobante')
        .eq('proveedor_id', proveedorId)
        .neq('id', comprobante.id);
    if (otrosErr) throw otrosErr;
    const clavesAjenas = new Set((otros || []).map((c: any) => normalizarNumeroComprobante(c.numero_comprobante)).filter(Boolean));
    const mismoImporte = (m: any) => Math.abs(Math.abs(Number(m.monto || 0)) - total) < 0.01;
    const candidatos = sueltos.filter((m) => {
        const k = normalizarNumeroComprobante(m.numero_comprobante);
        if (k && clavesAjenas.has(k)) return false;
        if (m.referencia_tipo === 'orden_compra') return !!ocId && m.referencia_id === ocId;
        return !k && mismoImporte(m); // 'gmail' sin número
    });
    if (candidatos.length === 0) return null;
    // Uno solo y coincide el importe, o el comprobante no tiene número real (GMAIL-… / PENDIENTE-…): es ese
    if (candidatos.length === 1 && (mismoImporte(candidatos[0]) || !clave)) return candidatos[0].id;

    const detalle = candidatos.slice(0, 3).map((m) => `${m.numero_comprobante ? `N° ${m.numero_comprobante}` : 'sin número'} por ${pesos(m)}`).join('; ');
    throw new Rechazo(
        `En la cuenta corriente del proveedor ya hay deuda de esta orden que entró por mail (${detalle}) y no se puede saber si es este mismo comprobante. No se validó, para no duplicar la deuda. Si es el mismo, corregile al comprobante el número o el total (lápiz) para que coincidan y volvé a validar; si es otro comprobante, cargalo y validalo primero.`,
        'movimiento_ambiguo', 409);
}

/**
 * Los mismos pasos que la función SQL, de a uno (migración 20261116c sin aplicar).
 * La compuerta es el UPDATE de estado con condición: solo UNA llamada lo gana.
 * Todo o nada "a mano": si un paso falla después de la compuerta, se deshace lo hecho
 * (estado, movimiento, vencimiento) y se informa en español; la provisión va al final.
 */
async function validarSinFuncion(supabase: any, comprobante: any, proveedorId: string | null, ocId: string | null, plan: PlanVencimiento, usuarioId: string): Promise<Resultado> {
    const id = comprobante.id;
    const movimientoPropio = async (): Promise<string | null> => {
        const { data, error } = await supabase.from('cuenta_corriente_proveedores')
            .select('id').eq('referencia_tipo', 'comprobante_compra').eq('referencia_id', id)
            .order('created_at', { ascending: true }).limit(1);
        if (error) throw error;
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
        .is('articulo_id', null)
        // los marcados "no es mercadería" (flete, etc.) quedan en el comprobante y no frenan
        .or('match_estado.is.null,match_estado.neq.no_mercaderia');
    if (detErr) throw detErr;
    if ((sinArticulo || 0) > 0) {
        throw new Rechazo(`Hay ${sinArticulo} renglón(es) del comprobante sin vincular a un artículo. Vinculalos (o marcá "No es mercadería" los que sean flete u otro concepto) en "Revisar matches" antes de validar.`, 'lineas_sin_articulo');
    }

    const total = Number(comprobante.total_factura_declarado || 0);
    const esCredito = CREDITO.includes(comprobante.tipo_comprobante);
    const esNotaDebito = NOTA_DEBITO.includes(comprobante.tipo_comprobante);
    const esRemito = comprobante.tipo_comprobante === 'Remito';
    if (esRemito) {
        throw new Rechazo('Un remito no se valida: solo sirve para controlar las cantidades contra lo recibido. Para controlar los precios y registrar la deuda hace falta la factura.', 'remito_no_se_valida');
    }
    if (total <= 0) {
        throw new Rechazo(`El comprobante ${comprobante.tipo_comprobante} ${comprobante.numero_comprobante} no tiene total. Cargale el total (lápiz de editar) antes de validarlo; si es solo un remito, cambiale el tipo a Remito.`, 'sin_total');
    }

    if (!esRemito && !proveedorId) {
        throw new Rechazo(`El comprobante ${comprobante.tipo_comprobante} ${comprobante.numero_comprobante} no tiene proveedor: no se puede registrar la deuda. Asignale el proveedor antes de validar.`, 'sin_proveedor');
    }
    const sufijoOC = ocId ? ` — OC ${plan.numero_orden || ''}` : '';

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
    if (updErr && faltaLaColumna(updErr)) ({ data: ganado, error: updErr } = await pasarAValidado(false));
    if (updErr) throw updErr;
    if (!ganado || ganado.length === 0) return { ya_validado: true, movimiento_cc_id: await movimientoPropio() };


    // Lo que hay que deshacer si algo falla de acá en adelante
    let movCreado: string | null = null;
    let movAdoptadoAntes: any = null;
    let vencCreado: string | null = null;
    const deshacer = async () => {
        // Un vencimiento NO se puede borrar: su historia (vencimientos_historial) es inmutable y
        // cuelga de él, así que la base rechaza el borrado. Se cancela, como en el resto del sistema.
        if (vencCreado) {
            await supabase.from('vencimientos')
                .update({ estado: 'cancelado', observaciones: 'Cancelado: la validación del comprobante no se completó y se deshizo.' })
                .eq('id', vencCreado);
        }
        if (movCreado) await supabase.from('cuenta_corriente_proveedores').delete().eq('id', movCreado);
        if (movAdoptadoAntes) {
            const { id: movId, ...antes } = movAdoptadoAntes;
            await supabase.from('cuenta_corriente_proveedores').update(antes).eq('id', movId);
        }
        await supabase.from('comprobantes_compra')
            .update({ estado: comprobante.estado, saldo_pendiente: comprobante.saldo_pendiente ?? null, estado_pago: comprobante.estado_pago ?? 'pendiente', fecha_vencimiento: comprobante.fecha_vencimiento ?? null })
            .eq('id', id);
    };

    try {
        // ── Cuenta corriente: con o sin orden de compra (decisión de Juan, 16/11) ──
        let ccMovId: string | null = null;
        let provision = 'sin_provision';
        const conCC = !!proveedorId;
        if (conCC) {
            const tipoMovimiento = esCredito ? 'nota_credito' : esNotaDebito ? 'nota_debito' : 'factura';
            const datosMov = {
                referencia_tipo: 'comprobante_compra',
                referencia_id: id,
                tipo_movimiento: tipoMovimiento,
                monto: esCredito ? -total : total,
                descripcion: `${comprobante.tipo_comprobante} ${comprobante.numero_comprobante}${sufijoOC}`,
                numero_comprobante: comprobante.numero_comprobante,
                tipo_comprobante: comprobante.tipo_comprobante,
                fecha: comprobante.fecha_comprobante ? mediodiaAR(comprobante.fecha_comprobante) : nowArgentina(),
            };

            // Ya vinculado (validación a medias / mail nuevo) o el que dejó un mail viejo: se reutiliza
            ccMovId = (await movimientoPropio()) || plan.movimiento_adoptar || null;
            if (ccMovId) {
                const { data: antes, error: leerErr } = await supabase.from('cuenta_corriente_proveedores')
                    .select('id, referencia_tipo, referencia_id, tipo_movimiento, monto, descripcion, numero_comprobante, tipo_comprobante, fecha')
                    .eq('id', ccMovId).maybeSingle();
                if (leerErr) throw leerErr;
                if (!antes) throw new Rechazo('El movimiento de la cuenta corriente que correspondía a este comprobante cambió mientras se validaba. Volvé a intentar.', 'movimiento_cambio', 409);
                const { error } = await supabase.from('cuenta_corriente_proveedores').update(datosMov).eq('id', ccMovId);
                if (error) throw error;
                movAdoptadoAntes = antes;
            } else {
                const { data: ccMov, error } = await supabase.from('cuenta_corriente_proveedores')
                    .insert({ proveedor_id: proveedorId, ...datosMov }).select('id').single();
                if (error) throw error;
                ccMovId = ccMov.id;
                movCreado = ccMov.id;
            }
        }

        // ── Vencimiento (solo deuda), uno solo. Los que ya existen no se tocan. ──
        let vencimientoId: string | null = null;
        let vencimientoMonto: number | null = null;
        if (!esCredito) {
            if (plan.fecha_vencimiento && !comprobante.fecha_vencimiento) {
                const { error } = await supabase.from('comprobantes_compra').update({ fecha_vencimiento: plan.fecha_vencimiento }).eq('id', id);
                if (error) throw error;
            }
            const filtros = [`and(referencia_tipo.eq.comprobante_compra,referencia_id.eq.${id})`];
            if (ccMovId) filtros.push(`and(referencia_tipo.eq.cuenta_corriente,referencia_id.eq.${ccMovId})`);
            const { data: yaHay, error: buscarErr } = await supabase.from('vencimientos').select('id, monto').neq('estado', 'cancelado').or(filtros.join(',')).limit(1);
            if (buscarErr) throw buscarErr;
            vencimientoId = yaHay?.[0]?.id ?? null;
            vencimientoMonto = yaHay?.[0] ? Number(yaHay[0].monto) : null;

            if (!vencimientoId && plan.fecha_vencimiento) {
                const { data: venc, error: vencErr } = await supabase.from('vencimientos').insert({
                    proveedor_id: proveedorId,
                    tipo: 'factura',
                    canal: plan.canal,
                    concepto: `${comprobante.tipo_comprobante} ${comprobante.numero_comprobante}${sufijoOC}`,
                    monto: total,
                    fecha_vencimiento: plan.fecha_vencimiento,
                    estado: 'pendiente',
                    forma_pago: plan.forma_pago,
                    modalidad: plan.modalidad,
                    fecha_validez: plan.fecha_validez,
                    referencia_id: ccMovId || id,
                    referencia_tipo: ccMovId ? 'cuenta_corriente' : 'comprobante_compra',
                }).select('id').single();
                // Deuda sin vencimiento = pago que se olvida: todo o nada, igual que la función SQL
                if (vencErr || !venc) {
                    throw new Rechazo(`No se pudo crear el vencimiento del comprobante (${vencErr?.message || 'sin respuesta'}). No se validó nada: avisá a sistemas con este mensaje.`, 'vencimiento_fallido');
                }
                vencimientoId = venc.id;
                vencCreado = venc.id;
                vencimientoMonto = total;
            }
        }

        // ── Provisión de la OC (al final): baja por lo facturado; se va cuando no queda nada por validar ──
        if (conCC && ocId && !esCredito) {
            const { count: otros, error: otrosErr } = await supabase
                .from('comprobantes_compra')
                .select('id', { count: 'exact', head: true })
                .eq('orden_compra_id', ocId)
                .neq('id', id)
                .not('estado', 'in', '(validado,cerrado,esperada)')
                .not('tipo_comprobante', 'in', '(Remito,NC,NCA,NCB,NCC,Reversa)');
            if (otrosErr) throw otrosErr;
            const { data: provisiones, error: provErr } = await supabase.from('cuenta_corriente_proveedores')
                .select('id, monto')
                .eq('referencia_tipo', 'orden_compra').eq('referencia_id', ocId).eq('tipo_movimiento', 'orden_compra')
                .order('created_at', { ascending: true });
            if (provErr) throw provErr;
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

        return { ya_validado: false, sin_deuda: false, movimiento_cc_id: ccMovId, vencimiento_id: vencimientoId, vencimiento_nuevo: !!vencCreado, vencimiento_monto: vencimientoMonto, sin_vencimiento: !esCredito && !vencimientoId, provision };
    } catch (e) {
        try {
            await deshacer();
        } catch (e2: any) {
            console.error('[Validar] no se pudo deshacer una validación a medias:', e2?.message || e2);
        }
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

        // Un remito NO se valida (decisión de Juan, 17/11): solo trae cantidades. Validar es dar por
        // buenas cantidades Y precios, y eso lo hace la factura. Se rechaza acá, antes de la función
        // SQL, así vale igual con o sin la migración 20261117a. (Uno que ya figuraba validado de antes
        // sigue de largo y contesta "ya estaba validado": no generó deuda.)
        if (esRemito && !yaEstaba) {
            return NextResponse.json({
                error: 'Un remito no se valida: solo sirve para controlar las cantidades contra lo recibido. Para controlar los precios y registrar la deuda hace falta la factura.',
                codigo: 'remito_no_se_valida',
            }, { status: 422 });
        }

        // E-46 (regla de Juan, 17/11): los renglones tienen que sumar el neto del comprobante, y neto +
        // impuestos el total. Si no cierra NO se valida: primero se corrigen los renglones o la cabecera.
        // Se controla acá y también en la función SQL (migración 20261117d).
        if (!yaEstaba) {
            const { data: renglones, error: renErr } = await supabase
                .from('comprobantes_compra_detalle')
                .select('cantidad_facturada, precio_unitario, descuento1, descuento2, descuento3, descuento4')
                .eq('comprobante_id', comprobante_id);
            if (renErr) throw renErr;
            // los descuentos del renglón, como dice la ficha del proveedor (en cascada o sobre la lista)
            const suma = controlSuma({ ...comprobante, tipo_descuento: await tipoDescuentoProveedor(supabase, proveedorId) }, renglones || []);
            if (!suma.ok) {
                return NextResponse.json({
                    error: `${suma.faltas.join(' ')} No se validó: corregí el comprobante y volvé a validar.`,
                    codigo: 'renglones_no_suman',
                    ...suma,
                }, { status: 422 });
            }
        }

        // El plan solo hace falta para generar el vencimiento de una deuda nueva
        const plan: PlanVencimiento = yaEstaba || esRemito || esCredito
            ? { canal: 'blanco', fecha_vencimiento: null, forma_pago: null, modalidad: null, fecha_validez: null, numero_orden: oc?.numero_orden || null, pagos: [] }
            : await armarPlan(supabase, comprobante, proveedorId, ocId, oc?.numero_orden || null, Number(comprobante.total_factura_declarado || 0));

        const total = Number(comprobante.total_factura_declarado || 0);

        let resultado: Resultado;
        let atomico = true;
        try {
            // Deuda que el mail ya dejó en la cuenta corriente sin vincular: se adopta (o se frena si es ambiguo).
            // Se resuelve ANTES de escribir nada, igual para los dos caminos.
            if (!yaEstaba && !esRemito && proveedorId && total > 0) {
                plan.movimiento_adoptar = await buscarMovimientoPrevio(supabase, comprobante, proveedorId, ocId, total);
            }

            // Un comprobante de una ORDEN de compra se valida solo con la migración 20261117u: es la que
            // deja en una sola transacción la deuda, las cuotas, la provisión por canal y el vencimiento
            // estimado de la orden. Sin ella no se hace nada (antes el servidor lo intentaba por partes).
            if (!yaEstaba && !esRemito && ocId) {
                const prueba = await supabase.rpc('entrada_cableado_version');
                if (prueba.error && faltaLaFuncion(prueba.error, 'entrada_cableado_version')) {
                    throw new Rechazo('Todavía no se puede validar un comprobante de una orden de compra: falta aplicar la migración 20261117u (y las anteriores de la tanda). No se cambió nada.', 'falta_migracion', 409);
                }
                if (prueba.error) throw prueba.error;
            }

            const rpc = await supabase.rpc('comprobante_compra_validar', {
                p_comprobante_id: comprobante_id,
                p_usuario_id: auth.user.id,
                p_plan: plan,
            });
            if (!rpc.error) {
                resultado = rpc.data as Resultado;
            } else if (faltaLaFuncion(rpc.error, 'comprobante_compra_validar')) {
                // Con orden de compra no hay camino por partes: la provisión, el estimado y las cuotas
                // se resuelven solo dentro de la función (una sola vez, en una transacción).
                if (ocId) throw new Rechazo('Todavía no se puede validar un comprobante de una orden de compra: falta aplicar las migraciones de la tanda (20261117u y 20261118c). No se cambió nada.', 'falta_migracion', 409);
                atomico = false;
                resultado = await validarSinFuncion(supabase, comprobante, proveedorId, ocId, plan, auth.user.id);
            } else if (rpc.error.code === 'P0001') {
                throw new Rechazo(rpc.error.message, String(rpc.error.details || 'rechazado'));
            } else if (rpc.error.code === 'P0002') {
                throw new Rechazo(rpc.error.message, 'no_encontrado', 404);
            } else {
                throw rpc.error;
            }
        } catch (e: any) {
            if (e instanceof Rechazo) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status });
            // Con la función SQL la transacción se deshace sola; sin ella, validarSinFuncion deshace lo hecho
            console.error('[Validar Comprobante] no se validó:', e);
            return NextResponse.json({
                error: `No se pudo validar el comprobante y no se aplicó ningún cambio. Detalle para sistemas: ${e?.message || e}`,
                codigo: 'error_interno',
            }, { status: 500 });
        }

        // Costo y kardex (lib/compras/costo-y-kardex.ts): repetible, no mueve plata ni stock.
        //  · el kardex de la recepción queda valorizado con lo facturado y el artículo con su último costo;
        //  · el kardex "en camino" de la orden se ajusta a lo que falta recibir (ya no se "confirma":
        //    eso duplicaba la compra de la recepción, E-31).
        const avisos: string[] = [];
        let preciosVenta: any[] = [];
        if (!resultado.ya_validado && Number(resultado.pagado_antes || 0) > 0.01) {
            avisos.push(`Este comprobante ya tenía ${moneda(Number(resultado.pagado_antes))} pagados antes de validarlo: los vencimientos quedaron por el saldo que falta pagar.`);
        }
        if (!resultado.ya_validado && plan.acuerdo_de_legado && resultado.vencimiento_nuevo) {
            avisos.push('El proveedor no tiene acuerdo de pago cargado: el plazo del vencimiento salió del dato viejo de su ficha. Cargá el acuerdo en la ficha del proveedor.');
        }
        if (!resultado.sin_deuda && !esRemito) {
            try {
                if (ocId) await sincronizarKardexEnCamino(supabase, ocId);
                // El costo se aplica UNA vez, cuando el comprobante pasa a validado. Volver a tocar
                // "Validar" en una factura vieja no pisa el último costo que dejó una más nueva.
                // (Que los renglones sumen el neto ya se controló antes de validar: control-suma.ts.)
                if (!resultado.ya_validado) {
                    const costo = await aplicarCostoDeFactura(supabase, comprobante, ocId);
                    // Precios de venta: NO se tocan. Se avisa cuáles conviene revisar porque el costo facturado
                    // no es el de la ficha del artículo (de donde sale el precio de venta).
                    preciosVenta = costo.precios_venta;
                    if (preciosVenta.length > 0) {
                        const lista = preciosVenta.slice(0, 6).map((v) => `${v.sku || v.descripcion || 'artículo'} (ficha ${moneda(v.neto_ficha)} → factura ${moneda(v.neto_factura)})`).join(', ');
                        avisos.push(`Precios de venta para revisar: ${preciosVenta.length} artículo(s) se facturaron a un costo distinto del de su ficha: ${lista}${preciosVenta.length > 6 ? '…' : ''}. El precio de venta NO se tocó: revisalos en Artículos.`);
                    }
                    if (costo.historial_fallas > 0) {
                        avisos.push(`El último costo de ${costo.historial_fallas} artículo(s) se actualizó, pero no se pudo anotar el cambio en el historial de costos. Avisá a sistemas.`);
                    }
                }
            } catch (e: any) {
                console.error('[Validar Comprobante] costo y kardex:', e?.message || e);
                avisos.push('El comprobante quedó validado, pero no se pudo actualizar el costo de los artículos ni el kardex. Avisá a sistemas.');
            }
        }

        if (resultado.ya_validado) avisos.push('Este comprobante ya estaba validado: no se generó ninguna deuda ni vencimiento nuevo.');
        if (!resultado.ya_validado && resultado.vencimiento_id && resultado.vencimiento_nuevo === false
            && resultado.vencimiento_monto != null && Math.abs(Number(resultado.vencimiento_monto) - total) > 0.01) {
            avisos.push(`Este comprobante ya tenía un vencimiento cargado por ${moneda(resultado.vencimiento_monto)} y el comprobante es por ${moneda(total)}: el vencimiento NO se modificó, revisalo en Finanzas.`);
        }
        if (resultado.sin_vencimiento) avisos.push('Quedó validado pero SIN vencimiento: el proveedor no tiene plazo de pago cargado y el comprobante no trae fecha de vencimiento. Cargá el vencimiento a mano en Finanzas.');

        return NextResponse.json({ success: true, comprobante_id, ...resultado, atomico, avisos, precios_venta: preciosVenta });

    } catch (error: any) {
        console.error('[Validar Comprobante] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
