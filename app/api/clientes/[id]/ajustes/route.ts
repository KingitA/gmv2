import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const supabase = await createClient();
        const { id: cliente_id } = await params;
        const body = await request.json();

        const { comprobante_id, monto, motivo } = body;

        // Validations
        if (!comprobante_id || !monto || !motivo) {
            return NextResponse.json(
                { error: "Faltan datos requeridos" },
                { status: 400 }
            );
        }

        // Get current user (you might want to implement proper auth)
        // For now, we'll use a placeholder
        const usuario_id = "admin"; // TODO: Get from session

        // Fetch current comprobante
        const { data: comprobante, error: compError } = await supabase
            .from("comprobantes_venta")
            .select("saldo_pendiente, cliente_id")
            .eq("id", comprobante_id)
            .single();

        if (compError || !comprobante) {
            return NextResponse.json(
                { error: "Comprobante no encontrado" },
                { status: 404 }
            );
        }

        // Verify cliente_id matches
        if (comprobante.cliente_id !== cliente_id) {
            return NextResponse.json(
                { error: "El comprobante no pertenece a este cliente" },
                { status: 400 }
            );
        }

        // Update saldo_pendiente
        const nuevo_saldo = Number(comprobante.saldo_pendiente) + Number(monto);

        const { error: updateError } = await supabase
            .from("comprobantes_venta")
            .update({ saldo_pendiente: nuevo_saldo })
            .eq("id", comprobante_id);

        if (updateError) throw updateError;

        // Log the adjustment (optional - create ajustes_saldo table if needed)
        // For now, we'll skip this step

        return NextResponse.json({
            success: true,
            nuevo_saldo,
            mensaje: "Ajuste de saldo registrado correctamente",
        });
    } catch (error: any) {
        console.error("[v0] Error creating balance adjustment:", error);
        return NextResponse.json(
            { error: error.message || "Error al ajustar saldo" },
            { status: 500 }
        );
    }
}
