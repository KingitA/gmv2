"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { LegacyAdapter } from "../services/legacy-adapter"
import { ReglasNegocio } from "../services/reglas-negocio"
import { IAPagoSugerido } from "../services/ia-pago-sugerido"
import { nowArgentina } from "@/lib/utils"

// --- GETTERS ---

export async function getSaldos() {
    const supabase = await createClient()
    const { data } = await supabase.from("saldos_financieros").select("*")
    return data
}

export async function getPagosPendientes() {
    const supabase = await createClient()
    const { data } = await supabase.from("pagos_pendientes").select("*").eq("estado", "PENDIENTE").order("fecha_carga", { ascending: true })
    return data
}

export async function getChequesEnCartera() {
    const supabase = await createClient()
    const { data } = await supabase.from("cheques").select("*").eq("estado", "EN_CARTERA")
    return data
}

// --- ACTIONS ---

export async function confirmarCobro(params: {
    pagoId: string
    destinoTipo: "CAJA" | "BANCO"
    destinoId: string
    imputaciones?: Array<{ comprobante_id: string; monto: number }>
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Unauthorized")

    // 1. Get Payment Info
    const { data: pago } = await supabase.from("pagos_pendientes").select("*").eq("id", params.pagoId).single()
    if (!pago) throw new Error("Pago not found")

    // 2. Resolve Color
    const colorFinal = await ReglasNegocio.resolveColor({
        clienteId: pago.cliente_id,
        monto: pago.monto,
        colorSugerido: pago.color_sugerido,
        userRole: "admin", // TODO: Get real role
    })

    // 3. Execute Financial Transaction (RPC)
    const { data: rpcData, error: rpcError } = await supabase.rpc("fin_confirmar_pago_pendiente", {
        p_pago_id: params.pagoId,
        p_destino_tipo: params.destinoTipo,
        p_destino_id: params.destinoId,
        p_color_final: colorFinal,
        p_user_id: user.id
    })

    if (rpcError) throw new Error(`Financial Error: ${rpcError.message}`)

    // 4. Update Legacy System (Documentary)
    await LegacyAdapter.applyClientPayment({
        clienteId: pago.cliente_id,
        monto: pago.monto,
        metodo: pago.metodo,
        fecha: nowArgentina(),
        color: colorFinal,
        referenciaTipo: "PAGO_PENDIENTE",
        referenciaId: params.pagoId,
        userId: user.id,
        imputaciones: params.imputaciones
    })

    revalidatePath("/finanzas")
    return { success: true, color: colorFinal }
}


export async function crearPagoProveedor(params: {
    proveedorId: string
    color: "BLANCO" | "NEGRO"
    items: Array<{
        tipo: "EFECTIVO" | "BANCO" | "CHEQUE" | "CHEQUE_PROPIO"
        id?: string // cheque_id
        aux_id?: string // caja_id or banco_id
        monto: number
        banco?: string
        numero?: string
        fecha_emision?: string
        fecha_vencimiento?: string
    }>
    total: number
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Unauthorized")

    // 1. RPC Call
    const { data, error } = await supabase.rpc("fin_crear_pago_proveedor", {
        p_proveedor_id: params.proveedorId,
        p_color: params.color,
        p_items_json: params.items,
        p_total: params.total,
        p_user_id: user.id
    })

    if (error) throw new Error(error.message)

    // 2. Legacy Call
    // (Optional: if we found a legacy table, we would call it here)

    revalidatePath("/finanzas")
    return data
}


export async function depositarCheque(chequeId: string, cuentaBancoId: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { error } = await supabase.rpc("fin_depositar_cheque", {
        p_cheque_id: chequeId,
        p_cuenta_banco_id: cuentaBancoId,
        p_user_id: user?.id
    })

    if (error) throw error
    revalidatePath("/finanzas/cheques")
    return { success: true }
}


// --- IA HELPERS ---

export async function obtenerSugerenciaImputacion(clienteId: string, monto: number) {
    return IAPagoSugerido.generarSugerenciaImputacion(clienteId, monto)
}

export async function obtenerSugerenciaPagoProveedor(proveedorId: string, monto: number, color: "BLANCO" | "NEGRO") {
    return IAPagoSugerido.generarPagoSugerido(proveedorId, monto, color)
}

export async function ejecutarPagoSugerido(sugerenciaId: string) {
    const supabase = await createClient()
    const { data: sug } = await supabase.from('pagos_proveedores_sugeridos').select('*').eq('id', sugerenciaId).single()
    if (!sug) throw new Error("Suggestion not found")

    // Call createPagoProveedor with the payload from suggestion
    return crearPagoProveedor({
        proveedorId: sug.proveedor_id,
        color: sug.color,
        items: sug.items_json,
        total: sug.monto_objetivo
    })
}
