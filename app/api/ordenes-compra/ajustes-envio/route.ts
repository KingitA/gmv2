import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { getUserRoles, requireAuth, requirePermiso } from '@/lib/auth';
import { estadoCuentaGmail } from '@/lib/ai/gmail';
import { CONFIRMACION_APAGAR_PRUEBA, comoConectarCuenta, leerAjustesEnvio } from '@/lib/compras/envio-ajustes';
import { mailValido } from '@/lib/compras/mail-orden';
import { errorDeFuncion, MIGRACION_OC } from '@/lib/compras/orden-compra';
import { faltaLaFuncion } from '@/lib/utils/migracion-pendiente';

/**
 * Ajuste del envío de órdenes de compra por mail (decisión de Juan, 17/11/2026).
 *
 * GET  → cómo está: cuenta de envío (y si está conectada), MODO PRUEBA, dirección de prueba,
 *        quién lo cambió por última vez y cuándo, y si el que mira es admin. Lo ve cualquier
 *        usuario (para que sepa a dónde van los mails); lo cambia solo un admin.
 * POST → { cuenta_envio?, mail_prueba?, modo_prueba?, confirmacion? }  (solo admin)
 *        Apagar el modo prueba exige `confirmacion` = la frase exacta
 *        "A partir de ahora los mails van a los proveedores reales".
 *        Cada cambio queda en `compras_envio_ajustes_historial` con quién y cuándo.
 */
export async function GET() {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const supabase = createAdminClient();
        const [roles, lectura] = await Promise.all([getUserRoles(auth.user.id), leerAjustesEnvio(supabase)]);
        const admin = roles.includes('admin');
        if (!lectura.ok) return NextResponse.json({ ok: false, bloqueo: lectura.motivo, admin });
        const { estado } = await estadoCuentaGmail(lectura.ajustes.cuenta_envio).catch(() => ({ estado: 'no_conectada' as const }));
        const conectada = estado === 'conectada';
        return NextResponse.json({
            ok: true, admin,
            cuenta_envio: lectura.ajustes.cuenta_envio,
            cuenta_conectada: conectada,
            // conectada | vencida | sin_permiso | no_conectada (preguntándole a Google)
            cuenta_estado: estado,
            como_conectar: conectada ? null : comoConectarCuenta(lectura.ajustes.cuenta_envio, estado),
            modo_prueba: lectura.ajustes.modo_prueba,
            mail_prueba: lectura.ajustes.mail_prueba,
            actualizado_at: lectura.actualizado_at,
            actualizado_por: lectura.actualizado_por,
            frase_confirmacion: CONFIRMACION_APAGAR_PRUEBA,
        });
    } catch (error: any) {
        console.error('[OC Ajustes envío] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const auth = await requirePermiso('compras');
    if (auth.error) return auth.error;
    try {
        const roles = await getUserRoles(auth.user.id);
        if (!roles.includes('admin')) {
            return NextResponse.json({ error: 'Solo un administrador puede cambiar el envío de órdenes de compra.', error_code: 'SIN_PERMISO' }, { status: 403 });
        }
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 });

        const supabase = createAdminClient();
        const actual = await leerAjustesEnvio(supabase);
        const datos: Record<string, unknown> = {};

        if (typeof body.cuenta_envio === 'string' && body.cuenta_envio.trim()) {
            const c = body.cuenta_envio.trim().toLowerCase();
            if (!mailValido(c)) return NextResponse.json({ error: 'La cuenta de envío no es un mail válido.', codigo: 'cuenta_invalida' }, { status: 400 });
            datos.cuenta_envio = c;
        }
        if (typeof body.mail_prueba === 'string' && body.mail_prueba.trim()) {
            const m = body.mail_prueba.trim().toLowerCase();
            if (!mailValido(m)) return NextResponse.json({ error: 'La dirección de prueba no es un mail válido.', codigo: 'mail_invalido' }, { status: 400 });
            datos.mail_prueba = m;
        }
        if (typeof body.modo_prueba === 'boolean') {
            const estabaEncendido = !actual.ok || actual.ajustes.modo_prueba;
            if (body.modo_prueba === false && estabaEncendido) {
                // Apagar = los mails empiezan a ir a los proveedores: confirmación explícita, palabra por palabra
                if (String(body.confirmacion ?? '').trim() !== CONFIRMACION_APAGAR_PRUEBA) {
                    return NextResponse.json({
                        error: `Para apagar el modo prueba hay que confirmar escribiendo exactamente: "${CONFIRMACION_APAGAR_PRUEBA}".`,
                        codigo: 'falta_confirmacion',
                    }, { status: 400 });
                }
            }
            datos.modo_prueba = body.modo_prueba;
        }
        if (Object.keys(datos).length === 0) return NextResponse.json({ error: 'No hay nada para cambiar.' }, { status: 400 });

        const { data, error } = await supabase.rpc('compras_envio_ajustes_guardar', { p_usuario_id: auth.user.id, p_datos: datos });
        if (error) {
            if (faltaLaFuncion(error, 'compras_envio_ajustes_guardar')) {
                return NextResponse.json({ error: `Falta aplicar la migración ${MIGRACION_OC}. Hasta entonces no se envía ningún mail de orden de compra.`, codigo: 'migracion_pendiente' }, { status: 503 });
            }
            const e = errorDeFuncion(error);
            if (e.status === 500) console.error('[OC Ajustes envío] Error:', error);
            return NextResponse.json({ error: e.mensaje, codigo: e.codigo }, { status: e.status });
        }
        return NextResponse.json({ success: true, ...(data as any) });
    } catch (error: any) {
        console.error('[OC Ajustes envío] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}
