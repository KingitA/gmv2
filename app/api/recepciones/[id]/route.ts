import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { id } = await params;
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

    // Fetch reception with related data
    const { data: recepcion, error } = await supabase
      .from("recepciones")
      .select(`
        *,
        orden_compra:ordenes_compra (
          id,
          numero_orden,
          proveedor:proveedores (
            id,
            nombre,
            cuit
          ),
          detalles:ordenes_compra_detalle (
            articulo_id,
            tipo_cantidad
          )
        ),
        items:recepciones_items (
          id,
          articulo_id,
          cantidad_oc,
          cantidad_fisica,
          cantidad_documentada,
          precio_oc,
          precio_documentado,
          precio_real,
          estado_linea,
          articulo:articulos (
            id,
            sku,
            descripcion,
            rubro,
            categoria,
            unidades_por_bulto
          )
        ),
        documentos:recepciones_documentos (
          id,
          tipo_documento,
          url_imagen,
          datos_ocr,
          procesado,
          created_at
        )
      `)
      .eq("id", id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    // Merge tipo_cantidad from OC details into reception items
    const oc = Array.isArray(recepcion.orden_compra) ? recepcion.orden_compra[0] : recepcion.orden_compra;
    const itemsWithTipo = recepcion.items.map((item: any) => {
      const ocDetail = oc?.detalles?.find(
        (d: any) => d.articulo_id === item.articulo_id
      );
      return {
        ...item,
        tipo_cantidad: ocDetail?.tipo_cantidad || "unidad" // Default to unit if not found
      };
    });

    return NextResponse.json({ ...recepcion, items: itemsWithTipo });
  } catch (error: any) {
    console.error("Error fetching reception:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
