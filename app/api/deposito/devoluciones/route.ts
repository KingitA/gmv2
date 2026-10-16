import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { ErrorDeposito } from "@/lib/deposito/picking"
import { confirmarDevolucion, revisarDevolucion, type RenglonRevision } from "@/lib/deposito/devoluciones"
import { getUsuarioActual } from "@/lib/deposito/preparadores"

// GET: Devoluciones pendientes de revisar físicamente
export async function GET() {
  const auth = await requirePermiso("revisar_devoluciones_deposito")
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    const { data: devoluciones, error } = await supabase
      .from("devoluciones")
      .select(`
        id,
        numero_devolucion,
        estado,
        observaciones,
        monto_total,
        created_at,
        clientes(id, nombre, razon_social),
        devoluciones_detalle(
          id,
          cantidad,
          cantidad_original,
          precio_venta_original,
          subtotal,
          motivo,
          es_vendible,
          condicion,
          estado_renglon,
          articulos(id, sku, descripcion, ean13)
        )
      `)
      .in("estado", ["pendiente"])
      .order("created_at", { ascending: true })

    if (error) throw error

    return NextResponse.json(devoluciones || [])
  } catch (error: any) {
    console.error("[deposito] Error GET devoluciones:", error)
    return NextResponse.json({ error: "Error al obtener devoluciones" }, { status: 500 })
  }
}

// POST: Revisar la devolución (aceptar / rechazar / modificar renglones).
// Body: { devolucion_id, renglones?: [{ id, aceptar, cantidad_aceptada?, es_vendible?, condicion?, motivo? }],
//         motivo?, items_confirmados? (contrato viejo: aceptar todo) }
// Renglones que no vienen se aceptan tal cual. Lógica en lib/deposito/devoluciones.ts
// (la comparte el outbox de la app Depósito).
export async function POST(request: NextRequest) {
  const auth = await requirePermiso("revisar_devoluciones_deposito")
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { devolucion_id, items_confirmados, renglones, motivo } = await request.json()
    const usuario = await getUsuarioActual(supabase)
    const usuarioId = usuario.id || auth.user.id

    if (Array.isArray(renglones) || !Array.isArray(items_confirmados)) {
      const r = await revisarDevolucion(supabase, {
        devolucionId: devolucion_id,
        usuarioId,
        usuarioNombre: usuario.nombre,
        renglones: Array.isArray(renglones) ? (renglones as RenglonRevision[]) : [],
        motivoGeneral: typeof motivo === "string" ? motivo : null,
      })
      return NextResponse.json(r)
    }
    // items_confirmados: [{ detalle_id, articulo_id, cantidad_recibida, es_vendible }]
    return NextResponse.json(
      await confirmarDevolucion(supabase, devolucion_id, items_confirmados, usuario.nombre, undefined, usuarioId),
    )
  } catch (error: any) {
    if (error instanceof ErrorDeposito) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
    console.error("[deposito] Error POST devoluciones:", error)
    return NextResponse.json({ error: "Error al revisar la devolución" }, { status: 500 })
  }
}
