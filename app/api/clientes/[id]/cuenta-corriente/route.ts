import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth';

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        // Use direct supabase-js client with Service Role Key for admin access
        const supabase = createSupabaseClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                }
            }
        );
        const { id: cliente_id } = await params;

        // 1. Fetch client data
        const { data: cliente, error: clienteError } = await supabase
            .from("clientes")
            .select("id, razon_social, nombre, cuit, direccion, telefono, condicion_iva")
            .eq("id", cliente_id)
            .single();

        if (clienteError || !cliente) {
            return NextResponse.json(
                { error: "Cliente no encontrado" },
                { status: 404 }
            );
        }

        // 2. Fetch comprobantes (invoices and credit notes)
        // Note: Using estado_pago instead of estado as per database schema
        const { data: comprobantes, error: comprobantesError } = await supabase
            .from("comprobantes_venta")
            .select(`
        id,
        tipo_comprobante,
        numero_comprobante,
        fecha,
        pedido_id,
        total_neto,
        total_iva,
        total_factura,
        saldo_pendiente,
        estado_pago
      `)
            .eq("cliente_id", cliente_id)
            .order("fecha", { ascending: false });

        if (comprobantesError) {
            console.error("[v0] Error fetching comprobantes:", comprobantesError);
        }

        console.log("[DEBUG] Cliente ID:", cliente_id);
        console.log("[DEBUG] Cliente data:", cliente);
        console.log("[DEBUG] Comprobantes encontrados:", comprobantes?.length || 0);

        if (comprobantesError) {
            console.error("[DEBUG] Error en query de comprobantes:", comprobantesError);
        }

        // Fetch pedido numbers for comprobantes that have pedido_id
        const comprobantesConPedido = await Promise.all(
            (comprobantes || []).map(async (comp: any) => {
                if (comp.pedido_id) {
                    const { data: pedido } = await supabase
                        .from("pedidos")
                        .select("numero_pedido")
                        .eq("id", comp.pedido_id)
                        .single();

                    return {
                        ...comp,
                        numero_pedido: pedido?.numero_pedido || ""
                    };
                }
                return {
                    ...comp,
                    numero_pedido: ""
                };
            })
        );

        // 3. Fetch pagos (payments) with imputations
        const { data: pagos, error: pagosError } = await supabase
            .from("pagos_clientes")
            .select(`
        id,
        fecha_pago,
        monto,
        forma_pago,
        estado,
        observaciones,
        created_at
      `)
            .eq("cliente_id", cliente_id)
            .order("fecha_pago", { ascending: false });

        if (pagosError) {
            console.error("[v0] Error fetching pagos:", pagosError);
        }

        // For each payment, fetch imputations
        const pagosConImputaciones = await Promise.all(
            (pagos || []).map(async (pago) => {
                const { data: imputaciones } = await supabase
                    .from("imputaciones")
                    .select(`
            id,
            comprobante_id,
            monto_imputado,
            tipo_comprobante
          `)
                    .eq("pago_id", pago.id);

                const { data: detalles } = await supabase
                    .from("pagos_detalle")
                    .select("tipo_pago, monto, numero_cheque, banco, referencia")
                    .eq("pago_id", pago.id);

                return {
                    ...pago,
                    imputaciones: imputaciones || [],
                    detalles: detalles || [],
                };
            })
        );

        // 4. Fetch devoluciones (returns)
        const { data: devoluciones, error: devolucionesError } = await supabase
            .from("devoluciones")
            .select(`
        id,
        numero_devolucion,
        created_at,
        monto_total,
        estado,
        observaciones
      `)
            .eq("cliente_id", cliente_id)
            .order("created_at", { ascending: false });

        // 4.5 Fetch 'Pedidos' from cuenta_corriente table (Pendientes de Facturación)
        const { data: pedidosCtaCte, error: pedidosError } = await supabase
            .from("cuenta_corriente")
            .select("*")
            .eq("cliente_id", cliente_id)
            .eq("tipo_comprobante", "PEDIDO");

        // Merge Pedidos into Comprobantes list
        const pedidosFormatted = (pedidosCtaCte || []).map((p: any) => ({
            id: p.id,
            tipo_comprobante: "Pedido",
            numero_comprobante: p.numero_comprobante, // e.g. PED-0001
            fecha: p.fecha,
            pedido_id: p.pedido_ref_id, // Reference to real pedido
            numero_pedido: p.numero_comprobante,
            total_factura: p.debe, // In CtaCte 'debe' is the amount
            saldo_pendiente: p.saldo,
            estado_pago: "pendiente"
        }));

        // Combine
        const allComprobantes = [...(comprobantesConPedido || []), ...pedidosFormatted];
        // Re-sort by date
        allComprobantes.sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

        if (devolucionesError) {
            console.error("[v0] Error fetching devoluciones:", devolucionesError);
        }

        // 5. Calculate total outstanding balance
        const saldo_total = allComprobantes.reduce(
            (sum: number, comp: any) => sum + Number(comp.saldo_pendiente || 0),
            0
        );

        // 6. Format response
        const response = {
            cliente: {
                ...cliente,
                saldo_total,
                condicion_iva: cliente.condicion_iva || null,
            },
            comprobantes: allComprobantes.map((comp: any) => ({
                id: comp.id,
                tipo_comprobante: comp.tipo_comprobante,
                numero_comprobante: comp.numero_comprobante,
                fecha: comp.fecha,
                pedido_id: comp.pedido_id,
                numero_pedido: comp.numero_pedido || comp.numero_comprobante, // Ensure we show something
                total_neto: Number(comp.total_neto || 0),
                total_iva: Number(comp.total_iva || 0),
                total_factura: Number(comp.total_factura),
                saldo_pendiente: Number(comp.saldo_pendiente),
                estado: comp.estado_pago || "pendiente", // Map estado_pago to estado
            })),
            pagos: pagosConImputaciones,
            devoluciones: devoluciones || [],
        };

        return NextResponse.json(response);
    } catch (error: any) {
        console.error("[v0] Error en GET /api/clientes/[id]/cuenta-corriente:", error);
        return NextResponse.json(
            { error: error.message || "Error interno del servidor" },
            { status: 500 }
        );
    }
}
