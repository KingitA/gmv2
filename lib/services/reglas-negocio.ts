import { createClient } from "@/lib/supabase/server"

export class ReglasNegocio {
    static async resolveColor(params: {
        clienteId: string
        monto: number
        colorSugerido?: "BLANCO" | "NEGRO" | null
        overrideColor?: "BLANCO" | "NEGRO" | null
        userRole: string
    }): Promise<"BLANCO" | "NEGRO"> {
        // 1. Check Override (Admin/Office)
        if (params.overrideColor && ["admin", "oficina"].includes(params.userRole)) {
            return params.overrideColor
        }

        // 2. Automated Logic
        // If we had access to real-time client balances by color:
        /*
        const supabase = await createClient()
        const { data: cliente } = await supabase.from('clientes').select('saldo_blanco, saldo_negro').eq('id', params.clienteId).single()
        if (cliente) {
            if (cliente.saldo_negro > cliente.saldo_blanco) return 'NEGRO'
            if (cliente.saldo_blanco > cliente.saldo_negro) return 'BLANCO'
        }
        */

        // 3. Fallback: Use Suggested or Default to NEGRO if not specified
        // (Adjust default based on business preference)
        return params.colorSugerido || "NEGRO"
    }
}
