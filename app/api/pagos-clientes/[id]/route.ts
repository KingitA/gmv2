import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params

    const { data: pago, error } = await supabase
      .from("pagos_clientes")
      .select(`
        *,
        clientes(id, nombre, razon_social, cuit, direccion),
        vendedor:vendedores!pagos_clientes_vendedor_id_fkey(nombre),
        pagos_detalle(*),
        retenciones(*),
        recibos(id, numero_recibo, pdf_url, fecha, monto_total)
      `)
      .eq("id", id)
      .single()

    if (error || !pago) {
      return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 })
    }

    // Cargar depósito items para cada detalle de tipo depósito
    const detallesConItems = await Promise.all(
      (pago.pagos_detalle || []).map(async (det: any) => {
        if (det.tipo_pago === "deposito") {
          const { data: items } = await supabase
            .from("pago_deposito_items")
            .select("*")
            .eq("pago_detalle_id", det.id)
          return { ...det, deposito_items: items || [] }
        }
        return det
      })
    )

    // Cargar imputaciones con detalle de comprobante
    const { data: imputaciones } = await supabase
      .from("imputaciones")
      .select(`
        *,
        comprobante:comprobantes_venta(
          tipo_comprobante, numero_comprobante, fecha, total_factura, saldo_pendiente
        )
      `)
      .eq("pago_id", id)

    // Cargar datos de caja/banco para los detalles
    const cajaIds = detallesConItems
      .filter((d: any) => d.caja_id)
      .map((d: any) => d.caja_id)
    const bancoIds = detallesConItems
      .filter((d: any) => d.cuenta_bancaria_id)
      .map((d: any) => d.cuenta_bancaria_id)

    const [{ data: cajas }, { data: bancos }] = await Promise.all([
      cajaIds.length
        ? supabase.from("cajas_financieras").select("id, nombre").in("id", cajaIds)
        : Promise.resolve({ data: [] }),
      bancoIds.length
        ? supabase.from("cuentas_bancarias").select("id, nombre, banco").in("id", bancoIds)
        : Promise.resolve({ data: [] }),
    ])

    const cajaMap = new Map((cajas || []).map((c: any) => [c.id, c.nombre]))
    const bancoMap = new Map((bancos || []).map((b: any) => [b.id, `${b.banco} (${b.nombre})`]))

    const detallesEnriquecidos = detallesConItems.map((d: any) => ({
      ...d,
      caja_nombre: d.caja_id ? cajaMap.get(d.caja_id) : null,
      banco_nombre: d.cuenta_bancaria_id ? bancoMap.get(d.cuenta_bancaria_id) : null,
    }))

    return NextResponse.json({
      ...pago,
      pagos_detalle: detallesEnriquecidos,
      imputaciones: imputaciones || [],
    })
  } catch (error: any) {
    console.error("[pagos-clientes/id] GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
