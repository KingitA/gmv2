import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cuentasParaEnviar, enviarMailGmail, recordarCuentaCompras } from '@/lib/ai/gmail';
import { cargarOrdenCompleta, type OrdenCompleta } from '@/lib/compras/orden-completa';
import { datosEmpresa, excelDeOrden, lineasCondicion, nombreArchivoOrden, pdfDeOrden } from '@/lib/compras/orden-archivos';
import { armarMime, asuntoOrden, cuerpoOrden, rawParaGmail, type AdjuntoMail } from '@/lib/compras/mail-orden';
import { errorDeFuncion, mailsInvalidos, mensajeMigracionOC, MIGRACION_PROVEEDORES, separarMails } from '@/lib/compras/orden-compra';
import { faltaLaColumna } from '@/lib/utils/migracion-pendiente';

export const maxDuration = 60;

async function contexto(supabase: any, userId: string, id: string) {
    const oc = await cargarOrdenCompleta(supabase, id);
    if (!oc) return null;
    const [empresa, cuentas, usuario] = await Promise.all([
        datosEmpresa(supabase),
        cuentasParaEnviar().catch(() => ({ predeterminada: null, todas: [] as string[], configurada: null as string | null })),
        supabase.from('usuarios').select('nombre').eq('id', userId).maybeSingle(),
    ]);
    return { oc, empresa, cuentas, firma: (usuario.data as any)?.nombre ?? null };
}

function plantilla(oc: OrdenCompleta, empresa: any, firma: string | null) {
    const nombreEmpresa = empresa?.razon_social || 'Compras';
    const reemplaza = oc.orden.envios > 0 && oc.orden.cambio_sin_enviar;
    return {
        asunto: asuntoOrden({ numero_orden: oc.orden.numero_orden, empresa: nombreEmpresa, reemplaza }),
        cuerpo: cuerpoOrden({
            numero_orden: oc.orden.numero_orden, proveedor: oc.proveedor.nombre, empresa: nombreEmpresa,
            fecha_entrega: oc.orden.fecha_estimada_recepcion, condiciones: lineasCondicion(oc),
            renglones: oc.totales.renglones, total: oc.totales.neto, observaciones: oc.orden.observaciones,
            firma, telefono: empresa?.telefono ?? null, reemplaza,
        }),
    };
}

/**
 * GET /api/ordenes-compra/[id]/enviar — vista previa del mail al proveedor (E-03): desde qué
 * cuenta sale, a quién, asunto, cuerpo propuesto y adjuntos. No envía nada.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        const ctx = await contexto(createAdminClient(), auth.user.id, id);
        if (!ctx) return NextResponse.json({ error: 'La orden no existe.' }, { status: 404 });
        const { oc, empresa, cuentas, firma } = ctx;
        const sugeridos = oc.proveedor.mails_sugeridos;
        const base = nombreArchivoOrden(oc.orden.numero_orden);
        return NextResponse.json({
            orden: {
                id: oc.orden.id, numero_orden: oc.orden.numero_orden, estado: oc.orden.estado,
                envios: oc.orden.envios, enviada_at: oc.orden.enviada_at, enviada_a: oc.orden.enviada_a,
                cambio_sin_enviar: oc.orden.cambio_sin_enviar, total: oc.totales.neto, renglones: oc.totales.renglones,
            },
            proveedor: { id: oc.proveedor.id, nombre: oc.proveedor.nombre },
            puede_enviar: oc.puede.enviar,
            motivo: oc.puede.enviar ? null : (oc.puede.motivo || 'La orden ya no se puede enviar.'),
            cuenta: cuentas.predeterminada,
            cuentas: cuentas.todas,
            // hay varias cuentas conectadas y todavía no se eligió la de compras: la pantalla hace elegir
            elegir_cuenta: !cuentas.predeterminada && cuentas.todas.length > 1,
            para: sugeridos.para,
            // de dónde salió el destinatario propuesto: 'ordenes_compra' = el campo de la ficha
            para_origen: sugeridos.origen,
            otros_mails: sugeridos.otros,
            ...plantilla(oc, empresa, firma),
            adjuntos: [
                { clave: 'pdf', nombre: `${base}.pdf`, fijo: true },
                { clave: 'excel', nombre: `${base}.xlsx`, fijo: false },
            ],
        });
    } catch (error: any) {
        console.error('[OC Enviar] Error en la vista previa:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}

/**
 * POST /api/ordenes-compra/[id]/enviar
 *   { para, cc?, asunto, cuerpo, de?, adjuntar_excel?, guardar_mail_en_ficha?, simular? }
 *
 * Manda la orden al proveedor desde la cuenta de Gmail conectada, con el PDF (y el Excel si se
 * pide) adjuntos, y deja constancia en la orden (`oc_marcar_enviada`): cuándo, quién, a quién,
 * id del mensaje, y la pasa de "pendiente" a "enviada". Se puede reenviar las veces que haga falta.
 *
 * `simular: true` arma todo (adjuntos y mensaje) y NO envía ni registra nada: sirve para probar.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id } = await params;
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 });

        const supabase = createAdminClient();
        const ctx = await contexto(supabase, auth.user.id, id);
        if (!ctx) return NextResponse.json({ error: 'La orden no existe.' }, { status: 404 });
        const { oc, empresa, cuentas } = ctx;

        if (!oc.puede.enviar) {
            return NextResponse.json({ error: oc.puede.motivo || 'La orden ya no se puede enviar.', codigo: 'estado_no_enviable' }, { status: 409 });
        }
        if (oc.renglones.length === 0) return NextResponse.json({ error: 'La orden no tiene artículos.', codigo: 'sin_items' }, { status: 409 });

        // Destinatarios
        const crudoPara = Array.isArray(body.para) ? body.para.join(',') : String(body.para ?? '');
        const crudoCc = Array.isArray(body.cc) ? body.cc.join(',') : String(body.cc ?? '');
        const invalidos = [...mailsInvalidos(crudoPara), ...mailsInvalidos(crudoCc)];
        if (invalidos.length > 0) {
            return NextResponse.json({ error: `Hay direcciones de mail mal escritas: ${invalidos.join(', ')}`, codigo: 'mail_invalido' }, { status: 400 });
        }
        const para = separarMails(crudoPara);
        const cc = separarMails(crudoCc).filter((m) => !para.includes(m));
        if (para.length === 0) {
            return NextResponse.json({ error: 'Escribí el mail del proveedor al que hay que mandarle la orden.', codigo: 'sin_destinatario' }, { status: 400 });
        }

        const asunto = String(body.asunto ?? '').trim();
        const cuerpo = String(body.cuerpo ?? '').trim();
        if (!asunto) return NextResponse.json({ error: 'El mail no tiene asunto.', codigo: 'sin_asunto' }, { status: 400 });
        if (!cuerpo) return NextResponse.json({ error: 'El mail no tiene texto.', codigo: 'sin_cuerpo' }, { status: 400 });

        // Cuenta de envío: tiene que ser una de las conectadas
        const de = typeof body.de === 'string' && cuentas.todas.includes(body.de) ? body.de : cuentas.predeterminada;
        if (!de && cuentas.todas.length > 1) {
            return NextResponse.json({
                error: 'Hay más de una cuenta de Gmail conectada y todavía no se eligió la de compras. Elegí desde cuál se manda: queda recordada para las próximas órdenes.',
                codigo: 'elegir_cuenta',
            }, { status: 400 });
        }
        if (!de) {
            return NextResponse.json({
                error: 'No hay ninguna cuenta de Gmail conectada al sistema para enviar. Conectala desde el asistente (botón "Conectar Gmail") y volvé a intentar.',
                codigo: 'sin_cuenta',
            }, { status: 409 });
        }

        // Antes de mandar nada: ¿la base puede registrar el envío? (si no, saldría el mail y la
        // orden seguiría figurando "sin enviar")
        if (!body.simular) {
            const { error: errMig } = await supabase.rpc('oc_totales', { p_orden_id: id });
            if (errMig) {
                const migracion = mensajeMigracionOC(errMig);
                return NextResponse.json({ error: migracion || `No se pudo preparar el envío: ${errMig.message}`, codigo: migracion ? 'migracion_pendiente' : 'error' }, { status: 503 });
            }
        }

        // Adjuntos: los mismos archivos que se descargan desde la pantalla
        const base = nombreArchivoOrden(oc.orden.numero_orden);
        const adjuntos: AdjuntoMail[] = [
            { nombre: `${base}.pdf`, tipo: 'application/pdf', base64: (await pdfDeOrden(oc, empresa)).toString('base64') },
        ];
        if (body.adjuntar_excel) {
            adjuntos.push({ nombre: `${base}.xlsx`, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: excelDeOrden(oc).toString('base64') });
        }

        let mime: string;
        try {
            mime = armarMime({ de, nombreDe: empresa?.razon_social ?? null, para, cc, asunto, texto: cuerpo, adjuntos });
        } catch (e: any) {
            return NextResponse.json({ error: e.message, codigo: 'mensaje_invalido' }, { status: 400 });
        }

        if (body.simular) {
            return NextResponse.json({ success: true, simulado: true, de, para, cc, asunto, adjuntos: adjuntos.map((a) => a.nombre), bytes: mime.length });
        }

        // ── Envío ──
        let enviado: { id: string; threadId: string | null };
        try {
            enviado = await enviarMailGmail(de, rawParaGmail(mime));
        } catch (e: any) {
            console.error('[OC Enviar] Gmail:', e?.message);
            return NextResponse.json({ error: e.message || 'No se pudo enviar el mail.', codigo: 'gmail' }, { status: 502 });
        }

        // ── Constancia en la orden ──
        const avisos: string[] = [];
        // La cuenta con la que se mandó queda como la cuenta de compras (si todavía no había una)
        if (!cuentas.configurada || cuentas.configurada !== de) {
            const ok = await recordarCuentaCompras(de).catch(() => false);
            if (!ok && cuentas.todas.length > 1) avisos.push('No se pudo recordar la cuenta de envío: la próxima vez habrá que elegirla de nuevo.');
        }
        const { data: marca, error: errMarca } = await supabase.rpc('oc_marcar_enviada', {
            p_orden_id: id,
            p_usuario_id: auth.user.id,
            p_datos: { para: para.join(', '), cc: cc.join(', '), mensaje_id: enviado.id, hilo_id: enviado.threadId },
        });
        if (errMarca) {
            // El mail YA salió: no se puede devolver error (lo mandarían de nuevo). Se avisa.
            console.error('[OC Enviar] El mail salió pero no se registró:', errMarca);
            avisos.push(`El mail SE ENVIÓ a ${para.join(', ')}, pero no se pudo registrar en la orden (${errorDeFuncion(errMarca).mensaje}). No lo reenvíes: avisá a sistemas.`);
        }

        // ── Guardar el mail en la ficha del proveedor, si se pidió ──
        if (body.guardar_mail_en_ficha) {
            const { error: errFicha } = await supabase.from('proveedores').update({ mail_ordenes_compra: para.join(', ') }).eq('id', oc.proveedor.id);
            if (errFicha) {
                avisos.push(faltaLaColumna(errFicha)
                    ? `No se guardó el mail en la ficha del proveedor: falta aplicar la migración ${MIGRACION_PROVEEDORES}.`
                    : `No se guardó el mail en la ficha del proveedor: ${errFicha.message}`);
            }
        }

        return NextResponse.json({
            success: true,
            numero_orden: oc.orden.numero_orden,
            de, para, cc,
            mensaje_id: enviado.id,
            estado: (marca as any)?.estado ?? oc.orden.estado,
            envios: (marca as any)?.envios ?? oc.orden.envios + 1,
            avisos,
        });
    } catch (error: any) {
        console.error('[OC Enviar] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}
