import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export const dynamic = "force-dynamic";

export async function GET() {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                },
            }
        );

        // Fetch orders that are 'pendiente' or 'recibida_parcial'
        // Also fetch provider details
        const { data: ordenes, error } = await supabase
            .from("ordenes_compra")
            .select(`
        id,
        numero_orden,
        fecha_orden,
        estado,
        observaciones,
        proveedor:proveedores (
          id,
          nombre,
          cuit
        ),
        items:ordenes_compra_detalle (
          count
        )
      `)
            .in("estado", ["pendiente", "recibida_parcial"])
            .order("fecha_orden", { ascending: false });

        if (error) {
            console.error("Error fetching pending orders:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Transform data for frontend
        const formattedOrdenes = ordenes.map((orden: any) => ({
            id: orden.id,
            numero: orden.numero_orden,
            fecha: orden.fecha_orden,
            proveedor: orden.proveedor?.nombre || "Desconocido",
            cuit_proveedor: orden.proveedor?.cuit,
            estado: orden.estado,
            items_count: orden.items?.[0]?.count || 0,
            observaciones: orden.observaciones,
        }));

        return NextResponse.json(formattedOrdenes);
    } catch (error: any) {
        console.error("Internal error fetching pending orders:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
