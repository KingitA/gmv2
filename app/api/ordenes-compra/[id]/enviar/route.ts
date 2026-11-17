import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cuentaGmailConectada, enviarMailGmail } from '@/lib/ai/gmail';
import { cargarOrdenCompleta, type OrdenCompleta } from '@/lib/compras/orden-completa';
import { datosEmpresa, excelDeOrden, lineasCondicion, nombreArchivoOrden, pdfDeOrden } from '@/lib/compras/orden-archivos';
import { armarMime, asuntoOrden, cuerpoOrden, mailADespachar, rawParaGmail, type AdjuntoMail } from '@/lib/compras/mail-orden';
import { errorDeFuncion, mailsInvalidos, mensajeMigracionOC, MIGRACION_PROVEEDORES, separarMails } from '@/lib/compras/orden-compra';
import { comoConectarCuenta, leerAjustesEnvio } from '@/lib/compras/envio-ajustes';
import { faltaLaColumna } from '@/lib/utils/migracion-pendiente';

export const maxDuration = 60;

/**
 * Todo lo que hace falta para la vista previa y para el envío. La cuenta de la que sale, si
 * está encendido el MODO PRUEBA y la dirección de prueba salen de UN solo lugar: el ajuste de
 * envío de la base (lib/compras/envio-ajustes.ts). Si ese ajuste no se puede leer, no se envía.
 */
async function contexto(supabase: any, userId: string, id: string) {
    const oc = await cargarOrdenCompleta(supabase, id);
    if (!oc) return null;
    const [empresa, usuario, lectura] = await Promise.all([
        datosEmpresa(supabase),
        supabase.from('usuarios').select('nombre').eq('id', userId).maybeSingle(),
        leerAjustesEnvio(supabase),
    ]);
    const cuentaConectada = lectura.ok ? await cuentaGmailConectada(lectura.ajustes.cuenta_envio).catch(() => null) : null;
    return { oc, empresa, lectura, cuentaConectada, firma: (usuario.data as any)?.nombre ?? null };
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
 * cuenta sale, a quién, asunto, cuerpo propuesto, adjuntos y si está en MODO PRUEBA. No envía nada.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        const ctx = await contexto(createAdminClient(), auth.user.id, id);
        if (!ctx) return NextResponse.json({ error: 'La orden no existe.' }, { status: 404 });
        const { oc, empresa, lectura, cuentaConectada, firma } = ctx;
        const sugeridos = oc.proveedor.mails_sugeridos;
        const base = nombreArchivoOrden(oc.orden.numero_orden);
        return NextResponse.json({
            orden: {
                id: oc.orden.id, numero_orden: oc.orden.numero_orden, estado: oc.orden.estado,
                envios: oc.orden.envios, enviada_at: oc.orden.enviada_at, enviada_a: oc.orden.enviada_a,
                prueba_enviada_at: oc.orden.prueba_enviada_at, prueba_enviada_a: oc.orden.prueba_enviada_a,
                cambio_sin_enviar: oc.orden.cambio_sin_enviar, total: oc.totales.neto, renglones: oc.totales.renglones,
            },
            proveedor: { id: oc.proveedor.id, nombre: oc.proveedor.nombre },
            puede_enviar: oc.puede.enviar,
            motivo: oc.puede.enviar ? null : (oc.puede.motivo || 'La orden ya no se puede enviar.'),
            // Envío: cuenta, modo prueba y dirección de prueba (ajuste único de la base)
            envio: lectura.ok
                ? {
                    ok: true,
                    cuenta: lectura.ajustes.cuenta_envio,
                    cuenta_conectada: !!cuentaConectada,
                    como_conectar: cuentaConectada ? null : comoConectarCuenta(lectura.ajustes.cuenta_envio),
                    modo_prueba: lectura.ajustes.modo_prueba,
                    mail_prueba: lectura.ajustes.modo_prueba ? lectura.ajustes.mail_prueba : null,
                }
                : { ok: false, bloqueo: lectura.motivo },
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
 *   { para, cc?, asunto, cuerpo, adjuntar_excel?, guardar_mail_en_ficha?, simular? }
 *
 * Manda la orden desde la cuenta de compras, con el PDF (y el Excel si se pide) adjuntos, y deja
 * constancia en la orden (`oc_marcar_enviada`): cuándo, quién, a quién SALIÓ DE VERDAD, id del
 * mensaje, y la pasa de "pendiente" a "enviada". Se puede reenviar las veces que haga falta.
 *
 * MODO PRUEBA (encendido por defecto): el mail va SOLO a la dirección de prueba, diga lo que
 * diga "para" / "cc", con "[PRUEBA]" en el asunto. Lo decide `mailADespachar` con el ajuste de
 * la base; el navegador no puede cambiarlo. Si el ajuste no se puede leer, no se envía nada.
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
        const { oc, empresa, lectura, cuentaConectada } = ctx;

        // ── Falla segura: sin ajuste legible no sale nada ──
        if (!lectura.ok) return NextResponse.json({ error: lectura.motivo, codigo: 'ajuste_envio' }, { status: 503 });
        const ajustes = lectura.ajustes;

        if (!oc.puede.enviar) {
            return NextResponse.json({ error: oc.puede.motivo || 'La orden ya no se puede enviar.', codigo: 'estado_no_enviable' }, { status: 409 });
        }
        if (oc.renglones.length === 0) return NextResponse.json({ error: 'La orden no tiene artículos.', codigo: 'sin_items' }, { status: 409 });

        // Destinatarios que escribió el usuario (los del proveedor)
        const crudoPara = Array.isArray(body.para) ? body.para.join(',') : String(body.para ?? '');
        const crudoCc = Array.isArray(body.cc) ? body.cc.join(',') : String(body.cc ?? '');
        const invalidos = [...mailsInvalidos(crudoPara), ...mailsInvalidos(crudoCc)];
        if (invalidos.length > 0) {
            return NextResponse.json({ error: `Hay direcciones de mail mal escritas: ${invalidos.join(', ')}`, codigo: 'mail_invalido' }, { status: 400 });
        }
        const paraProveedor = separarMails(crudoPara);
        const ccProveedor = separarMails(crudoCc).filter((m) => !paraProveedor.includes(m));
        if (paraProveedor.length === 0) {
            return NextResponse.json({ error: 'Escribí el mail del proveedor al que hay que mandarle la orden.', codigo: 'sin_destinatario' }, { status: 400 });
        }

        const asuntoEscrito = String(body.asunto ?? '').trim();
        const cuerpoEscrito = String(body.cuerpo ?? '').trim();
        if (!asuntoEscrito) return NextResponse.json({ error: 'El mail no tiene asunto.', codigo: 'sin_asunto' }, { status: 400 });
        if (!cuerpoEscrito) return NextResponse.json({ error: 'El mail no tiene texto.', codigo: 'sin_cuerpo' }, { status: 400 });

        // ── A quién sale de verdad: en modo prueba, SOLO a la dirección de prueba ──
        const despacho = mailADespachar(ajustes, { para: paraProveedor, cc: ccProveedor, asunto: asuntoEscrito, texto: cuerpoEscrito });

        // Cuenta de envío: la del ajuste, y tiene que estar conectada
        if (!cuentaConectada) {
            return NextResponse.json({ error: comoConectarCuenta(ajustes.cuenta_envio), codigo: 'sin_cuenta' }, { status: 409 });
        }
        const de = cuentaConectada;

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
            mime = armarMime({ de, nombreDe: empresa?.razon_social ?? null, para: despacho.para, cc: despacho.cc, asunto: despacho.asunto, texto: despacho.texto, adjuntos });
        } catch (e: any) {
            return NextResponse.json({ error: e.message, codigo: 'mensaje_invalido' }, { status: 400 });
        }

        if (body.simular) {
            return NextResponse.json({
                success: true, simulado: true, de, para: despacho.para, cc: despacho.cc, asunto: despacho.asunto,
                modo_prueba: despacho.prueba, seria: despacho.seria, adjuntos: adjuntos.map((a) => a.nombre), bytes: mime.length,
            });
        }

        // ── Envío ──
        let enviado: { id: string; threadId: string | null };
        try {
            enviado = await enviarMailGmail(de, rawParaGmail(mime));
        } catch (e: any) {
            console.error('[OC Enviar] Gmail:', e?.message);
            return NextResponse.json({ error: e.message || 'No se pudo enviar el mail.', codigo: 'gmail' }, { status: 502 });
        }

        // ── Constancia en la orden: la dirección REAL a la que salió ──
        const avisos: string[] = [];
        const { data: marca, error: errMarca } = await supabase.rpc('oc_marcar_enviada', {
            p_orden_id: id,
            p_usuario_id: auth.user.id,
            // modo_prueba: un envío de prueba queda registrado pero NO pasa la orden a "enviada"
            p_datos: { para: despacho.para.join(', '), cc: despacho.cc.join(', '), mensaje_id: enviado.id, hilo_id: enviado.threadId, modo_prueba: despacho.prueba },
        });
        if (errMarca) {
            // El mail YA salió: no se puede devolver error (lo mandarían de nuevo). Se avisa.
            console.error('[OC Enviar] El mail salió pero no se registró:', errMarca);
            avisos.push(`El mail SE ENVIÓ a ${despacho.para.join(', ')}, pero no se pudo registrar en la orden (${errorDeFuncion(errMarca).mensaje}). No lo reenvíes: avisá a sistemas.`);
        }
        if (despacho.prueba) {
            avisos.push(`MODO PRUEBA: el mail fue a ${despacho.para.join(', ')}, NO al proveedor (habría ido a ${despacho.seria.join(', ')}).`);
        }

        // ── Guardar el mail del proveedor en su ficha, si se pidió (el que se escribió, no el de prueba) ──
        if (body.guardar_mail_en_ficha) {
            const { error: errFicha } = await supabase.from('proveedores').update({ mail_ordenes_compra: paraProveedor.join(', ') }).eq('id', oc.proveedor.id);
            if (errFicha) {
                avisos.push(faltaLaColumna(errFicha)
                    ? `No se guardó el mail en la ficha del proveedor: falta aplicar la migración ${MIGRACION_PROVEEDORES}.`
                    : `No se guardó el mail en la ficha del proveedor: ${errFicha.message}`);
            }
        }

        return NextResponse.json({
            success: true,
            numero_orden: oc.orden.numero_orden,
            de, para: despacho.para, cc: despacho.cc,
            modo_prueba: despacho.prueba,
            mensaje_id: enviado.id,
            estado: (marca as any)?.estado ?? oc.orden.estado,
            envios: (marca as any)?.envios ?? oc.orden.envios + (despacho.prueba ? 0 : 1),
            avisos,
        });
    } catch (error: any) {
        console.error('[OC Enviar] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}
