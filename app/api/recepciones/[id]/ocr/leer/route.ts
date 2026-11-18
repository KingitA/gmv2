import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requirePermiso } from '@/lib/auth';
import { leerDocumentoRecepcion } from '@/lib/deposito/documentos-recepcion';

// Leer un documento puede tardar (varias hojas en una sola lectura; uno muy pesado, en tandas)
export const maxDuration = 300;

/**
 * POST /api/recepciones/[id]/ocr/leer  { document_id }
 *
 * Lee un documento que YA está subido (app Depósito, outbox `recepcion.documento`): todas sus
 * hojas en una sola lectura = un solo comprobante (E-38). La dispara la app cuando el documento
 * terminó de subir; si no llega a hacerlo, el documento queda "pendiente de leer".
 *
 * Idempotente: llamar dos veces por el mismo documento no crea dos comprobantes (la compuerta
 * está en la base). Respuestas:
 *   200 { success, document, comprobante, aviso? }        leído
 *   200 { success, ya_leido | en_curso, document }         no había nada que hacer
 *   200 { success, no_leido, aviso, motivo, detalle_tecnico, document }   quedó adjunto, sin comprobante (motivo en castellano)
 *   200 { success, adjunto, document }                     foto de respaldo (no se lee)
 *   409 { error, codigo: comprobante_duplicado | faltan_hojas | sin_archivo, document? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    // Solo depósito y oficina (no cualquier usuario con sesión)
    const auth = await requirePermiso('documentos_recepcion');
    if (auth.error) return auth.error;
    try {
        const { id: recepcion_id } = await params;
        const body = await request.json().catch(() => null);
        const documento_id = typeof body?.document_id === 'string' ? body.document_id : '';
        if (!/^[0-9a-f-]{36}$/i.test(documento_id)) return NextResponse.json({ error: 'Falta el documento.' }, { status: 400 });

        const r = await leerDocumentoRecepcion(createAdminClient(), { recepcion_id, documento_id });
        return NextResponse.json(r.body, { status: r.status });
    } catch (error: any) {
        console.error('[Recepción leer documento] Error:', error);
        // Al operario, en castellano; el error crudo va aparte
        return NextResponse.json({ error: 'No se pudo leer el documento. Quedó subido: probá leerlo de nuevo en un rato o avisá a la oficina.', detalle_tecnico: String(error?.message || error) }, { status: 500 });
    }
}
