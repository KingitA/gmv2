// =====================================================
// AI Brain — Email Payment Processor
// Processes payment notifications from emails
// =====================================================

import { type ParsedEmail } from './gmail'
import { getSupabaseAdmin } from './supabase-admin'
import { hoyISO, parseFecha, parseMonto } from '@/lib/formato'

export interface PaymentProcessingResult {
    processed: boolean
    paymentCreated: boolean
    paymentId?: string
    entityType: 'cliente' | 'proveedor' | 'desconocido'
    entityId?: string
    entityName?: string
    amount?: number
    error?: string
}

/**
 * Procesa un email clasificado como "pago":
 * 1. Determina si es un pago de cliente o aviso de pago a proveedor
 * 2. Busca la entidad correspondiente
 * 3. Registra el pago/movimiento en la cuenta corriente
 */
export async function processEmailAsPayment(
    emailData: ParsedEmail,
    extractedData: {
        amount?: number
        referenceNumber?: string
        entityType?: string
        entityName?: string
        date?: string
        medioPago?: string
        banco?: string
    },
    savedEmailId: string
): Promise<PaymentProcessingResult> {
    const db = getSupabaseAdmin()
    const fechaHoy = hoyISO()

    console.log(`[PaymentProcessor] Processing payment email: "${emailData.subject}" from ${emailData.from}`)

    // Lo que devuelve la IA puede venir como texto ("1.234,56", "05/03/2026"):
    // se normaliza antes de guardar. Una fecha ilegible se descarta (queda hoy).
    const fechaIA = parseFecha(extractedData.date as any)
    if (extractedData.date && !fechaIA) console.warn(`[PaymentProcessor] ⚠️ Fecha ilegible: ${JSON.stringify(extractedData.date)} — se usa hoy`)
    extractedData = { ...extractedData, date: fechaIA ?? undefined }
    const amount = parseMonto(extractedData.amount as any) ?? undefined
    if (!amount || amount <= 0) {
        return {
            processed: true,
            paymentCreated: false,
            entityType: 'desconocido',
            error: 'No se detectó un monto válido en el email',
        }
    }

    // ── 1. Determine if client or supplier ────────────
    const isProveedor = extractedData.entityType === 'proveedor'
    const isCliente = extractedData.entityType === 'cliente'

    // ── 2. Try to find entity ─────────────────────────
    if (isCliente || (!isProveedor && !isCliente)) {
        // Try to find a client
        const clienteId = await findCliente(db, emailData, extractedData.entityName)
        if (clienteId) {
            try {
                const result = await createClientePayment(db, clienteId.id, amount, emailData, extractedData, fechaHoy)
                console.log(`[PaymentProcessor] ✅ Created client payment: ${result.id}`)
                return {
                    processed: true,
                    paymentCreated: true,
                    paymentId: result.id,
                    entityType: 'cliente',
                    entityId: clienteId.id,
                    entityName: clienteId.name,
                    amount,
                }
            } catch (err) {
                return {
                    processed: true,
                    paymentCreated: false,
                    entityType: 'cliente',
                    entityId: clienteId.id,
                    entityName: clienteId.name,
                    amount,
                    error: err instanceof Error ? err.message : 'Error creating payment',
                }
            }
        }
    }

    if (isProveedor || (!isProveedor && !isCliente)) {
        // Try to find a supplier
        const proveedorId = await findProveedor(db, emailData, extractedData.entityName)
        if (proveedorId) {
            try {
                const result = await createProveedorPayment(db, proveedorId.id, amount, emailData, extractedData, fechaHoy)
                console.log(`[PaymentProcessor] ✅ Created supplier CC movement: ${result.id}`)
                return {
                    processed: true,
                    paymentCreated: true,
                    paymentId: result.id,
                    entityType: 'proveedor',
                    entityId: proveedorId.id,
                    entityName: proveedorId.name,
                    amount,
                }
            } catch (err) {
                return {
                    processed: true,
                    paymentCreated: false,
                    entityType: 'proveedor',
                    entityId: proveedorId.id,
                    entityName: proveedorId.name,
                    amount,
                    error: err instanceof Error ? err.message : 'Error creating payment',
                }
            }
        }
    }

    return {
        processed: true,
        paymentCreated: false,
        entityType: 'desconocido',
        amount,
        error: 'No se encontró el cliente ni el proveedor asociado al pago',
    }
}

// ── Find client ────────────────────────────────────────
async function findCliente(
    db: ReturnType<typeof getSupabaseAdmin>,
    emailData: ParsedEmail,
    entityName?: string
): Promise<{ id: string; name: string } | null> {
    // By email
    if (emailData.from) {
        const { data } = await db.from('clientes').select('id, razon_social').eq('mail', emailData.from).maybeSingle()
        if (data) return { id: data.id, name: data.razon_social }
    }

    // By name
    const searchName = entityName || emailData.fromName
    if (searchName) {
        const { data } = await db.from('clientes').select('id, razon_social')
            .ilike('razon_social', `%${searchName}%`).limit(1).maybeSingle()
        if (data) return { id: data.id, name: data.razon_social }
    }

    return null
}

// ── Find supplier ──────────────────────────────────────
async function findProveedor(
    db: ReturnType<typeof getSupabaseAdmin>,
    emailData: ParsedEmail,
    entityName?: string
): Promise<{ id: string; name: string } | null> {
    if (emailData.from) {
        const { data } = await db.from('proveedores').select('id, nombre').eq('email', emailData.from).maybeSingle()
        if (data) return { id: data.id, name: data.nombre }
    }

    const searchName = entityName || emailData.fromName
    if (searchName) {
        const { data } = await db.from('proveedores').select('id, nombre')
            .ilike('nombre', `%${searchName}%`).limit(1).maybeSingle()
        if (data) return { id: data.id, name: data.nombre }
    }

    return null
}

// ── Create client payment ──────────────────────────────
async function createClientePayment(
    db: ReturnType<typeof getSupabaseAdmin>,
    clienteId: string,
    amount: number,
    emailData: ParsedEmail,
    extractedData: { referenceNumber?: string; date?: string },
    fechaHoy: string
) {
    // Create payment record as "pendiente" (needs admin approval)
    const { data, error } = await db.from('pagos').insert({
        cliente_id: clienteId,
        monto: amount,
        metodo: 'transferencia',
        referencia: extractedData.referenceNumber || `Gmail: ${emailData.subject}`,
        status: 'pendiente',
        fecha_pago: extractedData.date || fechaHoy,
        observaciones: `Importado automáticamente desde Gmail — De: ${emailData.from}`,
    }).select().single()

    if (error) throw error
    return data
}

// ── Create supplier payment CC movement ────────────────
async function createProveedorPayment(
    db: ReturnType<typeof getSupabaseAdmin>,
    proveedorId: string,
    amount: number,
    emailData: ParsedEmail,
    extractedData: { referenceNumber?: string; date?: string },
    fechaHoy: string
) {
    const { data, error } = await db.from('cuenta_corriente_proveedores').insert({
        proveedor_id: proveedorId,
        fecha: extractedData.date || fechaHoy,
        tipo_movimiento: 'pago',
        monto: -Math.abs(amount), // Payments are negative (credit) in debt-positive CC
        descripcion: `Pago registrado desde Gmail — ${extractedData.referenceNumber || emailData.subject}`,
        referencia_tipo: 'gmail',
    }).select().single()

    if (error) throw error
    return data
}
