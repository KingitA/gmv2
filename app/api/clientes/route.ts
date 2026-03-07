import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const vendedor_id = searchParams.get("vendedor_id")

    if (!vendedor_id) {
      return NextResponse.json({ error: "Se requiere vendedor_id" }, { status: 400 })
    }

    // Obtener clientes del vendedor con estado de cuenta
    const { data: clientes, error: clientesError } = await supabase
      .from("clientes")
      .select(`
        *,
        localidades (
          nombre,
          provincia,
          zonas (
            nombre,
            porcentaje_flete
          )
        )
      `)
      .eq("vendedor_id", vendedor_id)
      .eq("activo", true)
      .order("nombre")

    if (clientesError) throw clientesError

    // Para cada cliente, calcular estado de cuenta
    const clientesConEstado = await Promise.all(
      clientes.map(async (cliente) => {
        // Obtener comprobantes pendientes
        const { data: comprobantes } = await supabase
          .from("comprobantes_venta")
          .select("saldo_pendiente, fecha_vencimiento")
          .eq("cliente_id", cliente.id)
          .gt("saldo_pendiente", 0)

        const saldoTotal = comprobantes?.reduce((sum, c) => sum + (c.saldo_pendiente || 0), 0) || 0

        // Verificar si hay pagos vencidos
        const hoy = todayArgentina()
        const tieneVencidos = comprobantes?.some((c) => c.fecha_vencimiento && c.fecha_vencimiento < hoy) || false

        let estadoCuenta: "libre" | "pendiente" | "vencido"
        if (saldoTotal === 0) {
          estadoCuenta = "libre"
        } else if (tieneVencidos) {
          estadoCuenta = "vencido"
        } else {
          estadoCuenta = "pendiente"
        }

        return {
          ...cliente,
          estado_cuenta: {
            estado: estadoCuenta,
            saldo_total: saldoTotal,
            tiene_vencidos: tieneVencidos,
          },
        }
      }),
    )

    return NextResponse.json({
      success: true,
      clientes: clientesConEstado,
    })
  } catch (error: any) {
    console.error("[v0] Error obteniendo clientes:", error)
    return NextResponse.json({ error: error.message || "Error obteniendo clientes" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()

    const {
      nombre,
      razon_social,
      cuit,
      direccion,
      localidad_id,
      telefono,
      mail,
      condicion_iva,
      vendedor_id,
      metodo_facturacion = "factura",
      condicion_pago = "contado",
      tipo_canal = "minorista",
    } = body

    // Validaciones
    if (!nombre || !vendedor_id) {
      return NextResponse.json({ error: "Nombre y vendedor_id son requeridos" }, { status: 400 })
    }

    // Crear cliente
    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .insert({
        nombre,
        razon_social,
        nombre_razon_social: razon_social || nombre,
        cuit,
        direccion,
        localidad_id,
        telefono,
        mail,
        condicion_iva,
        vendedor_id,
        metodo_facturacion,
        condicion_pago,
        tipo_canal,
        activo: true,
        puntaje: 50, // Puntaje inicial
        nivel_puntaje: "REGULAR",
        retira_en_deposito: false,
      })
      .select()
      .single()

    if (clienteError) throw clienteError

    return NextResponse.json({
      success: true,
      cliente,
    })
  } catch (error: any) {
    console.error("[v0] Error creando cliente:", error)
    return NextResponse.json({ error: error.message || "Error creando cliente" }, { status: 500 })
  }
}
