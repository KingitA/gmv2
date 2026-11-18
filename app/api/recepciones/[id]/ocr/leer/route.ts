import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { leerDocumentoRecepcion } from '@/lib/deposito/documentos-recepcion';

// Leer un documento puede tardar (varias hojas en una sola lectura)
export const maxDuration = 60;

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
 *   200 { success, no_leido, aviso, motivo, document }     quedó adjunto, sin comprobante
 *   200 { success, adjunto, document }                     foto de respaldo (no se lee)
 *   409 { error, codigo: comprobante_duplicado | faltan_hojas | sin_archivo, document? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAuth();
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
        return NextResponse.json({ error: error?.message || 'No se pudo leer el documento.' }, { status: 500 });
    }
}
