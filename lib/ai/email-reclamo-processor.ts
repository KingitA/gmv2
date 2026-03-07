// =====================================================
// AI Brain — Email Reclamo (Complaint) Processor
// Processes customer/supplier complaints from emails
// =====================================================

import { type ParsedEmail } from './gmail'
import { getSupabaseAdmin } from './supabase-admin'
import type { ExtractedReclamoData } from './types'

export interface ReclamoProcessingResult {
    processed: boolean
    reclamoCreated: boolean
    entityType: 'cliente' | 'proveedor' | 'desconocido'
    entityId?: string
    entityName?: string
    motivo?: string
    error?: string
}

/**
 * Processes an email classified as "reclamo":
 * 1. Uses extracted reclamo data from Claude unified classifier
 * 2. Finds the related client or supplier
 * 3. Creates an agenda event of type reclamo_resolver
 * 4. Records details including affected products and requested action
 */
export async function processEmailAsReclamo(
    emailData: ParsedEmail,
    reclamoData: ExtractedReclamoData | undefined,
    savedEmailId: string
): Promise<ReclamoProcessingResult> {
    const db = getSupabaseAdmin()
    const fechaHoy = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).split(',')[0]

    console.log(`[ReclamoProcessor] Processing reclamo email: "${emailData.subject}" from ${emailData.from}`)

    // ── 1. Find related entity ─────────────────────────
    let entityType: 'cliente' | 'proveedor' | 'desconocido' = 'desconocido'
    let entityId: string | undefined
    let entityName: string | undefined

    // Try finding as client first (most common for complaints)
    if (emailData.from) {
        const { data: cliente } = await db
            .from('clientes')
            .select('id, razon_social')
            .eq('mail', emailData.from)
            .maybeSingle()

        if (cliente) {
            entityType = 'cliente'
            entityId = cliente.id
            entityName = cliente.razon_social
        }
    }

    // Try by sender name
    if (entityType === 'desconocido' && emailData.fromName) {
        const { data: cliente } = await db
            .from('clientes')
            .select('id, razon_social')
            .ilike('razon_social', `%${emailData.fromName}%`)
            .limit(1)
            .maybeSingle()

        if (cliente) {
            entityType = 'cliente'
            entityId = cliente.id
            entityName = cliente.razon_social
        } else {
            // Try as supplier
            const { data: proveedor } = await db
                .from('proveedores')
                .select('id, nombre')
                .ilike('nombre', `%${emailData.fromName}%`)
                .limit(1)
                .maybeSingle()

            if (proveedor) {
                entityType = 'proveedor'
                entityId = proveedor.id
                entityName = proveedor.nombre
            }
        }
    }

    // ── 2. Build reclamo description ───────────────────
    const motivo = reclamoData?.motivo || 'Reclamo recibido por email'
    const urgencia = reclamoData?.urgencia || 'media'
    const accion = reclamoData?.accion_solicitada || null

    let description = `Reclamo de ${entityName || emailData.fromName || emailData.from || 'desconocido'}.`
    description += `\nMotivo: ${motivo}`

    if (reclamoData?.productos_afectados && reclamoData.productos_afectados.length > 0) {
        description += '\nProductos afectados:'
        for (const prod of reclamoData.productos_afectados) {
            description += `\n  - ${prod.nombre}`
            if (prod.cantidad) description += ` (cantidad: ${prod.cantidad})`
            if (prod.problema) description += ` — ${prod.problema}`
        }
    }

    if (accion) {
        description += `\nAcción solicitada: ${accion}`
    }

    description += `\n\nEmail: "${emailData.subject}" de ${emailData.from}`

    // ── 3. Create agenda event ─────────────────────────
    try {
        const { error: eventError } = await db.from('ai_agenda_events').insert({
            title: `⚠️ Reclamo — ${entityName || emailData.fromName || emailData.from}`,
            description,
            event_type: 'reclamo_resolver',
            priority: urgencia,
            status: 'pendiente',
            due_date: fechaHoy,
            source: 'gmail',
            source_ref_id: savedEmailId,
            related_entity_type: entityType !== 'desconocido' ? entityType : null,
            related_entity_id: entityId || null,
            metadata: {
                email_subject: emailData.subject,
                email_from: emailData.from,
                reclamo_data: reclamoData || null,
                motivo,
                accion_solicitada: accion,
                productos_afectados: reclamoData?.productos_afectados || [],
            },
        })

        if (eventError) {
            console.error(`[ReclamoProcessor] Error creating event:`, eventError.message)
            return {
                processed: true,
                reclamoCreated: false,
                entityType,
                entityId,
                entityName,
                motivo,
                error: eventError.message,
            }
        }

        console.log(`[ReclamoProcessor] ✅ Created reclamo event for ${entityName || 'unknown entity'}`)

        return {
            processed: true,
            reclamoCreated: true,
            entityType,
            entityId,
            entityName,
            motivo,
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error'
        console.error(`[ReclamoProcessor] Error:`, msg)
        return {
            processed: true,
            reclamoCreated: false,
            entityType,
            entityId,
            entityName,
            motivo,
            error: msg,
        }
    }
}
