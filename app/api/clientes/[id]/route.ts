import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { updateClienteEmbedding } from "@/lib/actions/embeddings"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id } = await params

    // Campos permitidos para actualizar
    const camposPermitidos = [
      "nombre",
      "razon_social",
      "cuit",
      "direccion",
      "localidad_id",
      "telefono",
      "mail",
      "condicion_iva",
      "metodo_facturacion",
      "condicion_pago",
      "tipo_canal",
      "retira_en_deposito",
    ]

    const datosActualizar: any = {}
    camposPermitidos.forEach((campo) => {
      if (body[campo] !== undefined) {
        datosActualizar[campo] = body[campo]
      }
    })

    // Actualizar nombre_razon_social si se actualiza razon_social o nombre
    if (datosActualizar.razon_social || datosActualizar.nombre) {
      datosActualizar.nombre_razon_social = datosActualizar.razon_social || datosActualizar.nombre
    }

    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .update(datosActualizar)
      .eq("id", id)
      .select()
      .single()

    if (clienteError) throw clienteError

    // Auto-vectorizar en background (no bloqueante)
    void updateClienteEmbedding(id)

    return NextResponse.json({
      success: true,
      cliente,
    })
  } catch (error: any) {
    console.error("[v0] Error actualizando cliente:", error)
    return NextResponse.json({ error: error.message || "Error actualizando cliente" }, { status: 500 })
  }
}
