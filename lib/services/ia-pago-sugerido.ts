import { createClient } from "@/lib/supabase/server"
import { LegacyAdapter } from "./legacy-adapter"

export class IAPagoSugerido {

    // --- CLIENT SIDE: IMPUTATION SUGGESTION ---
    static async generarSugerenciaImputacion(clienteId: string, montoCobrado: number) {
        // 1. Get Debt
        const comprobantes = await LegacyAdapter.getClientDebt(clienteId)

        // 2. FIFO Strategy with Exact Match Bonus
        let restante = montoCobrado
        const sugerencia: Array<{ comprobante_id: string; monto: number; numero: string }> = []

        // A. Check for exact match first (Optional optimization)
        const exactMatch = comprobantes.find(c => Math.abs(c.saldo_pendiente - montoCobrado) < 0.05)
        if (exactMatch) {
            return [{
                comprobante_id: exactMatch.id,
                monto: montoCobrado,
                numero: exactMatch.numero_comprobante
            }]
        }

        // B. Fill oldest first
        for (const comp of comprobantes) {
            if (restante <= 0) break

            const aImputar = Math.min(restante, comp.saldo_pendiente)
            sugerencia.push({
                comprobante_id: comp.id,
                monto: aImputar,
                numero: comp.numero_comprobante
            })
            restante -= aImputar
        }

        return sugerencia
    }

    // --- SUPPLIER SIDE: PAYMENT SUGGESTION ---
    static async generarPagoSugerido(proveedorId: string, montoObjetivo: number, color: "BLANCO" | "NEGRO") {
        const supabase = await createClient()

        // 1. Load context
        const { data: prefs } = await supabase.from('proveedor_preferencias_pago').select('*').eq('proveedor_id', proveedorId).single()
        const { data: cheques } = await supabase.from('cheques').select('*').eq('estado', 'EN_CARTERA').eq('color', color).order('fecha_vencimiento', { ascending: true })
        const { data: bancos } = await supabase.from('saldos_financieros').select('*').eq('cuenta_tipo', 'BANCO').eq('color', color)
        const { data: cajas } = await supabase.from('saldos_financieros').select('*').eq('cuenta_tipo', 'CAJA').eq('color', color)

        const itemsSugeridos: any[] = []
        let montoRestante = montoObjetivo

        // Heurística de Selección (Determinística "Smart")

        // A. Cheques: Prioritize if allowed and available
        if (prefs?.acepta_cheques_terceros !== false && cheques && cheques.length > 0) {
            // Find cheques expiring soon or matching amounts
            for (const cheque of cheques) {
                if (montoRestante <= 0) break
                if (cheque.monto <= montoRestante) {
                    // Use cheque
                    itemsSugeridos.push({
                        tipo: 'CHEQUE',
                        id: cheque.id,
                        monto: cheque.monto,
                        detalle: `Ch. ${cheque.banco} #${cheque.numero}`
                    })
                    montoRestante -= cheque.monto
                }
            }
        }

        // B. Transferencia: If still needed
        if (montoRestante > 0 && prefs?.acepta_transferencia !== false && bancos) {
            // Find bank with enough balance
            const bancoConSaldo = bancos.find(b => b.saldo >= montoRestante)
            if (bancoConSaldo) {
                itemsSugeridos.push({
                    tipo: 'BANCO',
                    aux_id: bancoConSaldo.cuenta_id,
                    monto: montoRestante,
                    detalle: `Transferencia`
                })
                montoRestante = 0
            }
        }

        // C. Efectivo: Last resort
        if (montoRestante > 0 && prefs?.acepta_efectivo !== false && cajas) {
            const cajaConSaldo = cajas.find(c => c.saldo >= montoRestante)
            if (cajaConSaldo) {
                itemsSugeridos.push({
                    tipo: 'EFECTIVO',
                    aux_id: cajaConSaldo.cuenta_id,
                    monto: montoRestante,
                    detalle: `Efectivo`
                })
                montoRestante = 0
            }
        }

        // Save Draft
        const { data: sugerencia } = await supabase.from('pagos_proveedores_sugeridos').insert({
            proveedor_id: proveedorId,
            color,
            monto_objetivo: montoObjetivo,
            items_json: itemsSugeridos,
            razonamiento: `Se priorizaron ${itemsSugeridos.filter(i => i.tipo === 'CHEQUE').length} cheques por vencer.`,
            estado: 'BORRADOR'
        }).select().single()

        return sugerencia
    }
}
